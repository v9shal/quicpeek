import axios, { AxiosError, AxiosRequestConfig } from 'axios'
import { decrypt } from '../../api/src/utils/encryption'
import { AuthType } from '@prisma/client'
export interface PingResult {
    status: 'UP' | 'DOWN' | 'TIMEOUT'
    statusCode: number | null
    responseTimeMs: number
}
export async function pingEndpoint(
    url: string,
    authType: AuthType,
    encryptedAuthValue: string | null
): Promise<PingResult> {
    const start = Date.now()

    const headers: Record<string, string> = {}

    if (authType !== AuthType.NONE && encryptedAuthValue) {
        const authValue = decrypt(encryptedAuthValue)

        if (authType === AuthType.BEARER) {
            headers['Authorization'] = `Bearer ${authValue}`
        }

      if (authType === AuthType.API_KEY) {
    const colonIndex = authValue.indexOf(':')
    const headerName = authValue.substring(0, colonIndex)
    const headerValue = authValue.substring(colonIndex + 1)
    headers[headerName] = headerValue
}

        if (authType === AuthType.BASIC) {
            const encoded = Buffer.from(authValue).toString('base64')
            headers['Authorization'] = `Basic ${encoded}`
        }
    }

    const config: AxiosRequestConfig = {
        timeout: 10000,
        headers,
        maxRedirects: 0,
        validateStatus: () => true
    }

    try {
        const response = await axios.get(url, config)
        const responseTimeMs = Date.now() - start

        return {
            status: response.status < 400 ? 'UP' : 'DOWN',
            statusCode: response.status,
            responseTimeMs
        }

    } catch (err) {
        const responseTimeMs = Date.now() - start
        const error = err as AxiosError

        if (error.code === 'ECONNABORTED') {
            return { status: 'TIMEOUT', statusCode: null, responseTimeMs }
        }

        return {
            status: 'DOWN',
            statusCode: error.response?.status ?? null,
            responseTimeMs
        }
    }
}