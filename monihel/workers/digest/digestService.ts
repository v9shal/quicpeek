// Batch email logic
import nodemailer from 'nodemailer'
import prisma from '../../api/src/lib/prisma'

const transporter = nodemailer.createTransport({
    host:   process.env.SMTP_HOST   ?? 'smtp.ethereal.email',
    port:   parseInt(process.env.SMTP_PORT ?? '587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
    },
})


interface DigestRow {
    id:           string
    userId:       string
    endpointId:   string
    endpointName: string
    endpointUrl:  string
    alertId:      string
    createdAt:    Date
}


export async function runDigest(): Promise<void> {
// Fetch all PENDING AlertDigest rows with their endpoint data
    const pending = await prisma.alertDigest.findMany({
        where: { status: 'PENDING' },
        include: {
            endpoint: { select: { name: true, url: true } },
        },
        orderBy: { createdAt: 'asc' },
    })

    if (pending.length === 0) {
        console.log('[digest] No PENDING rows — nothing to send')
        return
    }

    console.log(`[digest] Found ${pending.length} PENDING rows`)

    // Resolve userId → email via NotificationChannel (default) or User.email
    const userIds = [...new Set(pending.map(r => r.userId))]

    const users = await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: {
            id:    true,
            email: true,
            notificationChannels: {
                where:  { isDefault: true, type: 'EMAIL' },
                select: { target: true },
                take:   1,
            },
        },
    })

    const emailByUserId = new Map(
        users.map(u => [
            u.id,
            u.notificationChannels[0]?.target ?? u.email, 
        ])
    )

    // Group PENDING rows by userId
    const byUser = new Map<string, DigestRow[]>()
    for (const row of pending) {
        const list = byUser.get(row.userId) ?? []
        list.push({
            id:           row.id,
            userId:       row.userId,
            endpointId:   row.endpointId,
            endpointName: row.endpoint.name,
            endpointUrl:  row.endpoint.url,
            alertId:      row.alertId,
            createdAt:    row.createdAt,
        })
        byUser.set(row.userId, list)
    }

    // For each user — send email, then mark rows SENT in a transaction.
    //        Partial failure: if email send throws, the transaction is skipped;
    //        rows stay PENDING and will be retried on the next cron tick.
    const sentAt = new Date()

    for (const [userId, rows] of byUser) {
        const toEmail = emailByUserId.get(userId)
        if (!toEmail) {
            console.warn(`[digest] No email found for userId=${userId} — skipping`)
            continue
        }

        try {
        // send one consolidated email for this user
            await sendDigestEmail(toEmail, rows)

            // mark rows SENT only after email succeeded
            await prisma.$transaction(
                rows.map(row =>
                    prisma.alertDigest.update({
                        where: { id: row.id },
                        data:  { status: 'SENT', sentAt },
                    })
                )
            )

            console.log(`[digest] Sent digest to ${toEmail} (${rows.length} alerts) — marked SENT`)
        } catch (err: any) {
            console.error(`[digest] Failed for userId=${userId} (${toEmail}):`, err.message)
        }
    }
}


async function sendDigestEmail(to: string, rows: DigestRow[]): Promise<void> {
    const endpointLines = rows
        .map(r => `  • ${r.endpointName} — ${r.endpointUrl}  (since ${r.createdAt.toUTCString()})`)
        .join('\n')

    const text = [
        `Monihel Alert Digest`,
        ``,
        `The following ${rows.length} endpoint(s) are currently DOWN or TIMEOUT:`,
        ``,
        endpointLines,
        ``,
        `Log in to your dashboard to investigate or mute these alerts.`,
    ].join('\n')

    const html = `
        <h2>Monihel Alert Digest</h2>
        <p>The following <strong>${rows.length}</strong> endpoint(s) are currently <strong>DOWN</strong> or <strong>TIMEOUT</strong>:</p>
        <table border="1" cellpadding="8" cellspacing="0" style="border-collapse:collapse;font-family:monospace">
            <thead>
                <tr><th>Endpoint</th><th>URL</th><th>Since</th></tr>
            </thead>
            <tbody>
                ${rows.map(r => `
                <tr>
                    <td>${r.endpointName}</td>
                    <td><a href="${r.endpointUrl}">${r.endpointUrl}</a></td>
                    <td>${r.createdAt.toUTCString()}</td>
                </tr>`).join('')}
            </tbody>
        </table>
        <p>Log in to your dashboard to investigate or mute these alerts.</p>
    `

    await transporter.sendMail({
        from:    process.env.SMTP_FROM ?? 'alerts@monihel.dev',
        to,
        subject: `[Monihel] ${rows.length} endpoint(s) need your attention`,
        text,
        html,
    })
}
