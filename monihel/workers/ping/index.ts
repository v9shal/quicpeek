import { Job, Worker } from 'bullmq'
import type { Endpoint } from '@prisma/client'
import redis from '../../api/src/services/redis'
import prisma from '../../api/src/lib/prisma'
import { alertQueue, dbWriteQueue } from '../../api/src/queues/pingQueue'
import { pingEndpoint } from './pingService'
const connection = {
  host: process.env.REDIS_HOST ?? 'localhost',
  port: parseInt(process.env.REDIS_PORT ?? '6379'),
}

const worker = new Worker('ping', async (job: Job) => {
    const { endpointId } = job.data

    const details = await getEndpointConfig(endpointId)
    if (!details || !details.isActive) return
    if (details.isMuted) return

    const pingResult = await pingEndpoint(details.url, details.authType, details.authValue)

    await Promise.all([
        dbWriteQueue.add('metricWrite', { endpointId, ...pingResult }),
        redis.setex(`endpoint:status:${endpointId}`, 300, JSON.stringify(pingResult)),
        redis.publish(`user-events:${details.userId}`, JSON.stringify({ endpointId, ...pingResult }))
    ])

    if (pingResult.status === 'DOWN' || pingResult.status === 'TIMEOUT') {
        const failCount = await redis.incr(`fails:${endpointId}`)

        if (failCount >= details.alertThreshold) {
            const activeAlert = await prisma.alert.findFirst({
                where: { endpointId, status: 'TRIGGERED' }
            })

            if (activeAlert) return

            await prisma.$transaction(async (tx) => {
                const alert = await tx.alert.create({
                    data: { status: 'TRIGGERED', endpointId }
                })
                await tx.alertDigest.create({
                    data: {
                        endpointId,
                        status: 'PENDING',
                        alertId: alert.id,
                        userId: details.userId
                    }
                })
            })
        }
        return
    }

    
    if (pingResult.status === 'UP') {
        const failCount = await redis.get(`fails:${endpointId}`)
        if (!failCount || parseInt(failCount) === 0) return

        await redis.del(`fails:${endpointId}`)

        const activeAlert = await prisma.alert.findFirst({
            where: { endpointId, status: 'TRIGGERED' }
        })

        if (!activeAlert) return

        await prisma.alert.update({
            where: { id: activeAlert.id },
            data: { status: 'RESOLVED', resolvedAt: new Date() }
        })

        await alertQueue.add('recovery', {
            userId: details.userId,
            endpointId,
            alertId: activeAlert.id
        })
    }

}, { connection, concurrency: 20, lockDuration: 30000 })

worker.on('completed', (job: Job) => {
  console.log(`[ping:worker] job=${job.id} done`)
})

worker.on('failed', (job: Job | undefined, err: Error) => {
  console.error(`[ping:worker] job=${job?.id} failed:`, err.message)
})

const getEndpointConfig = async (endpointId: string): Promise<Endpoint | null> => {
  const cached = await redis.get(`endpoint:config:${endpointId}`)
  if (cached != null) return JSON.parse(cached) as Endpoint  

  const details = await prisma.endpoint.findFirst({
    where: { id: endpointId },
  })
  if (details) {
    await redis.setex(`endpoint:config:${endpointId}`, 300, JSON.stringify(details))
  }
  return details
}