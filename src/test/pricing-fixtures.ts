import fixtures from './fixtures/gateway-http.json' with { type: 'json' }
import type { ProductRef, Summary } from '../api/pricing/schemas'

export function pricingRow(ref: ProductRef = fixtures.request.products[0], status: Summary['status'] = 'complete', patch: Record<string, unknown> = {}) {
  const name = status === 'complete' ? 'fresh-complete' : status
  const summary = fixtures[name].data[0].providers.yahoo
  return { source: ref.source, upstream_key: ref.upstream_key, providers: { yahoo: {
    ...summary, expires_at: '2099-01-01T00:00:00.000Z', ...patch,
  } } }
}
export const pricingResponse = (refs: ProductRef[], status: Summary['status'] = 'complete', patch: Record<string, unknown> = {}) => ({
  ok: true, data: refs.map((ref) => pricingRow(ref, status, patch)),
})
