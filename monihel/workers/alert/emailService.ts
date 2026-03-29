// Recovery email sending
import nodemailer from 'nodemailer'
import prisma from '../../api/src/lib/prisma'
import redis from '../../api/src/services/redis'
import type { Endpoint } from '@prisma/client'

const transporter = nodemailer.createTransport({
    host:   process.env.SMTP_HOST   ?? 'smtp.ethereal.email',
    port:   parseInt(process.env.SMTP_PORT ?? '587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
    },
})

interface RecoveryEmailInput {
    userId:     string
    endpointId: string
    alertId:    string
}

async function getEndpoint(endpointId: string): Promise<Endpoint | null> {
    const cached = await redis.get(`endpoint:config:${endpointId}`)
    if (cached) return JSON.parse(cached) as Endpoint

    const endpoint = await prisma.endpoint.findUnique({ where: { id: endpointId } })
    if (endpoint) {
        await redis.setex(`endpoint:config:${endpointId}`, 300, JSON.stringify(endpoint))
    }
    return endpoint
}

export async function sendRecoveryEmail(input: RecoveryEmailInput): Promise<void> {
    const { userId, endpointId } = input

    // 3. Fetch user — prefer custom notification channel, fall back to account email
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
            email: true,
            notificationChannels: {
                where:  { isDefault: true, type: 'EMAIL' },
                select: { target: true },
                take:   1,
            },
        },
    })

    if (!user) {
        console.warn(`[alert:email] userId=${userId} not found — skipping`)
        return
    }

    const toEmail = user.notificationChannels[0]?.target ?? user.email

    // 4. Fetch endpoint from Redis cache or DB
    const endpoint = await getEndpoint(endpointId)
    if (!endpoint) {
        console.warn(`[alert:email] endpointId=${endpointId} not found — skipping`)
        return
    }

    // 5. Send recovery email immediately — no batching, one job one email
    const text = [
        `Endpoint Recovered`,
        ``,
        `Good news! The following endpoint is back UP:`,
        ``,
        `  Name : ${endpoint.name}`,
        `  URL  : ${endpoint.url}`,
        ``,
        `Monihel will continue monitoring it going forward.`,
    ].join('\n')

    const html = `
        <h2>&#9989; Endpoint Recovered</h2>
        <p>Good news! The following endpoint is back <strong>UP</strong>:</p>
        <table border="1" cellpadding="8" cellspacing="0" style="border-collapse:collapse;font-family:monospace">
            <tr><th>Name</th><td>${endpoint.name}</td></tr>
            <tr><th>URL</th><td><a href="${endpoint.url}">${endpoint.url}</a></td></tr>
        </table>
        <p>Monihel will continue monitoring it going forward.</p>
    `

    await transporter.sendMail({
        from:    process.env.SMTP_FROM ?? 'alerts@monihel.dev',
        to:      toEmail,
        subject: `[Monihel] ${endpoint.name} is back UP`,
        text,
        html,
    })

    console.log(`[alert:email] Recovery email sent to ${toEmail} for endpoint=${endpoint.name}`)
}
