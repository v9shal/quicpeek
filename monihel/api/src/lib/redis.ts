import Redis from 'ioredis'

const redisConfig = {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: parseInt(process.env.REDIS_PORT ?? '6379')
}

export const redis = new Redis(redisConfig)

export const redisSubscriber = new Redis(redisConfig)

export const adapterSubscriber = new Redis(redisConfig)

export async function disconnectRedis() {
    await Promise.all([
        redis.quit(),
        redisSubscriber.quit(),
        adapterSubscriber.quit()
    ])
}