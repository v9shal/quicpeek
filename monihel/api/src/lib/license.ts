import os from 'os'
import { logger } from './logger'

/**
 * Validate the license key on startup (production only).
 *
 * In development/test, validation is skipped so contributors can run locally.
 * In production, the app calls the license validation API to ensure the
 * buyer's key is valid and bound to this instance.
 */
export async function validateLicense(): Promise<void> {
    const key = process.env.LICENSE_KEY
    if (!key) {
        if (process.env.NODE_ENV === 'production') {
            throw new Error('LICENSE_KEY not set — required in production. See .env.example')
        }
        return // development: skip
    }

    if (process.env.NODE_ENV !== 'production') return

    const validationUrl =
        process.env.LICENSE_VALIDATION_URL ?? 'https://api.monihel.io/v1/licenses/validate'

    const instanceId = process.env.INSTANCE_ID ?? os.hostname()

    const res = await fetch(validationUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, instanceId }),
        signal: AbortSignal.timeout(10_000),
    })

    const body = (await res.json()) as { valid: boolean; error?: string }
    if (!body.valid) {
        throw new Error(`Invalid license: ${body.error ?? 'check your LICENSE_KEY'}`)
    }

    logger.info('license validated')
}
