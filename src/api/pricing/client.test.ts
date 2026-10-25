import { afterEach, describe, expect, it, vi } from 'vitest'
import fixtures from '../../test/fixtures/gateway-http.json'
import { pricingResponse, pricingRow } from '../../test/pricing-fixtures'
import { getPriceSummaries, PricingError, REQUEST_TIMEOUT_MS, retryAfter, isTransient } from './client'
import { pricingConfig } from './config'
import { normalizeRefs, refKey, responseSchema } from './schemas'

const base = 'https://pricing.example.test'
const ref = fixtures.request.products[0]
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })
describe('Gateway JSON boundary', () => {
  it('records the pinned contract, accepts every fixture including stale pending/unsupported', () => {
    expect(fixtures._commit).toBe('a3ac223ae9756ab813e3a080ea7e468c66f49832')
    for (const [name, value] of Object.entries(fixtures)) {
      if (typeof value === 'object' && 'ok' in value && value.ok) expect(responseSchema.safeParse(value).success, name).toBe(true)
    }
  })
  it.each([
    ['complete', { lowest_price: null }], ['complete', { lowest_price: 0 }], ['complete', { offer_count: 0 }],
    ['complete', { fetched_at: null }], ['complete', { expires_at: null }], ['complete', { stale: null }],
    ['empty', { fetched_at: null }], ['empty', { offer_count: null }], ['empty', { lowest_price: 5 }],
    ['pending', { offer_count: 0 }], ['pending', { fetched_at: '2026-01-01T00:00:00Z' }],
    ['missing', { offer_count: null }], ['unsupported', { expires_at: null }],
  ] as const)('rejects invalid %s nullability: %j', (status, patch) => {
    expect(responseSchema.safeParse(pricingResponse([ref], status, patch)).success).toBe(false)
  })
  it.each([1, 20, 21, 100])('POSTs %i refs once with exact public fields, omit credentials and an AbortSignal', async (length) => {
    const refs = Array.from({ length }, (_, i) => ({ source: 'buildcores', upstream_key: `CPU/${i}` }))
    const fetchMock = vi.fn().mockResolvedValue(Response.json(pricingResponse(normalizeRefs(refs))))
    vi.stubGlobal('fetch', fetchMock)
    expect(await getPriceSummaries(base, refs)).toHaveLength(length)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`${base}/v1/prices/summary`)
    expect(init).toMatchObject({ method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' }, redirect: 'error' })
    expect(Object.keys(init.headers)).toEqual(['Content-Type'])
    expect(init.signal).toBeInstanceOf(AbortSignal)
    expect(JSON.parse(init.body)).toEqual({ products: normalizeRefs(refs) })
    expect(init).not.toHaveProperty('mode')
  })
  it('empty emits no HTTP; >100 is an input error, never a silent truncation', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(await getPriceSummaries(base, [])).toEqual([])
    await expect(getPriceSummaries(base, Array(101).fill(ref))).rejects.toMatchObject({ kind: 'input' })
    for (const invalid of [{ ...ref, source: 'Buildcores' }, { ...ref, upstream_key: 'CPU/..' }, { ...ref, id: 3 }, { ...ref, upstream_key: ' CPU/a' }, { ...ref, upstream_key: 'CPU/a\n' }, { ...ref, source: 'buildcores\n' }]) {
      await expect(getPriceSummaries(base, [invalid])).rejects.toMatchObject({ kind: 'input' })
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('normalizes and deduplicates tuples without changing case or key contents', () => {
    const other = { ...ref, upstream_key: 'CPU/TEST' }
    expect(normalizeRefs([ref, other, ref])).toEqual(normalizeRefs([other, ref]))
    expect(refKey(ref)).not.toBe(refKey(other))
    expect(refKey({ source: 'a:b', upstream_key: 'c' })).not.toBe(refKey({ source: 'a', upstream_key: 'b:c' }))
  })
  it('rejects missing, extra, duplicate, mismatched, reordered refs and inconsistent provider keys', async () => {
    const refs = normalizeRefs([ref, { ...ref, upstream_key: 'CPU/other' }])
    const [a, b] = refs.map((r) => pricingRow(r))
    const responses = [[a], [a, b, b], [a, a], [b, a], [{ ...a, source: 'other' }, b],
      [{ ...a, providers: { yahoo: { ...a.providers.yahoo, provider: 'other' } } }, b],
      [{ ...a, providers: { other: a.providers.yahoo } }, b]]
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    for (const data of responses) {
      fetchMock.mockResolvedValueOnce(Response.json({ ok: true, data }))
      await expect(getPriceSummaries(base, refs)).rejects.toMatchObject({ kind: 'schema' })
    }
  })
  it('returns provider-free UI data, preserves fetched_at, and never revives a prior price', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json(pricingResponse([ref])))
      .mockResolvedValueOnce(Response.json(pricingResponse([ref], 'pending')))
    vi.stubGlobal('fetch', fetchMock)
    const [first] = await getPriceSummaries(base, [ref])
    expect(first).toMatchObject({ price: 57800, fetchedAt: '2026-09-26T00:00:00.000Z', attribution: 'Yahoo!ショッピング' })
    expect(first).not.toHaveProperty('providers')
    expect((await getPriceSummaries(base, [ref]))[0]).toMatchObject({ status: 'pending', price: null })
  })
  it.each([400, 403, 404, 405, 413, 415, 429, 502, 503, 504])('classifies HTTP %i without turning it into empty', async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status, headers: { 'Retry-After': '60' } })))
    await expect(getPriceSummaries(base, [ref])).rejects.toMatchObject({ kind: 'http', status })
    expect(isTransient(new PricingError('http', status))).toBe([429, 502, 503, 504].includes(status))
  })
  it('classifies network, JSON and envelope errors separately', async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError('network'))
      .mockResolvedValueOnce(new Response('bad json')).mockResolvedValueOnce(Response.json({ ok: false, data: [] }))
    vi.stubGlobal('fetch', fetchMock)
    for (const kind of ['network', 'schema', 'schema']) await expect(getPriceSummaries(base, [ref])).rejects.toMatchObject({ kind })
  })
  it('times out both fetch and stalled body reads, and distinguishes external abort', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn().mockImplementationOnce(() => new Promise(() => {}))
      .mockResolvedValueOnce(new Response(new ReadableStream({ start() {} })))
      .mockImplementationOnce(() => new Promise(() => {}))
    vi.stubGlobal('fetch', fetchMock)
    for (let i = 0; i < 2; i++) {
      const request = expect(getPriceSummaries(base, [ref])).rejects.toMatchObject({ kind: 'timeout' })
      await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS)
      await request
    }
    const controller = new AbortController()
    const promise = getPriceSummaries(base, [ref], controller.signal)
    controller.abort()
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchMock.mock.calls[2][1].signal.aborted).toBe(true)
  })
  it('parses Retry-After seconds/date and uses a conservative missing-header 429 cooldown', async () => {
    const now = Date.parse('2026-10-25T00:00:00Z')
    expect(retryAfter('60', now)).toBe(now + 60_000)
    expect(retryAfter('Sun, 25 Oct 2026 00:01:00 GMT', now)).toBe(now + 60_000)
    expect(retryAfter('nonsense', now)).toBe(0)
    expect(retryAfter('-1', now)).toBe(0)
    expect(retryAfter('Infinity', now)).toBe(0)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 429 })))
    await expect(getPriceSummaries(base, [ref])).rejects.toMatchObject({ retryAt: expect.any(Number), status: 429 })
  })
})
describe('build-time feature and URL configuration', () => {
  it('requires explicit true, ignoring the old flag entirely', () => {
    for (const flag of [undefined, '', 'false', 'TRUE', true]) expect(pricingConfig(flag, base, 'localhost')).toEqual({ status: 'disabled' })
  })
  it.each(['', 'bad', 'http://remote.test', 'https://u:p@remote.test', 'https://@remote.test', 'https://remote.test?q=x', 'https://remote.test/#x', 'https://remote.test?', ' https://remote.test', 'https://remote.\ntest', 'https:remote.test', 'ftp://remote.test'])('rejects %s', (url) => {
    expect(pricingConfig('true', url, 'localhost')).toEqual({ status: 'invalid' })
  })
  it('allows HTTPS and only loopback-to-loopback HTTP, including local production preview', () => {
    expect(pricingConfig('true', `${base}/`, 'sheet.example.test')).toEqual({ status: 'enabled', baseUrl: base })
    for (const host of ['localhost', '127.0.0.1', '[::1]']) expect(pricingConfig('true', `http://${host}:8788`, '127.0.0.1').status).toBe('enabled')
    expect(pricingConfig('true', 'http://127.0.0.1:8788', 'sheet.example.test').status).toBe('invalid')
    expect(pricingConfig('true', undefined, 'localhost').status).toBe('invalid')
    expect(pricingConfig('true', 'http://localhost.example.test:8788', 'localhost').status).toBe('invalid')
  })
})
