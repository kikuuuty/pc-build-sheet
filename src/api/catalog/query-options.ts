import { queryOptions, type QueryKey } from '@tanstack/react-query'
import { CatalogError, catalogRetryDelay, shouldRetryCatalogRequest } from './client'

export type CatalogRetryProgress = { phase: 'waiting'; retryAt: number } | { phase: 'retrying' }

function createRetryProgress(retryAt: number) {
  let snapshot: CatalogRetryProgress = { phase: 'waiting', retryAt }
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    start: () => {
      snapshot = { phase: 'retrying' }
      listeners.forEach((listener) => listener())
    },
  }
}

// Retry progress belongs to the failed attempt, not a component or a timer. All observers
// of the same cached query share it; changing keys cannot inherit another query's progress.
const retryProgress = new WeakMap<Error, ReturnType<typeof createRetryProgress>>()
const noRetryProgress = { getSnapshot: () => null, subscribe: () => () => {} }

export function getCatalogRetryProgressStore(error: Error | null) {
  return error ? retryProgress.get(error) ?? noRetryProgress : noRetryProgress
}

export function catalogQueryOptions<T>(queryKey: QueryKey, request: (signal: AbortSignal) => Promise<T>, enabled = true) {
  return queryOptions({
    queryKey,
    queryFn: ({ client, signal }) => {
      const failure = client.getQueryState(queryKey)?.fetchFailureReason
      if (failure) retryProgress.get(failure)?.start()
      return request(signal)
    },
    enabled,
    staleTime: 60_000,
    retry: shouldRetryCatalogRequest,
    retryDelay: (attempt, error) => {
      const delay = catalogRetryDelay(attempt, error)
      // React Query calls retryDelay even for terminal failures. Only announce a retry
      // that will actually be scheduled, using its exact backoff (including jitter).
      if (error instanceof CatalogError && error.status === 429 && shouldRetryCatalogRequest(attempt, error)) {
        retryProgress.set(error, createRetryProgress(Date.now() + delay))
      }
      return delay
    },
  })
}
