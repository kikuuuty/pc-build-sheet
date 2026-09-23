import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { onlineManager, QueryClient } from '@tanstack/react-query'
import { CatalogError } from './client'
import { catalogQueryOptions, getCatalogRetryProgressStore } from './query-options'

let client: QueryClient
beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(Math, 'random').mockReturnValue(0.5)
  client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } })
  client.mount()
})
afterEach(() => {
  client.clear()
  client.unmount()
  onlineManager.setOnline(true)
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('catalog automatic retry progress', () => {
  it.each([30_000, 0])('uses the actual scheduled delay and marks only the real request as retrying (Retry-After: %i)', async (wait) => {
    const now = Date.now()
    const delay = wait || 1150 // Same jitter/backoff as the scheduler, even without Retry-After.
    const error = new CatalogError('http', { status: 429, retryAt: wait ? now + wait : 0 })
    let release!: (data: string) => void
    const request = vi.fn<(signal: AbortSignal) => Promise<string>>()
      .mockRejectedValueOnce(error).mockImplementationOnce(() => new Promise((resolve) => { release = resolve }))
    const options = catalogQueryOptions(['progress'], request)
    const pending = client.fetchQuery(options)
    // A second consumer shares the same request and retry progress.
    const shared = client.fetchQuery(options)
    await vi.advanceTimersByTimeAsync(0)
    const store = getCatalogRetryProgressStore(client.getQueryState(options.queryKey)!.fetchFailureReason)
    expect(store).toBe(getCatalogRetryProgressStore(error))
    expect(store.getSnapshot()).toEqual({ phase: 'waiting', retryAt: now + delay })
    const notified = vi.fn()
    const unsubscribe = store.subscribe(notified)
    await vi.advanceTimersByTimeAsync(delay - 1)
    expect(request).toHaveBeenCalledTimes(1)
    expect(store.getSnapshot()?.phase).toBe('waiting')
    await vi.advanceTimersByTimeAsync(1)
    expect(request).toHaveBeenCalledTimes(2)
    expect(store.getSnapshot()).toEqual({ phase: 'retrying' })
    expect(notified).toHaveBeenCalledTimes(1)
    // React Query still retains the original 429 during the held retry request.
    expect(client.getQueryState(options.queryKey)?.fetchFailureReason).toBe(error)
    release('ok')
    expect(await pending).toBe('ok')
    expect(await shared).toBe('ok')
    expect(client.getQueryState(options.queryKey)).toMatchObject({ fetchStatus: 'idle', fetchFailureReason: null })
    expect(await client.fetchQuery(options)).toBe('ok')
    expect(request).toHaveBeenCalledTimes(2)
    unsubscribe()
  })

  it('does not claim to be retrying merely because the deadline passed while offline', async () => {
    const error = new CatalogError('http', { status: 429, retryAt: Date.now() + 30_000 })
    const request = vi.fn().mockRejectedValueOnce(error).mockResolvedValueOnce('ok')
    const options = catalogQueryOptions(['offline'], request)
    const pending = client.fetchQuery(options)
    await vi.advanceTimersByTimeAsync(0)
    onlineManager.setOnline(false)
    await vi.advanceTimersByTimeAsync(31_000)
    expect(request).toHaveBeenCalledTimes(1)
    expect(client.getQueryState(options.queryKey)?.fetchStatus).toBe('paused')
    expect(getCatalogRetryProgressStore(error).getSnapshot()?.phase).toBe('waiting')
    onlineManager.setOnline(true)
    expect(await pending).toBe('ok')
    expect(request).toHaveBeenCalledTimes(2)
    expect(getCatalogRetryProgressStore(error).getSnapshot()?.phase).toBe('retrying')
  })

  it('does not announce or schedule an automatic retry for a wait over 60 seconds', async () => {
    const error = new CatalogError('http', { status: 429, retryAt: Date.now() + 61_000 })
    const request = vi.fn().mockRejectedValue(error)
    await expect(client.fetchQuery(catalogQueryOptions(['long'], request))).rejects.toBe(error)
    expect(getCatalogRetryProgressStore(error).getSnapshot()).toBeNull()
    await vi.advanceTimersByTimeAsync(120_000)
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('ends the lifecycle on a second 429 without announcing another automatic retry', async () => {
    const first = new CatalogError('http', { status: 429, retryAt: Date.now() + 30_000 })
    const last = new CatalogError('http', { status: 429, retryAt: Date.now() + 60_000 })
    const request = vi.fn().mockRejectedValueOnce(first).mockRejectedValueOnce(last)
    const options = catalogQueryOptions(['exhausted'], request)
    const pending = client.fetchQuery(options).catch((error: Error) => error)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(await pending).toBe(last)
    expect(client.getQueryState(options.queryKey)).toMatchObject({ fetchStatus: 'idle', status: 'error', fetchFailureReason: last })
    expect(getCatalogRetryProgressStore(last).getSnapshot()).toBeNull()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('cancels a scheduled retry and does not leak its progress into other keys', async () => {
    const error = new CatalogError('http', { status: 429, retryAt: Date.now() + 30_000 })
    const request = vi.fn().mockRejectedValue(error)
    const options = catalogQueryOptions(['old'], request)
    const pending = client.fetchQuery(options).catch((caught: Error) => caught)
    await vi.advanceTimersByTimeAsync(0)
    await client.cancelQueries({ queryKey: options.queryKey })
    await pending
    expect(await client.fetchQuery(catalogQueryOptions(['new'], async () => 'new results'))).toBe('new results')
    expect(getCatalogRetryProgressStore(client.getQueryState(['new'])!.fetchFailureReason).getSnapshot()).toBeNull()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(client.getQueryState(options.queryKey)?.fetchStatus).toBe('idle')
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('keeps transient retries without showing a rate-limit notice for non-429 errors', async () => {
    const error = new CatalogError('http', { status: 503 })
    const request = vi.fn().mockRejectedValueOnce(error).mockResolvedValueOnce('ok')
    const pending = client.fetchQuery(catalogQueryOptions(['unavailable'], request))
    await vi.advanceTimersByTimeAsync(0)
    expect(getCatalogRetryProgressStore(error).getSnapshot()).toBeNull()
    await vi.advanceTimersByTimeAsync(1150)
    expect(await pending).toBe('ok')
    expect(request).toHaveBeenCalledTimes(2)
  })
})
