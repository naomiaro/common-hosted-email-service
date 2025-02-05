/**
 * @module QueueConnection
 *
 * Create and check the connection for a Bull queue.
 *
 * @see QueueService
 *
 * @see Bull
 *
 * @exports QueueConnection
 */
const Bull = require('bull');
const config = require('config');
const Redis = require('ioredis');

const log = require('../components/log')(module.filename);
const utils = require('../components/utils');

/**
 * @function _createClient
 * Creates and returns an ioredis connection
 * @returns Object An ioredis object
 */
const _createClient = () => {
  let redis;

  const redisOpts = {
    enableReadyCheck: false, // Bull forcibly assumes Redis is ready if it has connected to it
    maxRetriesPerRequest: null, // Set to null to force each redis command to wait forever until connection is alive again (old pre-ioredis v4 behavior)
    password: config.get('redis.password'),
    reconnectOnError: (err) => err.message.toUpperCase().includes('READONLY')
  };
  if (config.get('redis.clusterMode') === 'yes') {
    redis = new Redis.Cluster([{
      host: config.get('redis.host')
    }], {
      redisOptions: redisOpts
    });
  } else {
    redisOpts.host = config.get('redis.host');
    redis = new Redis(redisOpts);
  }

  redis.on('ready', () => {
    log.verbose('Redis Ready', { function: '_createClient' });
  });
  redis.on('reconnecting', () => {
    log.verbose('Redis Reconnecting...', { function: '_createClient' });
  });
  redis.on('connect', () => {
    log.verbose('Redis Connected', { function: '_createClient' });
  });

  return redis;
};

/**
 * @function _checkRedis
 * Checks a Bull Redis connection status
 * @param {boolean} initialized Bull queue initialization state for this connection
 * @param {object} client Bull queue ioredis object for this connection
 * @param {integer} [timeout=5] Number of seconds to retry before failing out
 * @returns boolean True if initialized and ready, false otherwise
 */
const _checkRedis = async (initialized, client, timeout = 5) => {
  // Bull and Redis needs a small grace period to initialize.
  for (let i = 0; i < timeout; i++) {
    if (initialized && client && client.status === 'ready') return true;
    await utils.wait(1000);
  }

  return false;
};

class QueueConnection {
  /**
   * Creates a new QueueConnection with default configuration.
   * @class
   */
  constructor() {
    /**
     * Configuration object for Bull queue
     */
    const bullConfig = {
      // Prefix must be explicitly defined with brackets to support Redis Clustering
      // https://github.com/OptimalBits/bull/blob/master/PATTERNS.md#redis-cluster
      prefix: '{bull}',
      // The Cluster instance must be created inside createClient to behave correctly
      // https://github.com/OptimalBits/bull/issues/1401#issuecomment-519443898
      createClient: _createClient,
      defaultJobOptions: {
        // Number of retry attempts before the job fails
        attempts: Number(config.get('server.maxAttempts')),
        // Wait 10 seconds before reattempting
        backoff: 10 * 1000,
        // Remove Job objects completely from Redis to limit memory proliferation
        removeOnComplete: true,
        removeOnFail: true
      }
    };

    if (!QueueConnection.instance) {
      this.queue = new Bull('ches', bullConfig);
      QueueConnection.instance = this;
    }

    return QueueConnection.instance;
  }

  /**
   * @function queue
   * Gets the underlying Bull queue
   */
  get queue() {
    return this._queue;
  }

  /**
   * @function queue
   * Sets the underlying Bull queue
   * @param {object} v - a new Bull instance
   */
  set queue(v) {
    this._connected = false;
    this._queue = v;
  }

  /**
   * @function connected
   * True or false if connected.
   */
  get connected() {
    return this._connected;
  }

  /**
   * @function close
   * Will close the QueueConnection
   * @param {function} [cb] Optional callback
   */
  close(cb = undefined) {
    if (this.queue) {
      try {
        this.queue.whenCurrentJobsFinished().then(() => {
          this.queue.close().then(() => {
            this._connected = false;
            log.info('Disconnected', { function: 'close' });
            if (cb) cb();
          });
        });
      } catch (e) {
        log.error('Failed to close', { error: e, function: 'close' });
      }
    }
  }

  /**
   * @function checkReachable
   * Checks that Redis is reachable
   * @param {integer} [timeout=5] Number of seconds to retry before failing out
   * @returns boolean True if queue is reachable
   */
  async checkReachable() {
    // Bull and Redis needs a small grace period to initialize.
    return _checkRedis(this.queue.clientInitialized, this.queue.client);
  }

  /**
   * @function checkConnection
   * Checks that all Queue Connections are ready
   * @returns boolean True if queue is connected
   */
  async checkConnection() {
    const readiness = await Promise.all([
      _checkRedis(this.queue.clientInitialized, this.queue.client),
      _checkRedis(this.queue.subscriberInitialized, this.queue.eclient),
      _checkRedis(this.queue.bclientInitialized, this.queue.bclient)
    ]);
    const isReady = readiness.every(x => x);

    if (!isReady) {
      log.error('Redis connections not ready', { function: 'checkConnection' });
    }

    this._connected = isReady;
    return this.connected;
  }

  /**
   * @function pause
   * Pause this QueueConnection from accepting new jobs
   */
  pause() {
    if (this.queue) {
      this.queue.pause(true).then(() => {
        log.info('Stop accepting new jobs', { function: 'pause' });
      });
    }
  }

  /**
   * @function resume
   * Resume this QueueConnection to accept new jobs
   */
  resume() {
    if (this.queue) {
      this.queue.resume(true).then(() => {
        log.info('Start accepting new jobs', { function: 'resume' });
      });
    }
  }
}

module.exports = QueueConnection;
