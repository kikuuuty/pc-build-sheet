import { useQuery } from '@tanstack/react-query'
import { catalogRetryDelay, getCategories, searchProducts, shouldRetryCatalogRequest } from './client'
import type { SearchParams } from './types'

const queryPolicy = {
  staleTime: 60_000,
  retry: shouldRetryCatalogRequest,
  retryDelay: catalogRetryDelay,
}

export function useCatalogCategories() {
  return useQuery({
    queryKey: ['catalog', 'categories'],
    queryFn: ({ signal }) => getCategories(signal),
    ...queryPolicy,
  })
}

export function useProductSearch(params: SearchParams) {
  return useQuery({
    queryKey: ['catalog', 'search', params],
    queryFn: ({ signal }) => searchProducts(params, signal),
    ...queryPolicy,
  })
}
