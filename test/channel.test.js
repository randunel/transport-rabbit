'use strict';

const expect = require('expect');
const createTransport = require('../');
const rabbitUrl = process.env.RABBIT_URL || 'amqp://192.168.99.101:5672';

describe('channel', () => {

    let transport = null;

    beforeEach(() => {
        transport = createTransport({
            url: rabbitUrl
        });
    });

    afterEach(() => {
        return transport.close();
    });

    it('should allocate amqlib channel on connect', () => {
        const channel = transport.channel('default');
        expect(channel.getWrappedChannel).toThrow();
        return transport.getReady()
            .then(() => expect(channel.getWrappedChannel).toNotThrow());
    });

    it('should close amqplib channel on close', () => {
        const channel = transport.channel('default');
        return transport.getReady()
            .then(() => expect(transport.channels.default).toExist())
            .then(() => channel.close())
            .then(() => expect(transport.channels.default).toNotExist());
    });

    context('multiple channels consumption', () => {

        it('should be possible to consume multiple channels', () => {
            let alphaMsg = null;
            let bravoMsg = null;

            const channel = transport.channel('default');

            const client = transport.producer({
                exchangeName: 'channel.test',
                channelName: 'default'
            });

            channel.addInit(() =>
                channel.assertExchange('channel.test', 'direct'));

            channel.addInit(() =>
                channel.assertQueue('channel.test'));

            channel.addInit(() =>
                channel.bindQueue('channel.test', 'channel.test', 'default'));

            function startConsumer(channelName, fn) {
                transport.consumer({
                    queueName: 'channel.test',
                    consume(msg, job) {
                        fn(msg);
                        setTimeout(job.ack, 150);
                    },
                    channelName
                });
            }

            return transport.getReady()
                .then(() => startConsumer('alpha', msg => alphaMsg = msg))
                .then(() => startConsumer('bravo', msg => bravoMsg = msg))
                .then(() => new Promise(resolve => {
                    client('hello alpha', 'default');
                    client('hello bravo', 'default');
                    setTimeout(resolve, 300);
                }))
                .then(() => {
                    expect(alphaMsg).toBe('hello alpha');
                    expect(bravoMsg).toBe('hello bravo');
                });
        });

    });

    context('prefetch', () => {

        it('should be configurable per-channel', () => {
            const alpha = transport.channel('alpha', {
                prefetchCount: 2,
                prefetchGlobal: true
            });
            expect(alpha.settings.prefetchCount).toBe(2);
            expect(alpha.settings.prefetchGlobal).toBe(true);
        });

        it('should default to count=1 global=false', () => {
            const bravo = transport.channel('bravo');
            expect(bravo.settings.prefetchCount).toBe(1);
            expect(bravo.settings.prefetchGlobal).toBe(false);
        });

    });

    context('initializers', () => {

        it('should be queued before connect and executed sequentially', () => {
            const inits = [];
            transport = createTransport({ url: rabbitUrl });
            const channel = transport.channel('default');
            channel.addInit(() => inits.push('a'));
            channel.addInit(() => inits.push('b'));
            channel.addInit(() => inits.push('c'));
            return transport.getReady()
                .then(() => {
                    expect(inits.join('')).toBe('abc');
                });
        });

        it('should queue after connect and executed inplace', done => {
            const inits = [];
            transport = createTransport({ url: rabbitUrl });
            const channel = transport.channel('default');
            transport.getReady()
                .then(() => {
                    channel.addInit(() => inits.push('a'));
                    channel.addInit(() => inits.push('b'));
                    channel.addInit(() => inits.push('c'));
                    // initializers are async!
                    expect(inits.join('')).toBe('');
                    setTimeout(() => {
                        expect(inits.join('')).toBe('abc');
                        done();
                    });
                });
        });

        it('should mix before and after connect and still execute sequentially', done => {
            const inits = [];
            transport = createTransport({ url: rabbitUrl });
            const channel = transport.channel('default');
            channel.addInit(() => inits.push('a'));
            channel.addInit(() => inits.push('b'));
            channel.addInit(() => inits.push('c'));
            transport.getReady()
                .then(() => {
                    channel.addInit(() => inits.push('d'));
                    channel.addInit(() => inits.push('e'));
                    channel.addInit(() => inits.push('f'));
                    // pre-connect are now executed
                    expect(inits.join('')).toBe('abc');
                    channel.getReady()
                        .then(() => {
                            expect(inits.join('')).toBe('abcdef');
                            done();
                        });
                });
        });

    });

});

