import Redis from 'ioredis'

const redis = new Redis({
  host: process.env.REDIS_HOST ?? 'localhost',
  port: parseInt(process.env.REDIS_PORT ?? '6379'),
})

redis.on('error', (err: Error) => {
  console.error('[Redis] Connection error:', err.message)
})

export async function removeEndpointFromRedis(userId: string, endpointId: string): Promise<void> {
  await redis.srem(`user:${userId}:endpoints`, endpointId)
}

export default redis
