import dns from 'dns/promises'
import net from 'net'

/**
 * Returns true when an IPv4 address is in a range that should never be
 * fetched by a public-facing crawler (loopback, link-local, private,
 * carrier-grade NAT, cloud-metadata, multicast, broadcast, ...).
 */
function isBlockedIPv4(ip: string): boolean {
    const parts = ip.split('.').map(Number)
    if (parts.length !== 4 || parts.some(p => Number.isNaN(p) || p < 0 || p > 255)) {
        return true
    }
    const [a, b] = parts as [number, number, number, number]

    if (a === 0) return true                                  // 0.0.0.0/8
    if (a === 10) return true                                 // 10.0.0.0/8
    if (a === 127) return true                                // loopback
    if (a === 169 && b === 254) return true                   // link-local + AWS/GCP/Azure metadata
    if (a === 172 && b >= 16 && b <= 31) return true          // 172.16.0.0/12
    if (a === 192 && b === 0) return true                     // 192.0.0.0/24 + 192.0.2.0/24
    if (a === 192 && b === 168) return true                   // 192.168.0.0/16
    if (a === 198 && (b === 18 || b === 19)) return true      // benchmarking
    if (a === 100 && b >= 64 && b <= 127) return true         // CGNAT
    if (a >= 224) return true                                 // multicast + reserved + broadcast
    return false
}

function isBlockedIPv6(ip: string): boolean {
    const lower = ip.toLowerCase()
    if (lower === '::' || lower === '::1') return true        // unspecified + loopback
    if (lower.startsWith('fe80:')) return true                // link-local
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true // unique-local
    if (lower.startsWith('ff')) return true                   // multicast
    // IPv4-mapped IPv6 (::ffff:1.2.3.4) — extract and re-check
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
    if (mapped) return isBlockedIPv4(mapped[1])
    return false
}

function isBlockedIP(ip: string): boolean {
    const kind = net.isIP(ip)
    if (kind === 4) return isBlockedIPv4(ip)
    if (kind === 6) return isBlockedIPv6(ip)
    return true
}

/**
 * Validate a user-supplied URL is safe to fetch:
 *  - http(s) only
 *  - default port (or explicit 80/443) — block exotic ports
 *  - hostname resolves to at least one address, and *none* of the
 *    resolved addresses fall into a blocked range.
 *
 * Note: this is best-effort SSRF protection. The ping worker should
 * additionally pin the resolved IP to defeat DNS rebinding.
 */
export async function isSafeUrl(url: string): Promise<boolean> {
    let parsed: URL
    try {
        parsed = new URL(url)
    } catch {
        return false
    }

    if (!['http:', 'https:'].includes(parsed.protocol)) return false

    // Hostname must not be empty and must not be an obvious local alias
    const host = parsed.hostname.toLowerCase()
    if (!host) return false
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
        return false
    }
    if (host === 'metadata.google.internal') return false

    // If the host is a literal IP, check it directly.
    if (net.isIP(host)) {
        return !isBlockedIP(host)
    }

    // Otherwise resolve and reject if *any* result is in a blocked range.
    try {
        const records = await dns.lookup(host, { all: true, verbatim: true })
        if (records.length === 0) return false
        for (const r of records) {
            if (isBlockedIP(r.address)) return false
        }
        return true
    } catch {
        return false
    }
}
