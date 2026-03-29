// WebSocket gateway
import { Server } from 'socket.io'
import { Server as HttpServer } from 'http'
import { verifyAccessToken } from '../services/authService'
import { redis, redisSubscriber, adapterSubscriber } from '../lib/redis'
import { createAdapter } from '@socket.io/redis-adapter'

export function initWebSocket(httpServer: HttpServer) {
    const io = new Server(httpServer, {
        cors: { origin: process.env.CLIENT_URL, credentials: true }
    })

    // Use dedicated pub + sub connections for the adapter — never reuse redisSubscriber
    io.adapter(createAdapter(redis, adapterSubscriber))

    // Auth middleware
    io.use((socket, next) => {
        const token = socket.handshake.auth.token
        if (!token) return next(new Error('Unauthorized'))  // bug fix: was `if(token)`
        const payload = verifyAccessToken(token)
        if (!payload) return next(new Error('Unauthorized'))
        socket.data.userId = payload.sub
        next()
    })

    io.on('connection', (socket) => {
        const userId = socket.data.userId
        socket.join(`user:${userId}`)
        socket.on('disconnect', () => {
            console.log(`[ws] user=${userId} disconnected`)
        })
    })

    // Subscribe to ping result channel pattern published by the ping worker
    // Channel format: user-events:{userId}
    redisSubscriber.psubscribe('user-events:*', (err) => {
        if (err) console.error('[ws] psubscribe error:', err.message)
        else console.log('[ws] Subscribed to user-events:*')
    })

    // pmessage fires for psubscribe; args: pattern, channel, message
    redisSubscriber.on('pmessage', (_pattern, channel, message) => {
        const userId = channel.split(':')[1]  // bug fix: was [2], channel = 'user-events:{userId}'
        io.to(`user:${userId}`).emit('ping-result', JSON.parse(message))
    })
}