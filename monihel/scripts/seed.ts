/**
 * Seed script — creates a demo user with 3 monitored endpoints.
 *
 * Usage:
 *   npx ts-node scripts/seed.ts
 *   # or inside Docker:
 *   docker compose exec api npx ts-node scripts/seed.ts
 */
import 'dotenv/config'
import bcrypt from 'bcrypt'
import { PrismaClient, Priority } from '@prisma/client'

const prisma = new PrismaClient()

const DEMO_EMAIL    = 'demo@monihel.local'
const DEMO_USERNAME = 'demo'
const DEMO_PASSWORD = 'Demo1234!'            // plain text — hashed below
const SALT_ROUNDS   = 12

const DEMO_ENDPOINTS = [
    {
        name: 'GitHub Status',
        url: 'https://www.githubstatus.com/api/v2/status.json',
        checkIntervalSec: 120,
        priority: Priority.CRITICAL,
    },
    {
        name: 'JSONPlaceholder',
        url: 'https://jsonplaceholder.typicode.com/posts/1',
        checkIntervalSec: 300,
        priority: Priority.MEDIUM,
    },
    {
        name: 'HTTPBin GET',
        url: 'https://httpbin.org/get',
        checkIntervalSec: 600,
        priority: Priority.LOW,
    },
]

async function main() {
    console.log(' Seeding database...')

    const hash = await bcrypt.hash(DEMO_PASSWORD, SALT_ROUNDS)

    const user = await prisma.user.upsert({
        where: { email: DEMO_EMAIL },
        update: {},
        create: {
            email: DEMO_EMAIL,
            username: DEMO_USERNAME,
            name: 'Demo User',
            password: hash,
        },
    })

    console.log(`  ✔ User: ${user.email} (id: ${user.id})`)

    for (const ep of DEMO_ENDPOINTS) {
        const endpoint = await prisma.endpoint.upsert({
            where: { userId_url: { userId: user.id, url: ep.url } },
            update: {},
            create: {
                name: ep.name,
                url: ep.url,
                checkIntervalSec: ep.checkIntervalSec,
                priority: ep.priority,
                userId: user.id,
            },
        })
        console.log(`  ✔ Endpoint: ${endpoint.name} (${endpoint.id})`)
    }

    console.log('\n✅ Seed complete!')
    console.log(`   Login with:  email=${DEMO_EMAIL}  password=${DEMO_PASSWORD}`)
}

main()
    .catch((err) => {
        console.error('Seed failed:', err)
        process.exit(1)
    })
    .finally(() => prisma.$disconnect())
