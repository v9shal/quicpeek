export function isSafeUrl(url: string): boolean {
    let parsed: URL
    try {
        parsed = new URL(url)
    } catch {
        return false
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) return false
    const BLOCKED = [
        /^127\./,
        /^10\./,
        /^172\.(1[6-9]|2[0-9]|3[01])\./,
        /^192\.168\./,
        /^169\.254\./,
        /^0\.0\.0\.0$/,
        /^::1$/,
        /^localhost$/i
    ]
    return !BLOCKED.some(r => r.test(parsed.hostname))
}
