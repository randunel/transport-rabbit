'use strict';

const expect = require('expect');
const createTransport = require('../');
const rabbitUrl = process.env.RABBIT_URL || 'amqp://192.168.99.101:5672';

describe('consumer', () => {

    let transport = null;

    beforeEach(() => {
        transport = createTransport({
            url: rabbitUrl
        });
        const channel = transport.channel('custom');
        channel.addInit(() => channel.assertQueue('consumer.test'));
    });

    afterEach(() => {
        const channel = transport.channel('custom');
        return channel.purgeQueue('consumer.test');
    });

    afterEach(() => {
        return transport.close();
    });

    it('should consume queues', () => {

        transport.consumer({
            channelName: 'custom',
            queueName: 'consumer.test',
            consume() {}
        });

        let queueConsumed = false;
        const chan = transport.channel('custom');
        chan.consume = (...args) => {
            queueConsumed = true;
            return chan.getWrappedChannel().consume(...args);
        };
        return transport.getReady()
            .then(() => {
                expect(queueConsumed).toBe(true);
            });
    });

    it('should maintain consumer tags', () => {
        const consumer = transport.consumer({
            channelName: 'custom',
            queueName: 'consumer.test',
            consumeOptions: {
                consumerTag: 'some-tag'
            },
            consume() {}
        });
        return transport.getReady()
            .then(() => {
                expect(consumer.consumerTag).toBe('some-tag');
            });
    });

    it('should be cancellable', () => {
        let consumed = false;
        const channel = transport.channel('custom');
        const consumer = transport.consumer({
            channelName: 'custom',
            queueName: 'consumer.test',
            consume() {
                consumed = true;
            }
        });
        return transport.getReady()
            .then(() => consumer.cancel())
            .then(() => channel.sendToQueue('consumer.test', new Buffer('{}')))
            .then(() => new Promise(resolve => setTimeout(resolve, 200)))
            .then(() => expect(consumed).toBe(false));
    });

    it('should not consume malformed JSON messages', () => {
        let consumed = false;
        const channel = transport.channel('custom');
        transport.consumer({
            channelName: 'custom',
            queueName: 'consumer.test',
            consume() {
                consumed = true;
            }
        });
        return transport.getReady()
            .then(() => channel.sendToQueue('consumer.test', new Buffer('hi')))
            .then(() => new Promise(resolve => setTimeout(resolve, 200)))
            .then(() => expect(consumed).toBe(false));
    });

});

