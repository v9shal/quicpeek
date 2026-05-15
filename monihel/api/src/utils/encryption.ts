import crypto from 'crypto'
import { env } from '../config/env'

/**
 * Authenticated encryption using AES-256-GCM.
 *
 * Output format: `gcm:<iv-hex>:<tag-hex>:<ciphertext-hex>`
 *
 * For backward compatibility, decrypt() still accepts the legacy
 * AES-256-CBC format (`<iv-hex>:<ciphertext-hex>`) so values stored
 * before this change keep working. New values are always written
 * in the GCM format.
 */

const KEY_LEN = 32
const IV_LEN = 12      // 96-bit IV is the GCM recommendation
const VERSION = 'gcm'

function getKey(): Buffer {
    const key = Buffer.from(env.ENCRYPTION_KEY, 'hex')
    if (key.length !== KEY_LEN) {
        throw new Error(`ENCRYPTION_KEY must be ${KEY_LEN} bytes (${KEY_LEN * 2} hex chars)`)
    }
    return key
}

export function encrypt(plaintext: string): string {
    const iv = crypto.randomBytes(IV_LEN)
    const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv)
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
    const tag = cipher.getAuthTag()
    return `${VERSION}:${iv.toString('hex')}:${tag.toString('hex')}:${ciphertext.toString('hex')}`
}

export function decrypt(payload: string): string {
    const parts = payload.split(':')

    // New format: gcm:iv:tag:ciphertext
    if (parts.length === 4 && parts[0] === VERSION) {
        const [, ivHex, tagHex, dataHex] = parts
        const iv = Buffer.from(ivHex, 'hex')
        const tag = Buffer.from(tagHex, 'hex')
        const data = Buffer.from(dataHex, 'hex')
        const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), iv)
        decipher.setAuthTag(tag)
        return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
    }

    // Legacy format: iv:ciphertext (AES-256-CBC). Kept only for backward compat.
    if (parts.length === 2) {
        const [ivHex, dataHex] = parts
        const iv = Buffer.from(ivHex, 'hex')
        const data = Buffer.from(dataHex, 'hex')
        const decipher = crypto.createDecipheriv('aes-256-cbc', getKey(), iv)
        return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
    }

    throw new Error('Invalid encrypted payload format')
}