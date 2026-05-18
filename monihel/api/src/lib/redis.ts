import Redis from 'ioredis'
import { env } from '../config/env'
import { logger } from './logger'

/**
 * Two logically separate Redis clients to prevent queue load from evicting
 * cache keys (and vice versa).
 *
 *   - cacheRedis      → API cache, rate limit counters, fail counters, alert locks
 *   - queueConnection → BullMQ connection options (BullMQ creates its own clients)
 *   - redisSubscriber → API pub/sub subscriber (user-events:*)
 *   - adapterSubscriber → Socket.IO Redis adapter subscriber
 *
 * The default deployment uses ONE Redis instance with two databases (0 = queue,
 * 1 = cache). In production, CACHE_REDIS_HOST can point to a different machine.
 */

const cacheConfig = {
    host: env.CACHE_REDIS_HOST,
    port: env.CACHE_REDIS_PORT,
    db: env.CACHE_REDIS_DB,
    password: env.REDIS_PASSWORD,
    maxRetriesPerRequest: null as null,
}

const queueRedisConfig = {
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    db: env.QUEUE_REDIS_DB,
    password: env.REDIS_PASSWORD,
    maxRetriesPerRequest: null as null,
}

/** BullMQ connection options. Pass directly to `new Queue` / `new Worker`. */
export const queueConnection = queueRedisConfig

/** Cache + pub/sub + rate limit client. */
export const redis = new Redis(cacheConfig)

/** Pub/sub subscriber (separate connection — ioredis requires this when subscribing). */
export const redisSubscriber = new Redis(cacheConfig)

/** Socket.IO Redis adapter needs its own dedicated subscriber. */
export const adapterSubscriber = new Redis(cacheConfig)

for (const [name, client] of [
    ['cache', redis],
    ['subscriber', redisSubscriber],
    ['adapter', adapterSubscriber],
] as const) {
    client.on('error', (err) => logger.error({ client: name, err: err.message }, 'redis client error'))
}

export async function disconnectRedis() {
    await Promise.allSettled([
        redis.quit(),
        redisSubscriber.quit(),
        adapterSubscriber.quit(),
    ])
}