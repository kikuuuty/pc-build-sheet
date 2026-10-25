import { isOld, type PriceSummary } from '../../api/pricing/schemas'
import { MAX_PRICE } from '../build/schemas'

export type SearchPriceState =
  | { status: 'ready'; price: number; stale: boolean; fetchedAt: string | null; failed: boolean }
  | { status: 'loading' | 'pending' | 'empty' | 'unsupported' | 'missing' | 'error' | 'disabled' | 'invalid'; stale?: boolean; failed?: boolean }

export function searchPriceState(summary: PriceSummary | undefined, query: { availability: 'enabled' | 'disabled' | 'invalid'; isPending: boolean; isError: boolean }): SearchPriceState {
  if (query.availability !== 'enabled') return { status: query.availability }
  if (!summary) return { status: query.isError ? 'error' : 'loading' }
  if (summary.status === 'complete') return summary.price === null ? { status: 'error' } : {
    status: 'ready', price: summary.price, stale: isOld(summary), fetchedAt: summary.fetchedAt, failed: query.isError,
  }
  return { status: summary.status, stale: isOld(summary), failed: query.isError }
}

// Prices outside the existing editor's range must not make a product unselectable.
export function initialSearchPrice(state: SearchPriceState): number | null {
  return state.status === 'ready' && !state.failed && state.price <= MAX_PRICE ? state.price : null
}
