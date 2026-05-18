/**
 * Generate a license key for a buyer after a Gumroad sale.
 *
 * Usage:
 *   npx ts-node scripts/generate-license.ts buyer@email.com
 */
import 'dotenv/config'
import crypto from 'crypto'
import prisma from '../api/src/lib/prisma'

async function generateLicense(buyerEmail: string): Promise<string> {
    const key = [
        'MNHL',
        crypto.randomBytes(4).toString('hex').toUpperCase(),
        crypto.randomBytes(4).toString('hex').toUpperCase(),
        crypto.randomBytes(4).toString('hex').toUpperCase(),
    ].join('-')
    // e.g. MNHL-A3F2B1C4-9D8E7F6A-1B2C3D4E

    await prisma.licenseKey.create({
        data: {
            key,
            buyerEmail,
            isActive: true,
        },
    })

    console.log(`\n✅ License key generated!`)
    console.log(`   Buyer: ${buyerEmail}`)
    console.log(`   Key:   ${key}\n`)
    console.log(`Send this key to the buyer. They set LICENSE_KEY=${key} in their .env`)
    return key
}

const email = process.argv[2]
if (!email) {
    console.error('Usage: npx ts-node scripts/generate-license.ts <buyer-email>')
    process.exit(1)
}

generateLicense(email)
    .catch((err) => {
        console.error('Failed:', err.message)
        process.exit(1)
    })
    .finally(async () => {
        await prisma.$disconnect()
        process.exit(0)
    })
