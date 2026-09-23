import { useSyncExternalStore } from 'react'
import { useQuery, type QueryKey } from '@tanstack/react-query'
import { getCategories, getCategoryFilters, getDynamicFacets, getProductOffers, getOffersSummary, searchProducts } from './client'
import { catalogQueryOptions, getCatalogRetryProgressStore } from './query-options'
import { hasSearchConditions, typedConditions, type SearchConditions } from './filters'
import type { SearchParams } from './types'
import type { PartCategory } from '../../domain/categories'

function useCatalogQuery<T>(key: QueryKey, request: (signal: AbortSignal) => Promise<T>, enabled = true) {
  const query = useQuery(catalogQueryOptions(key, request, enabled))
  const store = getCatalogRetryProgressStore(query.failureReason)
  const progress = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  // Success, terminal errors and cancellation end the automatic retry lifecycle.
  return { ...query, retryProgress: enabled && query.fetchStatus !== 'idle' ? progress : null }
}

export function useCatalogCategories() {
  return useCatalogQuery(['catalog', 'categories'], getCategories)
}

export function useProductOffers(productId: number, enabled: boolean) {
  // The row owns this observer and passes it to the panel. No second fetch on open.
  return useQuery({
    ...catalogQueryOptions(['catalog', 'offers', productId], (signal) => getProductOffers(productId, signal), enabled),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  })
}

export const offersSummaryEnabled = import.meta.env.VITE_CATALOG_OFFERS_SUMMARY_ENABLED === 'true'

export function useOffersSummary(productIds: number[]) {
  const ids = [...new Set(productIds)].sort((a, b) => a - b)
  const query = useQuery({
    ...catalogQueryOptions(['catalog', 'offers-summary', ids], (signal) => getOffersSummary(ids, signal), offersSummaryEnabled && ids.length > 0),
    refetchOnWindowFocus: false,
  })
  return { ...query, available: offersSummaryEnabled }
}

export function useProductSearch(params: SearchParams) {
  return useCatalogQuery(['catalog', 'search', params], (signal) => searchProducts(params, signal))
}

export function useCategoryFilters(category: PartCategory, enabled: boolean) {
  return useCatalogQuery(['catalog', 'filters', category], (signal) => getCategoryFilters(category, signal), enabled && category !== 'os')
}

export function useDynamicFacets(category: PartCategory, conditions: SearchConditions | undefined, enabled: boolean) {
  // No committed conditions while editing: detach from the old key immediately so its signal aborts.
  const typed = typedConditions(conditions ?? {})
  return useCatalogQuery(['catalog', 'facets', category, typed], (signal) => getDynamicFacets(category, typed, signal),
    enabled && category !== 'os' && hasSearchConditions(typed))
}
