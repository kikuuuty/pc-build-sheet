import type { OfferSummary } from '../../api/catalog/types'
import { MAX_PRICE } from '../build/schemas'

export type SearchPriceState =
  | { status: 'ready'; price: number }
  | { status: 'loading' | 'empty' | 'error' | 'unavailable' }

export function searchPriceState(summary: OfferSummary | undefined, query: { available: boolean; isPending: boolean; isError: boolean }): SearchPriceState {
  if (!query.available) return { status: 'unavailable' }
  if (query.isError || summary?.status === 'error') return { status: 'error' }
  if (query.isPending || summary?.status === 'pending') return { status: 'loading' }
  if (summary?.status === 'complete' && summary.lowest_price !== null) return { status: 'ready', price: summary.lowest_price }
  return { status: 'empty' }
}

// Prices outside the existing editor's range must not make a product unselectable.
export function initialSearchPrice(state: SearchPriceState): number | null {
  return state.status === 'ready' && state.price <= MAX_PRICE ? state.price : null
}
