'use strict';

const assert = require('assert');
const debug = require('debug')('rabbit:command');

module.exports = function createCommandFabric(transport) {

    return {
        createCommandSender,
        createCommandServer,
        createCommandResultRecipient
    };

    function createCommandSender(exchangeName, opts) {

        opts = opts || {};
        
        const route = 'command';

        const {
            channelName,
            getContextId
        } = opts;

        const channel = transport.getChannel(channelName);

        // TODO (bo) not sure if that's right
        // TODO (e.g. why producer needs a separate queue anyway?)
        channel.addBinding(() => {
            return channel.bindQueue(
                exchangeName + '.command',
                exchangeName,
                'command'
            );
        });
        
        const produce = transport.producer({
            exchangeName,
            exchangeType: 'direct'
        });
        
        return function sendCommand(payload, opts) {
            opts = opts || {};
            return Promise.resolve(getCorrelationId(opts.context))
                .then(correlationId => {
                    const effectiveOpts = Object.assign({}, opts, {
                        correlationId
                    });
                    return produce(payload, route, effectiveOpts);
                });
        };

        function getCorrelationId(context) {
            return context && getContextId && getContextId(context) || null;
        }

    }

    function createCommandServer(exchangeName, opts) {
        assert.equal(typeof exchangeName, 'string',
            'Command server requires exchangeName: String to be specified');

        assert.equal(typeof opts, 'object',
            'Command server requires opts: Object to be specified');

        const {
            channelName,
            handler
        } = opts;

        assert.equal(typeof handler, 'function',
            'Command server requires opts.handler: Function/2 to be specified');

        let producer = null;

        if (opts.produceResults !== false) {
            producer = transport.producer({
                channelName,
                exchangeName
            });
        }

        return transport.consumer({
            channelName,
            exchangeName,
            exchangeType: 'direct',
            queueName: exchangeName + '.command',
            queueOptions: {
                exclusive: false,
                durable: true,
                autoDelete: false
            },
            routes: [ 'command' ],
            consume(payload, job) {
                const correlationId = job.msg.properties.correlationId;

                if (!producer) {
                    handler(payload, job);
                    return;
                }

                Promise.resolve()
                    .then(() => handler(payload, job))
                    .then(result => producer(result, 'result', {
                        correlationId
                    }))
                    .catch(err => producer({
                        message: err.message,
                        stack: err.stack,
                        details: err.details
                    }, 'error', {
                        correlationId
                    }));
            }
        });

    }

    function createCommandResultRecipient(exchangeName, opts) {
        assert(opts, 'Required "opts" argument is missing');

        const {
            result,
            error,
            channelName,
            getContextById
        } = opts;

        createConsumer('result', result);
        createConsumer('error', error);

        function createConsumer(type, handler) {
            transport.consumer({
                channelName,
                exchangeName,
                queueName: [ exchangeName, type ].join('.'),
                routingPatterns: [ type ],
                consumerOptions: { noAck: true },
                consume(payload, job) {
                    const {
                        msg,
                        ack,
                        nack
                    } = job;

                    getContext(msg.properties.correlationId)
                        .then(context => {
                            handler(payload, { context, ack, nack });
                        });
                }
            });
        }

        function getContext(correlationId) {
            if ('function' !== typeof getContextById || !correlationId) {
                return Promise.resolve(null);
            }

            return Promise.resolve()
                .then(() => getContextById(correlationId))
                .catch(err => {
                    debug('error while retrieving context', err.stack);
                    return null;
                });
        }


    }

};

