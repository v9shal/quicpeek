// test.ts
import { AuthType } from '@prisma/client'
import { pingEndpoint } from './pingService'

;(async () => {
    const result = await pingEndpoint(
        'https://httpstat.us/200',  // always returns 200
        AuthType.NONE,
        null
    )
    console.log(result)
    // { status: 'UP', statusCode: 200, responseTimeMs: 243 }

    const result2 = await pingEndpoint(
        'https://httpstat.us/503',  // always returns 503
        AuthType.NONE,
        null
    )
    console.log(result2)
    // { status: 'DOWN', statusCode: 503, responseTimeMs: 189 }
})()