import { afterEach, describe, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import fixture from '../../test/fixtures/cpu-search.json'
import listingFixture from '../../test/fixtures/cpu-listing.json'
import categories from '../../test/fixtures/categories.json'
import { CatalogError, catalogRetryDelay, getCategories, getCategoryFilters, getDynamicFacets, searchProducts, shouldRetryCatalogRequest } from './client'
import { cpuFacets, cpuFilters } from '../../test/filter-fixtures'
import type { SearchParams } from './types'
import { optionalCategories } from '../../domain/categories'
import { optionalProduct } from '../../test/optional-products'

const listing = { ...listingFixture, meta: { ...listingFixture.meta, limit: 20 } }
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('catalog client', () => {
  it('POSTs only typed conditions to facets, omits credentials and forwards cancellation', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(Response.json(cpuFacets())))
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    const input = { filters: { includes_cooler: [0] }, ranges: { core_count: { min: 6 } }, facets: { socket: ['AM5'] },
      keyword: '9800X3D', orderBy: 'name', limit: 20, offset: 0, cursor: 'x', include: ['specs'], identifier: 'x' }
    expect(await getDynamicFacets('cpu', input, controller.signal)).toEqual(cpuFacets())
    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toMatch(/\/v1\/categories\/cpu\/facets$/)
    expect(options).toMatchObject({ method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' } })
    expect(JSON.parse(options.body)).toEqual({ filters: input.filters, ranges: input.ranges, facets: input.facets })
    controller.abort()
    expect(options.signal.aborted).toBe(true)
    await getDynamicFacets('cpu', { filters: {}, ranges: {}, facets: {} })
    expect(fetchMock.mock.calls[1][1].body).toBe('{}')
    await expect(getDynamicFacets('gpu', {})).rejects.toMatchObject({ kind: 'invalid-response' })
  })
  it.each([429, 500, 502, 503, 504])('shares facet HTTP %i / Retry-After policy', async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status, headers: { 'Retry-After': '30', 'X-Request-ID': 'facet-id' } })))
    const error = await getDynamicFacets('cpu', {}).catch((error: Error) => error) as CatalogError
    expect(error).toMatchObject({ kind: 'http', status, requestId: 'facet-id' })
    expect(catalogRetryDelay(0, error)).toBeGreaterThan(29_000)
    expect(shouldRetryCatalogRequest(0, error)).toBe([429, 502, 503, 504].includes(status))
  })
  it('honors HTTP-date Retry-After on facets', async () => {
    const date = new Date(Date.now() + 30_000).toUTCString()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 429, headers: { 'Retry-After': date } })))
    await expect(getDynamicFacets('cpu', {})).rejects.toMatchObject({ retryAt: Date.parse(date) })
  })
  it.each(['not json', '{"category":"cpu","facets":{"socket":{"options":[{}]}}}'])('rejects malformed facets %s', async (body) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)))
    await expect(getDynamicFacets('cpu', {})).rejects.toMatchObject({ kind: 'invalid-response' })
  })
  it('maps facet network failures and distinguishes timeout from caller abort', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')))
    await expect(getDynamicFacets('cpu', {})).rejects.toMatchObject({ kind: 'network' })
    const timeout = new AbortController()
    const timeoutMock = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeout.signal)
    vi.stubGlobal('fetch', vi.fn((_url, options: RequestInit) => new Promise((_resolve, reject) => {
      options.signal!.addEventListener('abort', () => reject(options.signal!.reason))
    })))
    const pending = getDynamicFacets('cpu', {})
    const assertion = expect(pending).rejects.toMatchObject({ kind: 'timeout' })
    timeout.abort(new DOMException('Timed out', 'TimeoutError'))
    await assertion
    expect(timeoutMock).toHaveBeenCalledWith(15_000)
    timeoutMock.mockReturnValue(new AbortController().signal)
    const caller = new AbortController()
    const cancelled = getDynamicFacets('cpu', {}, caller.signal)
    const cancelledAssertion = expect(cancelled).rejects.toMatchObject({ name: 'AbortError' })
    caller.abort()
    await cancelledAssertion
  })
  it('fetches category metadata and rejects category mismatches', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(Response.json(cpuFilters)))
    vi.stubGlobal('fetch', fetchMock)
    expect(await getCategoryFilters('cpu')).toEqual(cpuFilters)
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/v1\/categories\/cpu\/filters$/)
    await expect(getCategoryFilters('gpu')).rejects.toMatchObject({ kind: 'invalid-response' })
  })

  it('POSTs numeric zero, ranges and facets with offset/cursor in the body and propagates abort', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json(listing)).mockResolvedValueOnce(Response.json(fixture))
    vi.stubGlobal('fetch', fetchMock)
    const conditions = { filters: { includes_cooler: [0] }, ranges: { core_count: { min: 8 } } }
    const controller = new AbortController()
    await searchProducts({ category: 'cpu', mode: 'listing', cursor: 'opaque', conditions }, controller.signal)
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/v1\/search$/)
    const options = fetchMock.mock.calls[0][1] as RequestInit
    expect(options).toMatchObject({ method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' } })
    expect(JSON.parse(options.body as string)).toEqual({ category: 'cpu', limit: 20, cursor: 'opaque', ...conditions })
    controller.abort()
    expect(options.signal?.aborted).toBe(true)
    await searchProducts({ category: 'cpu', mode: 'keyword', query: ' ryzen ', conditions })
    expect(JSON.parse(fetchMock.mock.calls[1][1].body as string)).toEqual({ category: 'cpu', limit: 20, keyword: 'ryzen', offset: 0, ...conditions })
  })

  it('sends facet values without requiring include expansions', async () => {
    const product = optionalProduct('keyboard')
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ ...fixture, data: [product], meta: { ...fixture.meta, window_limit: null } }))
    vi.stubGlobal('fetch', fetchMock)
    await searchProducts({ category: 'keyboard', mode: 'listing', conditions: { facets: { connectivity: ['Bluetooth', 'Wired USB-C'] } } })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({ category: 'keyboard', limit: 20, facets: { connectivity: ['Bluetooth', 'Wired USB-C'] } })
  })

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
    for (const status of [400, 404, 500]) expect(shouldRetryCatalogRequest(0, new CatalogError('http', { status }))).toBe(false)
    expect(shouldRetryCatalogRequest(0, new CatalogError('invalid-response'))).toBe(false)
    expect(shouldRetryCatalogRequest(0, new CatalogError('http', { status: 503, retryAt: Date.now() + 120_000 }))).toBe(false)
  })
})

describe('React Query retry scheduling', () => {
  function client() {
    return new QueryClient({ defaultOptions: { queries: {
      retry: shouldRetryCatalogRequest, retryDelay: catalogRetryDelay, gcTime: Infinity,
    } } })
  }

  for (const endpoint of ['facets', 'search'] as const) {
    for (const header of ['seconds', 'HTTP-date'] as const) {
      it.each([false, true])(`${endpoint}: waits for ${header} Retry-After and retries once (repeat 429: %s)`, async (repeat) => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2026-09-23T00:00:00Z'))
        const retryAfter = header === 'seconds' ? '30' : new Date(Date.now() + 30_000).toUTCString()
        const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(
          fetchMock.mock.calls.length === 1 || repeat
            ? new Response('', { status: 429, headers: { 'Retry-After': retryAfter } })
            : Response.json(endpoint === 'facets' ? cpuFacets() : listing)))
        vi.stubGlobal('fetch', fetchMock)
        const queryClient = client()
        const pending = queryClient.fetchQuery({
          queryKey: [endpoint],
          queryFn: async ({ signal }) => endpoint === 'facets'
            ? getDynamicFacets('cpu', { filters: { manufacturer: ['AMD'] } }, signal)
            : searchProducts({ category: 'cpu', mode: 'listing' }, signal),
        }).then((data) => ({ data }), (error: CatalogError) => ({ error }))
        await vi.advanceTimersByTimeAsync(0)
        expect(fetchMock).toHaveBeenCalledTimes(1)
        await vi.advanceTimersByTimeAsync(29_999)
        expect(fetchMock).toHaveBeenCalledTimes(1)
        await vi.advanceTimersByTimeAsync(1)
        expect(fetchMock).toHaveBeenCalledTimes(2)
        expect(await pending).toMatchObject(repeat ? { error: { status: 429 } } : { data: endpoint === 'facets' ? cpuFacets() : listing })
        await vi.advanceTimersByTimeAsync(120_000)
        expect(fetchMock).toHaveBeenCalledTimes(2)
        queryClient.clear()
      })
    }
  }

  it('surfaces 429 immediately when Retry-After exceeds 60 seconds', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response('', { status: 429, headers: { 'Retry-After': '61' } })))
    vi.stubGlobal('fetch', fetchMock)
    const queryClient = client()
    await expect(queryClient.fetchQuery({ queryKey: ['long-wait'], queryFn: ({ signal }) => getDynamicFacets('cpu', {}, signal) }))
      .rejects.toMatchObject({ status: 429 })
    await vi.advanceTimersByTimeAsync(120_000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(shouldRetryCatalogRequest(0, new CatalogError('http', { status: 429, retryAt: Date.now() + 60_000 }))).toBe(true)
    queryClient.clear()
  })

  it.each([null, 'invalid'])('backs off instead of immediately retrying 429 with Retry-After=%s', async (header) => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response('', {
      status: 429, headers: header ? { 'Retry-After': header } : {},
    })))
    vi.stubGlobal('fetch', fetchMock)
    const queryClient = client()
    const pending = queryClient.fetchQuery({ queryKey: ['backoff'], queryFn: () => getCategories() }).catch((error: CatalogError) => error)
    await vi.advanceTimersByTimeAsync(999)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(await pending).toMatchObject({ status: 429 })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    queryClient.clear()
  })

  it.each([
    new CatalogError('network'), new CatalogError('timeout'),
    ...[502, 503, 504].map((status) => new CatalogError('http', { status })),
  ])('preserves one backoff retry for transient $kind/$status failures', async (error) => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const queryClient = client()
    const queryFn = vi.fn().mockRejectedValue(error)
    const pending = queryClient.fetchQuery({ queryKey: ['transient'], queryFn }).catch((caught: Error) => caught)
    await vi.advanceTimersByTimeAsync(999)
    expect(queryFn).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(await pending).toBe(error)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(queryFn).toHaveBeenCalledTimes(2)
    queryClient.clear()
  })
})
