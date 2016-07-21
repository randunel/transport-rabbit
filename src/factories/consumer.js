'use strict';

module.exports = createConsumerFactory;

const assert = require('assert');
const debug = require('debug')('rabbit:consumer');

function createConsumerFactory(transport) {

    /**
     * @param spec {Object}:
     *  - queueName {String} - name of queue
     *  - exchangeName {String} - name of exchange to bind queue to
     *  - routingPatterns {Array<String>} - routing keys for queue binding
     *    (optional, defaults to [])
     *  - handler {(Object, { msg, context, ack, nack }) => Promise} - message handler
     *  - queueOptions {Object} - options for assertQueue (defaults to {})
     *  - consumeOptions {Object} - options for ch.consume (defaults to {})
     *  - channelName {String} - name of channel (optional, defaults to 'default')
     */
    return function createConsumer(spec) {

        let assertedQueue = '';
        let consumerTag = null;

        const {
            queueName, // required, can be empty string for exclusive queue
            exchangeName,
            routingPatterns = [],
            queueOptions = {},
            consumeOptions = {},
            consume,
            channelName = 'default',
        } = spec;
        
        const noAck = consumeOptions.noAck;

        assert.notEqual(typeof queueName, 'undefined',
            'Consumer must have queue to consume from specified');

        assert.equal(typeof consume, 'function',
            'Consumer must have "consume(payload, job)" function specified');

        const channel = transport.assertChannel(channelName);
        
        const destroy = transport.addInit(init);

        return {
            get assertedQueue() {
                return assertedQueue;
            },
            get consumerTag() {
                return consumerTag
            },
            cancel
        };
        
        function init() {
            return channel.assertQueue(queueName, queueOptions)
                .then(asserted => assertedQueue = asserted.queue)
                .then(() => Promise.all(routingPatterns.map(routingPattern =>
                    channel.bindQueue(assertedQueue, exchangeName, routingPattern)
                        .then(() => {
                            debug('queue "%s" bound to "%s" routed as "%s"',
                                assertedQueue,
                                exchangeName,
                                routingPattern);
                        })
                ))
                    .then(() => {
                        if (queueName === '') {
                            // bind exclusive queues to exchanges to be able to use
                            // producer(payload, generatedQueue);
                            return channel.bindQueue(
                                assertedQueue,
                                exchangeName,
                                assertedQueue
                            );
                        }
                    })
                    .then(() => channel.consume(assertedQueue, handler, consumeOptions))
                    .then(res => consumerTag = res.consumerTag)
                    .then(() => debug('ready to consume "%s" via %s channel',
                        assertedQueue, channelName)));
        }
        
        function cancel() {
            return channel.cancel(consumerTag)
                .then(() => destroy());
        }

        function handler(msg) {
            if (msg == null) {
                // consume is cancelled, corner case
                return;
            }
            debug(`received ${msg.properties.type || 'msg'} to ${queueName || 'exclusive queue'}`);
            try {
                const data = JSON.parse(msg.content.toString()) || {};
                const {
                    payload,
                    context
                } = data;
                consume(payload, createJob(msg, context));
            } catch (e) {
                console.warn('Malformed message is dropped from queue');
                debug(`dropping ${msg.content.toString()} due to ${e.message}`);
                channel.nack(msg, false, false);
            }
        }

        function createJob(msg, context) {

            let ackStatus = noAck === true ? 'ack' : null;

            return {
                msg,
                ack,
                nack,
                get ackStatus() {
                    return ackStatus;
                },
                context
            };

            function ack(allUpTo) {
                if (ackStatus) {
                    return;
                }
                ackStatus = 'ack';
                channel.ack(msg, allUpTo);
            }

            function nack(allUpTo, requeue) {
                if (ackStatus) {
                    return;
                }
                ackStatus = 'nack';
                channel.nack(msg, allUpTo, requeue);
            }
        }

    };
}
