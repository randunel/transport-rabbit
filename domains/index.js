'use strict';

const assert = require('assert');

const createConnection = require('./connection');
const createChannel = require('./channel');
const createRpcFabric = require('./rpc');
const createClientFabric = require('./client');
const createProducerFabric = require('./producer');
const createConsumerFabric = require('./consumer');
const createServerFabric = require('./server');
const createPubsubFabric = require('./pubsub');
const createCommandFabric = require('./command');
const queue = require('./queue');
const debug = require('debug')('rabbit:transport');

module.exports = initTransport;

function initTransport(settings) {

    const channels = Object.create(null);

    const EventEmitter = require('events');
    const events = new EventEmitter();

    const transport = {
        events,
        getReady: () => new Promise(resolve => events.on('ready', resolve)),
        close: () => connection.close(),
        addQueue,
        addChannel,
        getChannel: name => getChannel(name).wrap,
        getChannelQueues: name => getChannel(name).queues,
        isConnected: () => connection.isConnected(),
        assertedQueues: Object.create(null),
    };

    function getChannel(name) {
        const channelName = name || 'default';
        const channel = channels[channelName];
        assert(channel, `Channel ${channelName} does not exist`);
        return channel;
    }

    const connection = createConnection(settings);

    transport.connection = connection;
    addChannel('default');
    transport.queue = queue(transport, 'default');

    const rpc = createRpcFabric(transport, settings);
    transport.rpc = spec => rpc.declare(spec);

    const client = createClientFabric(transport);
    transport.client = spec => client.declare(spec);

    const producer = createProducerFabric(transport);
    transport.producer = spec => producer.declare(spec);

    const consumer = createConsumerFabric(transport);
    transport.consumer = spec => consumer.declare(spec);

    const server = createServerFabric(transport);
    transport.intermediateServer = spec => server.declareIntermediate(spec);
    transport.terminalServer = spec => server.declareTerminal(spec);

    const pubsub = createPubsubFabric(transport);
    transport.broadcaster = pubsub.createBroadcaster;
    transport.receiver = pubsub.createReceiver;

    const command = createCommandFabric(transport);
    transport.createCommandSender = command.createCommandSender;
    transport.createCommandServer = command.createCommandServer;
    transport.createCommandResultRecipient = command.createCommandResultRecipient;

    connection.events.on('connected', () => {
        Promise.all(Object.keys(channels)
            .map(name => {
                debug('init "%s" channel', name);
                const chan = transport.getChannel(name);
                return connection.createChannel()
                    // .catch(err => {
                        // might happen if more than MAX_CHANNELS channels created
                        // 65536 by default in rabbit version 3
                        // debug('Error while creating channel. Closing connection.', err);
                        // connection.close();
                    // })
                    .then(ch => chan.bind(ch, settings));
            }))
            // .then(() => setupChannels())
            .then(() => transport.events.emit('ready'))
            .catch(err => {
                debug('error during init', err.stack);
                transport.events.emit('error', err);
            });
    });

    connection.events.on('close', () => {
        debug('emit close event');
        events.emit('close');
    });

    // channel.events.on('close', channelErrored => {
    //     if (channelErrored && !connection.isDisconnected()) {
    //         connection.forceClose();
    //     }
    // });

    return transport;

    // function setupChannels() {
    //     return Promise.resolve()
    //         .then(() => Promise.all([
    //             server.init(),
    //             rpc.init(),
    //             producer.init()
    //         ]));
    // }

    function addQueue(queueDescriptor) {
        assert(isValidQueueDescriptor(queueDescriptor),
            'Invalid queue descriptor (consume)');

        addChannel(queueDescriptor.channel)
            .queues.push(queueDescriptor.queue);
    }

    function addChannel(channelName) {
        channelName = channelName || 'default';
        channels[channelName] = channels[channelName] || {
            queues: [],
            wrap: createChannel(channelName)
        };
        return channels[channelName].wrap;
    }

    function isValidQueueDescriptor(queueDescriptor) {
        return queueDescriptor instanceof Object && queueDescriptor.queue instanceof Object;
    }

}

