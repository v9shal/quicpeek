import crypto from 'crypto'

function getKey(): Buffer {
    const key = process.env.ENCRYPTION_KEY
    if (!key) throw new Error('ENCRYPTION_KEY environment variable is not set')
    return Buffer.from(key, 'hex')
}

export function encrypt(text: string): string {
    const iv = crypto.randomBytes(16)
    const cipher = crypto.createCipheriv('aes-256-cbc', getKey(), iv)
    const encrypted = Buffer.concat([cipher.update(text), cipher.final()])
    return iv.toString('hex') + ':' + encrypted.toString('hex')
}

export function decrypt(text: string): string {
    const [iv, encrypted] = text.split(':')
    const decipher = crypto.createDecipheriv('aes-256-cbc', getKey(), Buffer.from(iv, 'hex'))
    return Buffer.concat([
        decipher.update(Buffer.from(encrypted, 'hex')),
        decipher.final()
    ]).toString()
}