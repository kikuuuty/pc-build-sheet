import { useQuery } from '@tanstack/react-query'
import { catalogRetryDelay, getCategories, getCategoryFilters, getDynamicFacets, searchProducts, shouldRetryCatalogRequest } from './client'
import { typedConditions, type SearchConditions } from './filters'
import type { SearchParams } from './types'
import type { PartCategory } from '../../domain/categories'

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

export function useCategoryFilters(category: PartCategory, enabled: boolean) {
  return useQuery({
    queryKey: ['catalog', 'filters', category],
    queryFn: ({ signal }) => getCategoryFilters(category, signal),
    enabled: enabled && category !== 'os',
    ...queryPolicy,
  })
}

export function useDynamicFacets(category: PartCategory, conditions: SearchConditions, enabled: boolean) {
  const typed = typedConditions(conditions)
  return useQuery({
    queryKey: ['catalog', 'facets', category, typed],
    queryFn: ({ signal }) => getDynamicFacets(category, typed, signal),
    enabled: enabled && category !== 'os',
    ...queryPolicy,
  })
}
