// api/src/index.ts
import http from 'http'
import app from './app'
import { initWebSocket } from './websocket/gateway'
import { disconnectRedis } from './lib/redis'

const httpServer = http.createServer(app)
initWebSocket(httpServer)

httpServer.listen(4000, () => {
    console.log('Server running on port 4000')
})

const shutdown = (signal: string) => {
    console.log(`\n[${signal}] Shutting down...`)
    httpServer.close(async () => {
        await disconnectRedis()
        process.exit(0)
    })
    // Force exit if cleanup takes too long
    setTimeout(() => process.exit(1), 3000)
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
// nodemon sends SIGUSR2 on restart
process.once('SIGUSR2', () => {
    shutdown('SIGUSR2')
})