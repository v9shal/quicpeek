// Endpoint service
import { Request, Response } from 'express'
import { AuthType, Priority } from '@prisma/client'
import prisma from '../lib/prisma'
import redis from './redis'
import { isSafeUrl } from '../utils/ssrf'
import { encrypt } from '../utils/encryption'
import { BadRequestError, ConflictError } from '../utils/errors'
import { pingQueue } from '../queues/pingQueue'

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