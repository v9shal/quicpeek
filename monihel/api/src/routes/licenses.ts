import { Router, Request, Response } from 'express'
import { asyncHandler } from '../utils/asyncHandler'
import prisma from '../lib/prisma'

const router = Router()

/**
 * POST /v1/licenses/validate
 *
 * Public endpoint that buyers' instances call on startup to verify their key.
 * - First call with a new instanceId binds the key to that instance.
 * - Subsequent calls from a different instance are rejected (anti-sharing).
 */
router.post(
    '/validate',
    asyncHandler(async (req: Request, res: Response) => {
        const { key, instanceId } = req.body

        if (!key) {
            res.status(400).json({ valid: false, error: 'key is required' })
            return
        }

        const license = await prisma.licenseKey.findUnique({ where: { key } })

        if (!license || !license.isActive) {
            res.status(200).json({ valid: false, error: 'invalid or inactive key' })
            return
        }

        // First activation — bind to instance
        if (!license.instanceId && instanceId) {
            await prisma.licenseKey.update({
                where: { key },
                data: { instanceId, activatedAt: new Date() },
            })
        }

        // Instance mismatch — key sharing detected
        if (license.instanceId && license.instanceId !== instanceId) {
            res.status(200).json({
                valid: false,
                error: 'key already activated on another instance',
            })
            return
        }

        res.json({ valid: true })
    })
)

/**
 * POST /v1/licenses/deactivate
 *
 * Allows a buyer to unbind their key so they can move to a new server.
 */
router.post(
    '/deactivate',
    asyncHandler(async (req: Request, res: Response) => {
        const { key, instanceId } = req.body

        if (!key) {
            res.status(400).json({ valid: false, error: 'key is required' })
            return
        }

        const license = await prisma.licenseKey.findUnique({ where: { key } })

        if (!license || !license.isActive) {
            res.status(200).json({ success: false, error: 'invalid or inactive key' })
            return
        }

        // Must provide the current instanceId to deactivate (proves ownership)
        if (license.instanceId !== instanceId) {
            res.status(200).json({ success: false, error: 'instance mismatch' })
            return
        }

        await prisma.licenseKey.update({
            where: { key },
            data: { instanceId: null, activatedAt: null },
        })

        res.json({ success: true, message: 'key deactivated — you can now activate on a new instance' })
    })
)

export default router
