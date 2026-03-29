// Endpoint service
import { Request, Response } from 'express'
import { AuthType, Priority } from '@prisma/client'
import prisma from '../lib/prisma'
import redis from './redis'
import { isSafeUrl } from '../utils/ssrf'
import { encrypt } from '../utils/encryption'
import { BadRequestError, ConflictError, NotFoundError, ForbiddenError } from '../utils/errors'
import { pingQueue } from '../queues/pingQueue'

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Remove the BullMQ repeatable ping job for an endpoint (noop if not found). */
async function removeRepeatJob(endpointId: string): Promise<void> {
    const jobs = await pingQueue.getRepeatableJobs()
    const job = jobs.find(j => j.id === `endpoint:${endpointId}`)
    if (job) await pingQueue.removeRepeatableByKey(job.key)
}

/** Fetch an endpoint and verify it belongs to userId. */
async function findOwnedEndpoint(endpointId: string, userId: string) {
    const endpoint = await prisma.endpoint.findUnique({ where: { id: endpointId } })
    if (!endpoint) throw new NotFoundError('Endpoint not found')
    if (endpoint.userId !== userId) throw new ForbiddenError('Access denied')
    return endpoint
}

export const getEndpoints = async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.sub

    // Try Redis cache first
    const cacheKey = `user:${userId}:endpoints:list`
    const cached = await redis.get(cacheKey)
    if (cached) {
        res.json({ success: true, endpoints: JSON.parse(cached) })
        return
    }

    const endpoints = await prisma.endpoint.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        select: {
            id: true,
            name: true,
            url: true,
            isActive: true,
            isMuted: true,
            checkIntervalSec: true,
            alertThreshold: true,
            consecutiveFails: true,
            authType: true,
            priority: true,
            createdAt: true,
            updatedAt: true,
            // never expose authValue — encrypted secret
        },
    })

    // Cache for 30 s — short TTL so mutations reflect quickly
    await redis.setex(cacheKey, 30, JSON.stringify(endpoints))

    res.json({ success: true, endpoints })
}
interface CreateEndpointBody {
    name: string
    url: string
    checkIntervalSec: number
    authType?: AuthType
    authValue?: string
    priority?: Priority
    alertThreshold?: number
    isMuted?: boolean
}

export const createEndpoint = async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.sub

    const {
        name,
        url,
        checkIntervalSec,
        authType = AuthType.NONE,
        authValue,
        priority = Priority.LOW,
        alertThreshold = 3,
        isMuted = false,
    } = req.body as CreateEndpointBody

    if (!name || !url || !checkIntervalSec) {
        throw new BadRequestError('name, url, and checkIntervalSec are required')
    }

    if (!isSafeUrl(url)) {
        throw new BadRequestError('Invalid URL or private/internal addresses are not allowed')
    }

    if (typeof checkIntervalSec !== 'number' || checkIntervalSec < 60) {
        throw new BadRequestError('checkIntervalSec must be a number >= 60')
    }

    if (authType !== AuthType.NONE && !authValue) {
        throw new BadRequestError('authValue is required when authType is not NONE')
    }

    const encryptedAuthValue =
        authType !== AuthType.NONE && authValue ? encrypt(authValue) : null

    let endpoint
    try {
        endpoint = await prisma.endpoint.create({
            data: {
                name,
                url,
                checkIntervalSec,
                authType,
                authValue: encryptedAuthValue,
                priority,
                alertThreshold,
                isMuted,
                userId,
            },
        })
    } catch (err: any) {
        if (err.code === 'P2002') {
            throw new ConflictError('An endpoint with this URL already exists for your account')
        }
        throw err
    }

    const pipeline = redis.pipeline()
    pipeline.sadd(`user:${userId}:endpoints`, endpoint.id)
    pipeline.setex(`endpoint:config:${endpoint.id}`, 300, JSON.stringify(endpoint))

    await Promise.all([
        pipeline.exec(),
        pingQueue.add(
            'ping',
            {
                endpointId: endpoint.id,
                userId,
                priority: endpoint.priority,
            },
            {
                repeat: { every: endpoint.checkIntervalSec * 1000 },
                jobId: `endpoint:${endpoint.id}`,
            }
        ),
    ])

    res.status(201).json({ success: true, endpoint })
}

// ─── GET /api/endpoints/:id ───────────────────────────────────────────────────
export const getEndpoint = async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.sub
    const id = req.params.id as string

    const cacheKey = `endpoint:config:${id}`
    const cached = await redis.get(cacheKey)
    if (cached) {
        const ep = JSON.parse(cached)
        if (ep.userId !== userId) throw new ForbiddenError('Access denied')
        const { authValue: _, userId: __, ...safe } = ep
        res.json({ success: true, endpoint: safe })
        return
    }

    const endpoint = await prisma.endpoint.findFirst({
        where: { id, userId },
        select: {
            id: true, name: true, url: true, isActive: true, isMuted: true,
            checkIntervalSec: true, alertThreshold: true, consecutiveFails: true,
            authType: true, priority: true, createdAt: true, updatedAt: true,
        },
    })
    if (!endpoint) throw new NotFoundError('Endpoint not found')

    // cache includes userId for ownership check on cache hits
    await redis.setex(cacheKey, 300, JSON.stringify({ ...endpoint, userId }))
    res.json({ success: true, endpoint })
}

// ─── PUT /api/endpoints/:id ───────────────────────────────────────────────────
interface UpdateEndpointBody {
    name?: string
    url?: string
    checkIntervalSec?: number
    authType?: AuthType
    authValue?: string
    priority?: Priority
    alertThreshold?: number
    isMuted?: boolean
}

export const updateEndpoint = async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.sub
    const id = req.params.id as string
    const body = req.body as UpdateEndpointBody

    const existing = await findOwnedEndpoint(id, userId)

    if (body.url && !isSafeUrl(body.url)) {
        throw new BadRequestError('Invalid URL or private/internal addresses are not allowed')
    }
    if (body.checkIntervalSec !== undefined && (typeof body.checkIntervalSec !== 'number' || body.checkIntervalSec < 60)) {
        throw new BadRequestError('checkIntervalSec must be a number >= 60')
    }
    if (body.authType && body.authType !== AuthType.NONE && !body.authValue && !existing.authValue) {
        throw new BadRequestError('authValue is required when authType is not NONE')
    }

    const encryptedAuthValue =
        body.authType && body.authType !== AuthType.NONE && body.authValue
            ? encrypt(body.authValue)
            : body.authType === AuthType.NONE
            ? null
            : undefined   // keep whatever is in DB

    const updated = await prisma.endpoint.update({
        where: { id },
        data: {
            ...(body.name              !== undefined && { name:             body.name }),
            ...(body.url               !== undefined && { url:              body.url }),
            ...(body.checkIntervalSec  !== undefined && { checkIntervalSec: body.checkIntervalSec }),
            ...(body.authType          !== undefined && { authType:         body.authType }),
            ...(encryptedAuthValue     !== undefined && { authValue:        encryptedAuthValue }),
            ...(body.priority          !== undefined && { priority:         body.priority }),
            ...(body.alertThreshold    !== undefined && { alertThreshold:   body.alertThreshold }),
            ...(body.isMuted           !== undefined && { isMuted:          body.isMuted }),
        },
    })

    // Reschedule BullMQ job if interval changed and endpoint is active
    if (body.checkIntervalSec !== undefined && body.checkIntervalSec !== existing.checkIntervalSec && updated.isActive) {
        await removeRepeatJob(id)
        await pingQueue.add(
            'ping',
            { endpointId: id, userId, priority: updated.priority },
            { repeat: { every: updated.checkIntervalSec * 1000 }, jobId: `endpoint:${id}` }
        )
    }

    const pipeline = redis.pipeline()
    pipeline.del(`endpoint:config:${id}`)
    pipeline.del(`user:${userId}:endpoints:list`)
    await pipeline.exec()

    const { authValue: _, ...safe } = updated
    res.json({ success: true, endpoint: safe })
}

// ─── DELETE /api/endpoints/:id ────────────────────────────────────────────────
export const deleteEndpoint = async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.sub
    const id = req.params.id as string

    await findOwnedEndpoint(id, userId)

    await Promise.all([
        removeRepeatJob(id),
        prisma.endpoint.delete({ where: { id } }),
    ])

    const pipeline = redis.pipeline()
    pipeline.del(`endpoint:config:${id}`)
    pipeline.del(`endpoint:status:${id}`)
    pipeline.del(`fails:${id}`)
    pipeline.srem(`user:${userId}:endpoints`, id)
    pipeline.del(`user:${userId}:endpoints:list`)
    await pipeline.exec()

    res.json({ success: true, message: 'Endpoint deleted' })
}

// ─── PATCH /api/endpoints/:id/pause ──────────────────────────────────────────
export const pauseEndpoint = async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.sub
    const id = req.params.id as string

    const existing = await findOwnedEndpoint(id, userId)
    if (!existing.isActive) {
        res.json({ success: true, message: 'Endpoint already paused', isActive: false })
        return
    }

    await Promise.all([
        prisma.endpoint.update({ where: { id }, data: { isActive: false } }),
        removeRepeatJob(id),
    ])

    const pipeline = redis.pipeline()
    pipeline.del(`endpoint:config:${id}`)
    pipeline.del(`user:${userId}:endpoints:list`)
    await pipeline.exec()

    res.json({ success: true, message: 'Endpoint paused', isActive: false })
}

// ─── PATCH /api/endpoints/:id/resume ─────────────────────────────────────────
export const resumeEndpoint = async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.sub
    const id = req.params.id as string

    const existing = await findOwnedEndpoint(id, userId)
    if (existing.isActive) {
        res.json({ success: true, message: 'Endpoint already active', isActive: true })
        return
    }

    const updated = await prisma.endpoint.update({ where: { id }, data: { isActive: true } })

    await pingQueue.add(
        'ping',
        { endpointId: id, userId, priority: updated.priority },
        { repeat: { every: updated.checkIntervalSec * 1000 }, jobId: `endpoint:${id}` }
    )

    const pipeline = redis.pipeline()
    pipeline.del(`endpoint:config:${id}`)
    pipeline.del(`user:${userId}:endpoints:list`)
    await pipeline.exec()

    res.json({ success: true, message: 'Endpoint resumed', isActive: true })
}

// ─── GET /api/endpoints/:id/metrics ──────────────────────────────────────────
export const getEndpointMetrics = async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.sub
    const id = req.params.id as string
    const hours = Math.min(168, Math.max(1, parseInt(req.query.hours as string) || 24))

    const owned = await prisma.endpoint.findFirst({ where: { id, userId }, select: { id: true } })
    if (!owned) throw new NotFoundError('Endpoint not found')

    type MetricRow = { timestamp: Date; status: string; response_time_ms: number; status_code: number | null }

    const metrics = await prisma.$queryRawUnsafe<MetricRow[]>(
        `SELECT timestamp, status, response_time_ms, status_code
         FROM endpoint_metrics
         WHERE endpoint_id = $1
           AND timestamp >= NOW() - ($2 || ' hours')::INTERVAL
         ORDER BY timestamp ASC`,
        id,
        hours.toString()
    )

    res.json({ success: true, metrics, hours })
}