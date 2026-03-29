// Alerts routes
import { Router } from 'express'
import { authenticate } from '../middleware/auth'
import { asyncHandler } from '../utils/asyncHandler'
import prisma from '../lib/prisma'
import type { AlertStatus } from '@prisma/client'

const router = Router()

router.use(authenticate)

// GET /api/alerts?page=1&limit=20&status=TRIGGERED|RESOLVED
router.get('/', asyncHandler(async (req, res) => {
    const userId = req.user!.sub
    const page   = Math.max(1, parseInt(req.query.page  as string) || 1)
    const limit  = Math.min(100, parseInt(req.query.limit as string) || 20)
    const status = req.query.status as AlertStatus | undefined

    const where = {
        endpoint: { userId },
        ...(status && { status }),
    }

    const [alerts, total] = await Promise.all([
        prisma.alert.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            skip: (page - 1) * limit,
            take: limit,
            select: {
                id:         true,
                status:     true,
                message:    true,
                createdAt:  true,
                resolvedAt: true,
                endpoint: {
                    select: { id: true, name: true, url: true },
                },
            },
        }),
        prisma.alert.count({ where }),
    ])

    res.json({
        success: true,
        alerts,
        pagination: { total, page, limit, pages: Math.ceil(total / limit) },
    })
}))

export default router
