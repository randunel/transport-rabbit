'use strict';

const assert = require('assert');
const debug = require('debug')('rabbit:router');

module.exports = createRouterFabric;

function createRouterFabric(transport) {

    return {
        declare
    };

    /**
     * @param spec {Object}
     *  - getContextId
     *  - producer
     *  - routes
     */
    function declare(spec) {
        const {
            channelName,
            exchangeName,
            getContextId,
            producer,
            routes,
            queueOptions
        } = spec;

        assert(exchangeName, 'Router must have exchangeName specified');
        assert(producer, 'Router must have producer specified');
        assert(routes, 'Router must have routes specified');

        const channel = transport.addChannel(channelName);

        channel.addSetup(() => {
            return Promise.all(routes.map(route => {
                const queueName = [ exchangeName, route ].join('.');
                channel.assertQueue(queueName, queueOptions)
                    .then(() => channel.bindQueue(
                        queueName,
                        exchangeName,
                        route
                    ));
            }));
        });

        return function send(payload, route, opts) {
            channel.assertOpenChannel();

            return Promise.resolve(getCorrelationId(opts && opts.context))
                .then(correlationId => {
                    debug('Sending msg to route %s corrId=%s', route, correlationId);

                    return producer(payload, route, Object.assign(
                        {},
                        opts,
                        { correlationId }
                    ));
                });
        };

        function getCorrelationId(context) {
            if (context && getContextId) {
                return getContextId(context);
            }

            return null;
        }
    }

}