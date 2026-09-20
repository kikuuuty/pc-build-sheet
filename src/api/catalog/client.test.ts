import { afterEach, describe, expect, it, vi } from 'vitest'
import fixture from '../../test/fixtures/cpu-search.json'
import listingFixture from '../../test/fixtures/cpu-listing.json'
import categories from '../../test/fixtures/categories.json'
import { CatalogError, catalogRetryDelay, getCategories, searchProducts, shouldRetryCatalogRequest } from './client'
import type { SearchParams } from './types'
import { optionalCategories } from '../../domain/categories'
import { optionalProduct } from '../../test/optional-products'

const listing = { ...listingFixture, meta: { ...listingFixture.meta, limit: 20 } }
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('catalog client', () => {
  it.each(optionalCategories)('uses GET listing and keyword search for $id', async ({ id }) => {
    const product = optionalProduct(id)
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ ...fixture, data: [product], meta: { ...fixture.meta, window_limit: null } }))
      .mockResolvedValueOnce(Response.json({ ...fixture, data: [product] }))
    vi.stubGlobal('fetch', fetchMock)
    expect((await searchProducts({ category: id, mode: 'listing' })).data[0]).toEqual(product)
    expect((await searchProducts({ category: id, mode: 'keyword', query: 'test' })).data[0]).toEqual(product)
    expect(Object.fromEntries(new URL(fetchMock.mock.calls[0][0] as string).searchParams)).toEqual({ category: id, limit: '20' })
    expect(Object.fromEntries(new URL(fetchMock.mock.calls[1][0] as string).searchParams)).toEqual({ category: id, limit: '20', q: 'test', offset: '0' })
    for (const [, options] of fetchMock.mock.calls) expect((options as RequestInit).method ?? 'GET').toBe('GET')
  })

  it('encodes trimmed keywords, page size and offset, and passes cancellation', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(fixture))
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    const result = await searchProducts({ category: 'cpu', mode: 'keyword', query: ' 9800x3d & AMD ' }, controller.signal)
    const url = new URL(fetchMock.mock.calls[0][0] as string)
    expect(Object.fromEntries(url.searchParams)).toEqual({ category: 'cpu', q: '9800x3d & AMD', limit: '20', offset: '0' })
    expect(result.data[0].name).toBe('AMD Ryzen 7 9800X3D')
    const options = fetchMock.mock.calls[0][1] as RequestInit
    expect(options.credentials).toBe('omit')
    controller.abort()
    expect(options.signal?.aborted).toBe(true)
  })

  it('follows keyword next_offset without sending a cursor', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ ...fixture, meta: { ...fixture.meta, has_more: true, next_offset: 20 } }))
      .mockResolvedValueOnce(Response.json({ ...fixture, meta: { ...fixture.meta, offset: 20 } }))
    vi.stubGlobal('fetch', fetchMock)
    const first = await searchProducts({ category: 'cpu', mode: 'keyword', query: 'ryzen' })
    await searchProducts({ category: 'cpu', mode: 'keyword', query: 'ryzen', offset: first.meta.next_offset! })
    expect(Object.fromEntries(new URL(fetchMock.mock.calls[1][0] as string).searchParams))
      .toEqual({ category: 'cpu', q: 'ryzen', limit: '20', offset: '20' })
  })

  it('omits both q and offset on the initial listing request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(listing))
    vi.stubGlobal('fetch', fetchMock)
    const result = await searchProducts({ category: 'cpu', mode: 'listing' })
    expect(Object.fromEntries(new URL(fetchMock.mock.calls[0][0] as string).searchParams)).toEqual({ category: 'cpu', limit: '20' })
    expect(result.meta.window_limit).toBeNull()
    expect(result.meta.next_cursor).toBe(listing.meta.next_cursor)
  })

  it('follows opaque next_cursor and accepts offset=0 on subsequent pages', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json(listing))
      .mockResolvedValueOnce(Response.json({ ...listing, meta: { ...listing.meta, next_cursor: null, has_more: false } }))
    vi.stubGlobal('fetch', fetchMock)
    const first = await searchProducts({ category: 'cpu', mode: 'listing' })
    const next = await searchProducts({ category: 'cpu', mode: 'listing', cursor: first.meta.next_cursor! })
    expect(Object.fromEntries(new URL(fetchMock.mock.calls[1][0] as string).searchParams))
      .toEqual({ category: 'cpu', limit: '20', cursor: listing.meta.next_cursor })
    expect(next.meta.offset).toBe(0)
    expect(next.meta.next_cursor).toBeNull()
  })

  it('does not turn an empty keyword and an old offset into an invalid listing request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(searchProducts({ category: 'cpu', mode: 'keyword', query: '   ', offset: 20 })).rejects.toThrow('nonempty query')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('keeps offset and cursor request types mutually exclusive', () => {
    // @ts-expect-error Listings cannot use offsets.
    const offsetListing: SearchParams = { category: 'cpu', mode: 'listing', offset: 20 }
    // @ts-expect-error Keywords cannot use cursors.
    const cursorKeyword: SearchParams = { category: 'cpu', mode: 'keyword', query: 'ryzen', cursor: 'token' }
    expect(offsetListing.mode).toBe('listing')
    expect(cursorKeyword.mode).toBe('keyword')
  })

  it('uses and validates the thirty-category endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(categories))
    vi.stubGlobal('fetch', fetchMock)
    expect(await getCategories()).toEqual(categories)
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/v1\/categories$/)
  })

  it.each([400, 429, 500, 503])('maps HTTP %i without exposing raw error bodies', async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('private stack trace', { status, headers: { 'X-Request-ID': 'test-id', 'Retry-After': '30' } })))
    const error = await searchProducts({ category: 'cpu', mode: 'listing' }).catch((error: unknown) => error)
    expect(error).toMatchObject({ kind: 'http', status, requestId: 'test-id' })
    expect((error as CatalogError).retryAt).toBeGreaterThan(Date.now() + 28_000)
    expect((error as Error).message).not.toContain('private')
  })

  it('maps network failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await expect(searchProducts({ category: 'cpu', mode: 'listing' })).rejects.toMatchObject({ kind: 'network' })
  })

  it('preserves aborts instead of showing them as connection errors', async () => {
    const controller = new AbortController()
    controller.abort()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(controller.signal.reason))
    await expect(searchProducts({ category: 'cpu', mode: 'listing' }, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
  })

  it.each(['not json', JSON.stringify({ products: [] })])('rejects invalid JSON/response shape %#', async (body) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)))
    await expect(searchProducts({ category: 'cpu', mode: 'listing' })).rejects.toMatchObject({ kind: 'invalid-response' })
  })

  it('rejects category mismatches in keyword and cursor searches', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(Response.json(fixture))))
    await expect(searchProducts({ category: 'gpu', mode: 'keyword', query: 'ryzen' })).rejects.toMatchObject({ kind: 'invalid-response' })
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(Response.json(listing))))
    await expect(searchProducts({ category: 'gpu', mode: 'listing' })).rejects.toMatchObject({ kind: 'invalid-response' })
    await expect(searchProducts({ category: 'gpu', mode: 'listing', cursor: 'token' })).rejects.toMatchObject({ kind: 'invalid-response' })
  })

  it('rejects the wrong keyword offset or requested page size', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(fixture)))
    await expect(searchProducts({ category: 'cpu', mode: 'keyword', query: 'ryzen', offset: 20 })).rejects.toMatchObject({ kind: 'invalid-response' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(listingFixture)))
    await expect(searchProducts({ category: 'cpu', mode: 'listing' })).rejects.toMatchObject({ kind: 'invalid-response' })
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
