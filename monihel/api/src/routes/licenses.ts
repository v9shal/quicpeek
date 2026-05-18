import { Router, Request, Response } from 'express'
import crypto from 'crypto'
import nodemailer from 'nodemailer'
import { asyncHandler } from '../utils/asyncHandler'
import { logger } from '../lib/logger'
import { env } from '../config/env'
import prisma from '../lib/prisma'

const router = Router()

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateLicenseKey(): string {
    return [
        'MNHL',
        crypto.randomBytes(4).toString('hex').toUpperCase(),
        crypto.randomBytes(4).toString('hex').toUpperCase(),
        crypto.randomBytes(4).toString('hex').toUpperCase(),
    ].join('-')
}

const transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
})

async function emailLicenseKey(email: string, key: string): Promise<void> {
    await transporter.sendMail({
        from: env.SMTP_FROM,
        to: email,
        subject: 'Your Monihel License Key',
        html: [
            '<h2>Thanks for purchasing Monihel! 🎉</h2>',
            '<p>Here is your license key:</p>',
            `<pre style="font-size:18px;background:#f4f4f4;padding:12px;border-radius:4px">${key}</pre>`,
            '<p>Add it to your <code>.env</code> file:</p>',
            `<pre>LICENSE_KEY=${key}</pre>`,
            '<p><strong>Quick start:</strong> Run <code>docker compose up --build</code> — full instructions in README.md</p>',
            '<p>Reply to this email if you need help.</p>',
        ].join('\n'),
    })
}

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

/**
 * POST /v1/licenses/gumroad-webhook
 *
 * Gumroad sends a POST here after each sale. This endpoint:
 *  1. Verifies the seller_id matches yours (basic auth)
 *  2. Generates a license key
 *  3. Stores it in the database
 *  4. Emails it to the buyer
 *
 * Setup in Gumroad:
 *   Dashboard → Settings → Advanced → Ping URL → https://api.monihel.io/v1/licenses/gumroad-webhook
 *
 * Gumroad sends application/x-www-form-urlencoded with fields:
 *   seller_id, product_id, email, sale_id, price, etc.
 */
router.post(
    '/gumroad-webhook',
    asyncHandler(async (req: Request, res: Response) => {
        const { seller_id, email, product_id, sale_id } = req.body

        // Verify this is from your Gumroad account
        if (!env.GUMROAD_SELLER_ID || seller_id !== env.GUMROAD_SELLER_ID) {
            logger.warn({ seller_id, sale_id }, 'gumroad webhook: invalid seller_id')
            res.status(403).json({ success: false, error: 'unauthorized' })
            return
        }

        if (!email) {
            res.status(400).json({ success: false, error: 'missing buyer email' })
            return
        }

        // Idempotent: if we already processed this sale, don't generate another key
        const existing = await prisma.licenseKey.findFirst({
            where: { saleId: sale_id },
        })
        if (existing) {
            logger.info({ sale_id, email }, 'gumroad webhook: duplicate sale, skipping')
            res.json({ success: true, message: 'already processed' })
            return
        }

        // Generate + store
        const key = generateLicenseKey()
        await prisma.licenseKey.create({
            data: {
                key,
                buyerEmail: email,
                saleId: sale_id || null,
                productId: product_id || null,
                isActive: true,
            },
        })

        // Respond immediately so Gumroad doesn't time out, then email in background
        res.json({ success: true })

        emailLicenseKey(email, key)
            .then(() => logger.info({ email, sale_id, key }, 'gumroad webhook: license generated and emailed'))
            .catch((err: any) => logger.error({ err: err?.message, email, key }, 'gumroad webhook: email send failed'))
    })
)

export default router
