import { afterEach, describe, expect, it, vi } from 'vitest'
import fixture from '../../test/fixtures/cpu-search.json'
import { CatalogError, catalogRetryDelay, getCategories, searchProducts, shouldRetryCatalogRequest } from './client'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('catalog client', () => {
  it('encodes trimmed queries, page size and offset, and passes cancellation', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(fixture))
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    const result = await searchProducts({ category: 'cpu', query: ' 9800x3d & AMD ' }, controller.signal)
    const url = new URL(fetchMock.mock.calls[0][0] as string)
    expect(Object.fromEntries(url.searchParams)).toEqual({ category: 'cpu', q: '9800x3d & AMD', limit: '20', offset: '0' })
    expect(result.data[0].name).toBe('AMD Ryzen 7 9800X3D')
    const options = fetchMock.mock.calls[0][1] as RequestInit
    expect(options.credentials).toBe('omit')
    controller.abort()
    expect(options.signal?.aborted).toBe(true)
  })

  it('omits empty q instead of sending an invalid request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(fixture))
    vi.stubGlobal('fetch', fetchMock)
    await searchProducts({ category: 'cpu', query: '   ' })
    expect(new URL(fetchMock.mock.calls[0][0] as string).searchParams.has('q')).toBe(false)
  })

  it('uses and validates the categories endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ categories: ['cpu', 'gpu'] }))
    vi.stubGlobal('fetch', fetchMock)
    expect((await getCategories()).categories).toEqual(['cpu', 'gpu'])
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/v1\/categories$/)
  })

  it.each([400, 429, 500, 503])('maps HTTP %i without exposing raw error bodies', async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('private stack trace', { status, headers: { 'X-Request-ID': 'test-id', 'Retry-After': '30' } })))
    const error = await searchProducts({ category: 'cpu', query: '' }).catch((error: unknown) => error)
    expect(error).toMatchObject({ kind: 'http', status, requestId: 'test-id' })
    expect((error as CatalogError).retryAt).toBeGreaterThan(Date.now() + 28_000)
    expect((error as Error).message).not.toContain('private')
  })

  it('maps network failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await expect(searchProducts({ category: 'cpu', query: '' })).rejects.toMatchObject({ kind: 'network' })
  })

  it('preserves aborts instead of showing them as connection errors', async () => {
    const controller = new AbortController()
    controller.abort()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(controller.signal.reason))
    await expect(searchProducts({ category: 'cpu', query: '' }, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
  })

  it.each(['not json', JSON.stringify({ products: [] })])('rejects invalid JSON/response shape %#', async (body) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)))
    await expect(searchProducts({ category: 'cpu', query: '' })).rejects.toMatchObject({ kind: 'invalid-response' })
  })

  it('rejects results from a different category or page', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(Response.json(fixture))))
    await expect(searchProducts({ category: 'gpu', query: '' })).rejects.toMatchObject({ kind: 'invalid-response' })
    await expect(searchProducts({ category: 'cpu', query: '', offset: 20 })).rejects.toMatchObject({ kind: 'invalid-response' })
  })

  it('limits retries to one transient failure and honors Retry-After', () => {
    const error = new CatalogError('http', { status: 503, retryAt: Date.now() + 30_000 })
    expect(shouldRetryCatalogRequest(0, error)).toBe(true)
    expect(shouldRetryCatalogRequest(1, error)).toBe(false)
    expect(catalogRetryDelay(0, error)).toBeGreaterThan(29_000)
    for (const status of [400, 404, 429, 500]) expect(shouldRetryCatalogRequest(0, new CatalogError('http', { status }))).toBe(false)
    expect(shouldRetryCatalogRequest(0, new CatalogError('invalid-response'))).toBe(false)
    expect(shouldRetryCatalogRequest(0, new CatalogError('http', { status: 503, retryAt: Date.now() + 120_000 }))).toBe(false)
  })
})
