import { Queue } from 'bullmq'
import type { Priority } from '@prisma/client'

export interface PingJobData {
  endpointId: string
  userId: string
  priority: Priority
}

export interface MetricWriteJobData {
  endpointId: string
  status: 'UP' | 'DOWN' | 'TIMEOUT'
  statusCode: number | null
  responseTimeMs: number
}
export interface alert{
    userId:string
            endpointId:string,
            alertId: string
}


const connection = {
  host: process.env.REDIS_HOST ?? 'localhost',
  port: parseInt(process.env.REDIS_PORT ?? '6379'),
}

export const pingQueue = new Queue<PingJobData>('ping', {
  connection,
  defaultJobOptions: {
    removeOnComplete: { count: 10 },
    removeOnFail: { count: 50 },
  },
})


export const dbWriteQueue = new Queue<MetricWriteJobData>('metricWrite', {
    connection,
    defaultJobOptions: {
        removeOnComplete: { count: 10 },
        removeOnFail:     { count: 20 },
        attempts: 10,
        backoff: {
            type:  'exponential',
            delay: 2_000,   // 2s → 4s → 8s … up to ~34 min at attempt 10
        },
    },
})
export const alertQueue = new Queue<alert>('recovery', {
    connection,
    defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 3_000 },
        removeOnComplete: { count: 50 },
        removeOnFail:     { count: 50 },
    },
})