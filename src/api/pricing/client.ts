import { productRefSchema, responseSchema, refKey, normalizeRefs, type ProductRef, type PriceSummary } from './schemas'

export const REQUEST_TIMEOUT_MS = 15_000
export class PricingError extends Error {
  readonly kind: 'input' | 'network' | 'timeout' | 'http' | 'schema'
  readonly status?: number
  readonly retryAt: number
  constructor(kind: PricingError['kind'], status?: number, retryAt = 0) {
    super(`Pricing request failed: ${kind}`)
    this.name = 'PricingError'
    this.kind = kind
    this.status = status
    this.retryAt = retryAt
  }
}
export function retryAfter(value: string | null, now = Date.now()): number {
  if (!value?.trim()) return 0
  if (/^\d+(?:\.\d+)?$/.test(value.trim())) {
    const result = now + Number(value) * 1000
    return Number.isFinite(result) ? result : 0
  }
  if (!/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/i.test(value.trim())) return 0
  const date = Date.parse(value)
  return Number.isFinite(date) ? Math.max(now, date) : 0
}
export function isTransient(error: unknown) {
  return error instanceof PricingError && (['network', 'timeout'].includes(error.kind)
    || (error.status !== undefined && [429, 502, 503, 504].includes(error.status)))
}
export function validateRefs(refs: ProductRef[]) {
  if (!Array.isArray(refs) || refs.length > 100 || refs.some((ref) => !productRefSchema.safeParse(ref).success)) throw new PricingError('input')
  return normalizeRefs(refs)
}
export async function getPriceSummaries(baseUrl: string, input: ProductRef[], signal?: AbortSignal): Promise<PriceSummary[]> {
  const refs = validateRefs(input)
  if (!refs.length) return []
  const controller = new AbortController()
  const abort = () => controller.abort(signal?.reason)
  if (signal?.aborted) abort()
  else signal?.addEventListener('abort', abort, { once: true })
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; controller.abort() }, REQUEST_TIMEOUT_MS)
  // The deadline includes JSON/body reading, even with a stalled stream.
  const cancelled = new Promise<never>((_, reject) => {
    const fail = () => reject(signal?.aborted ? signal.reason : new PricingError('timeout'))
    if (controller.signal.aborted) fail()
    else controller.signal.addEventListener('abort', fail, { once: true })
  })
  const request = async () => {
    let response: Response
    try {
      response = await fetch(`${baseUrl}/v1/prices/summary`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'omit',
        redirect: 'error', signal: controller.signal, body: JSON.stringify({ products: refs }),
      })
    } catch (error) {
      if (signal?.aborted) throw signal.reason
      if (timedOut) throw new PricingError('timeout')
      throw error instanceof PricingError ? error : new PricingError('network')
    }
    if (!response.ok) throw new PricingError('http', response.status,
      retryAfter(response.headers.get('Retry-After')) || (response.status === 429 ? Date.now() + 60_000 : 0))
    let json: unknown
    try { json = await response.json() } catch {
      if (signal?.aborted) throw signal.reason
      throw new PricingError(timedOut ? 'timeout' : 'schema')
    }
    const parsed = responseSchema.safeParse(json)
    if (!parsed.success || parsed.data.data.length !== refs.length
      || parsed.data.data.some((row, i) => refKey(row) !== refKey(refs[i]))) throw new PricingError('schema')
    return parsed.data.data.map(({ source, upstream_key, providers: { yahoo: s } }) => ({
      source, upstream_key, status: s.status, price: s.lowest_price, fetchedAt: s.fetched_at,
      expiresAt: s.expires_at, stale: s.stale, attribution: 'Yahoo!ショッピング',
    }))
  }
  try { return await Promise.race([request(), cancelled]) } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
  }
}
