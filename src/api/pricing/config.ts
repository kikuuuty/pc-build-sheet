export type PricingConfig = { status: 'disabled' | 'invalid' } | { status: 'enabled'; baseUrl: string }
export const isLoopback = (host: string) => host === 'localhost' || host === '[::1]' || /^127(?:\.\d{1,3}){3}$/.test(host)

// Runtime page location, not import.meta.env.DEV: local production preview is supported.
// HTTP requires BOTH the page and the Gateway to be loopback. Remote builds require HTTPS.
export function pricingConfig(enabled: unknown, base: unknown, pageHostname: string): PricingConfig {
  if (enabled !== 'true') return { status: 'disabled' }
  if (typeof base !== 'string' || !/^https?:\/\//.test(base) || /[\s\\]/.test(base)) return { status: 'invalid' }
  try {
    const url = new URL(base)
    if (url.username || url.password || /:\/\/[^/]*@/.test(base) || url.search || url.hash || base.includes('?') || base.includes('#')
      || (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback(url.hostname) && isLoopback(pageHostname)))) {
      return { status: 'invalid' }
    }
    return { status: 'enabled', baseUrl: url.href.replace(/\/$/, '') }
  } catch { return { status: 'invalid' } }
}
export function readPricingConfig() {
  return pricingConfig(import.meta.env.VITE_PRICING_ENABLED, import.meta.env.VITE_PRICING_API_BASE_URL,
    typeof location === 'undefined' ? '' : location.hostname)
}
