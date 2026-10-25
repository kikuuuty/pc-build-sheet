import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { pricingResponse } from '../../test/pricing-fixtures'
import { getPricingSession, pricingKey, PRICING_POLICY, type PricingSession } from './control'
import { normalizeRefs, type PriceSummary, type ProductRef } from './schemas'

const base = 'https://pricing.example.test'
const ref = { source: 'buildcores', upstream_key: 'CPU/test' }
let client: QueryClient
let fetchMock: ReturnType<typeof vi.fn>
let cleanup: (() => void)[]
let visibility: string
let online: boolean
let documentEvents: EventTarget
let windowEvents: EventTarget
function mount(refs: ProductRef[] = [ref], endpoint = base) {
  const session = getPricingSession(client, endpoint, normalizeRefs(refs))
  const observer = new QueryObserver(client, session.options())
  const unsubscribe = observer.subscribe(() => {})
  const deactivate = session.activate()
  const close = () => { deactivate(); unsubscribe() }
  cleanup.push(close)
  return { session, close }
}
const tick = (ms = 0) => vi.advanceTimersByTimeAsync(ms)
const data = (refs = [ref]) => client.getQueryData<PriceSummary[]>(pricingKey(base, normalizeRefs(refs)))
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-25T00:00:00Z'))
  client = new QueryClient()
  cleanup = []
  visibility = 'visible'; online = true
  documentEvents = new EventTarget(); windowEvents = new EventTarget()
  Object.defineProperty(documentEvents, 'visibilityState', { get: () => visibility })
  vi.stubGlobal('document', documentEvents)
  vi.stubGlobal('window', windowEvents)
  vi.stubGlobal('navigator', { get onLine() { return online } })
  fetchMock = vi.fn().mockImplementation((_url: string, init: RequestInit) => Promise.resolve(Response.json(pricingResponse(JSON.parse(init.body as string).products, 'pending'))))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => { cleanup.forEach((close) => close()); client.clear(); vi.unstubAllGlobals(); vi.useRealTimers() })
describe('finite price-only scheduler', () => {
  it('uses 10/20/30s progression and at most 12 HTTP attempts, including remounts', async () => {
    const first = mount()
    await tick()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await tick(9999); expect(fetchMock).toHaveBeenCalledTimes(1)
    await tick(1); expect(fetchMock).toHaveBeenCalledTimes(2)
    await tick(20_000); expect(fetchMock).toHaveBeenCalledTimes(3)
    first.close(); cleanup = []
    const next = mount()
    expect(next.session).toBe(first.session)
    await tick(30_000); expect(fetchMock).toHaveBeenCalledTimes(4)
    await tick(400_000)
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(12)
    expect(next.session.exhausted).toBe(true)
    expect(data()?.[0].status).toBe('pending')
  })
  it.each(['complete', 'empty', 'unsupported', 'missing'] as const)('pending → %s stops automatic confirmation', async (status) => {
    const { session } = mount()
    await tick()
    fetchMock.mockResolvedValue(Response.json(pricingResponse([ref], status, { stale: status === 'unsupported' || status === 'missing' })))
    await tick(10_000)
    expect(data()?.[0].status).toBe(status)
    await tick(100_000)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(session.attempts).toBe(2)
  })
  it.each(['complete', 'empty'] as const)('stale %s rechecks, replacing the entire result with pending', async (status) => {
    fetchMock.mockResolvedValueOnce(Response.json(pricingResponse([ref], status, { stale: true })))
    mount(); await tick()
    await tick(10_000)
    expect(data()?.[0]).toMatchObject({ status: 'pending', price: null, fetchedAt: null })
  })
  it('never automatically polls stale unsupported or missing, even after expiry', async () => {
    for (const status of ['unsupported', 'missing'] as const) {
      const r = { ...ref, upstream_key: `CPU/${status}` }
      fetchMock.mockResolvedValueOnce(Response.json(pricingResponse([r], status, { stale: true, expires_at: '2020-01-01T00:00:00Z' })))
      mount([r]); await tick()
    }
    await tick(300_000)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
  it('reuses fresh singleton cache from list bulk, with no numeric ID in keys', async () => {
    const refs = normalizeRefs([ref, { ...ref, upstream_key: 'CPU/other' }])
    fetchMock.mockResolvedValueOnce(Response.json(pricingResponse(refs)))
    mount(refs); await tick()
    mount(); await tick()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(pricingKey(base, [ref])).toEqual(['pricing', base, [['buildcores', 'CPU/test']]])
  })
  it('later pending from a panel replaces cached complete on other pages too, never resurrecting hidden prices', async () => {
    const refs = normalizeRefs([ref, { ...ref, upstream_key: 'CPU/other' }])
    fetchMock.mockResolvedValueOnce(Response.json(pricingResponse(refs)))
    const list = mount(refs); await tick(); list.close(); cleanup = []
    const panel = mount(); await tick(1001)
    panel.session.manual(); await tick()
    expect(data()?.[0]).toMatchObject({ status: 'pending', price: null })
    expect(data(refs)?.find((s) => s.upstream_key === ref.upstream_key)).toMatchObject({ status: 'pending', price: null })
    expect(data(refs)?.find((s) => s.upstream_key === 'CPU/other')).toMatchObject({ status: 'complete', price: 57800 })
  })
  it('the 12-attempt cap counts transient retries even before the five-minute deadline', async () => {
    let attempts = 0
    fetchMock.mockImplementation((_url: string, init: RequestInit) => Promise.resolve(++attempts % 2
      ? new Response('{}', { status: 503 }) : Response.json(pricingResponse(JSON.parse(init.body as string).products, 'pending'))))
    const { session } = mount(); await tick(299_000)
    expect(fetchMock).toHaveBeenCalledTimes(12)
    expect(session.exhausted).toBe(true)
    await tick(100_000)
    expect(fetchMock).toHaveBeenCalledTimes(12)
  })
  it('StrictMode-like immediate detach/re-attach leaves one request and one timer', async () => {
    const a = mount(); a.close(); cleanup = []
    const b = mount(); const other = mount(); await tick()
    expect(b.session).toBe(other.session)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await tick(10_000)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
  it('expired cache is rechecked instead of being treated as fresh forever', async () => {
    fetchMock.mockResolvedValueOnce(Response.json(pricingResponse([ref], 'complete', { expires_at: new Date(Date.now() + 2000).toISOString() })))
    mount(); await tick()
    await tick(2002)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(data()?.[0].status).toBe('pending')
  })
  it('enforces endpoint cooldown across pages/panels, missing Retry-After, and manual spamming', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 429 }))
    const a = mount(); await tick()
    const b = mount([{ ...ref, upstream_key: 'CPU/other' }])
    for (let i = 0; i < 20; i++) { a.session.manual(); b.session.manual() }
    await tick(59_999)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await tick(10)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
  it('honors HTTP-date Retry-After and stops when a wait exceeds the session deadline', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 503, headers: { 'Retry-After': new Date(Date.now() + 600_000).toUTCString() } }))
    const { session } = mount(); await tick()
    expect(session.exhausted).toBe(true)
    await tick(599_000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    session.manual()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it('explicit recovery after a long cooldown restarts only this bulk and deduplicates repeated clicks', async () => {
    const refs = normalizeRefs([ref, { ...ref, upstream_key: 'CPU/other' }])
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 503, headers: { 'Retry-After': '600' } }))
    const { session } = mount(refs); await tick()
    expect(session.exhausted).toBe(true)
    expect(session.manualAllowed).toBe(false)
    for (let i = 0; i < 10; i++) session.manual()
    await tick(600_010)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(session.manualAllowed).toBe(true)
    fetchMock.mockImplementation((_url: string, init: RequestInit) => Promise.resolve(Response.json(pricingResponse(JSON.parse(init.body as string).products))))
    for (let i = 0; i < 10; i++) session.manual()
    await tick()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ products: refs })
    expect(session.attempts).toBe(1)
    expect(data(refs)?.map((s) => s.status)).toEqual(['complete', 'complete'])
  })
  it('transient failures retry only once and all retries count toward the shared budget', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(new Response('{}', { status: 503 })))
    const { session } = mount(); await tick()
    await tick(100_000)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(session.attempts).toBe(2)
    expect(session.stopped).toBe(true)
    session.manual(); session.manual()
    await tick()
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
  it.each([400, 403, 404, 405, 413, 415])('HTTP %i is terminal without automatic retry', async (status) => {
    fetchMock.mockResolvedValue(new Response('{}', { status }))
    const { session } = mount(); await tick(); await tick(100_000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(session.stopped).toBe(true)
  })
  it('schema failures are terminal, not empty results', async () => {
    fetchMock.mockResolvedValue(Response.json({ ok: true, data: [] }))
    const { session } = mount(); await tick(); await tick(100_000)
    expect(session.stopped).toBe(true)
    expect(data()).toBeUndefined()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it('pauses while hidden/offline, resumes once without timer catch-up, stops on close', async () => {
    const { close } = mount(); await tick()
    visibility = 'hidden'; documentEvents.dispatchEvent(new Event('visibilitychange'))
    await tick(60_000); expect(fetchMock).toHaveBeenCalledTimes(1)
    visibility = 'visible'; online = false
    documentEvents.dispatchEvent(new Event('visibilitychange'))
    await tick(60_000); expect(fetchMock).toHaveBeenCalledTimes(1)
    online = true; windowEvents.dispatchEvent(new Event('online'))
    await tick(); expect(fetchMock).toHaveBeenCalledTimes(2)
    close(); cleanup = []
    await tick(100_000); expect(fetchMock).toHaveBeenCalledTimes(2)
  })
  it('does not reset the five-minute lifetime across a hidden interval', async () => {
    const { session } = mount(); await tick()
    visibility = 'hidden'; documentEvents.dispatchEvent(new Event('visibilitychange'))
    await tick(PRICING_POLICY.maxDuration)
    visibility = 'visible'; documentEvents.dispatchEvent(new Event('visibilitychange')); await tick()
    expect(session.exhausted).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it.each([21, 100])('uses at least 35 seconds for %i refs, including automatic retry', async (count) => {
    const refs = Array.from({ length: count }, (_, i) => ({ ...ref, upstream_key: `CPU/${i}` }))
    mount(refs); await tick()
    await tick(34_999); expect(fetchMock).toHaveBeenCalledTimes(1)
    await tick(1); expect(fetchMock).toHaveBeenCalledTimes(2)
  })
  it('large-batch transient errors also wait at least 35 seconds, not the small-batch retry delay', async () => {
    const refs = Array.from({ length: 21 }, (_, i) => ({ ...ref, upstream_key: `CPU/${i}` }))
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 503 }))
    mount(refs); await tick()
    await tick(34_999); expect(fetchMock).toHaveBeenCalledTimes(1)
    await tick(10); expect(fetchMock).toHaveBeenCalledTimes(2)
  })
  it('closing one consumer does not cancel the request still needed by another', async () => {
    let signal!: AbortSignal
    fetchMock.mockImplementation((_url: string, init: RequestInit) => { signal = init.signal!; return new Promise(() => {}) })
    const a = mount(); const b = mount(); await tick()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    a.close(); expect(signal.aborted).toBe(false)
    b.close(); cleanup = []
    expect(signal.aborted).toBe(true)
    await tick()
    expect(b.session.stopped).toBe(false)
  })
  it('endpoint changes get distinct caches, while cancelled old refs cannot contaminate a new page', async () => {
    let resolve!: (value: Response) => void
    fetchMock.mockImplementationOnce(() => new Promise<Response>((r) => { resolve = r }))
    const a = mount(); await tick(); a.close(); cleanup = []
    mount([ref], 'https://other.example.test'); await tick()
    resolve(Response.json(pricingResponse([ref])))
    await tick()
    expect(client.getQueryData(pricingKey('https://other.example.test', [ref]))).toMatchObject([{ status: 'pending' }])
    expect(data()).toBeUndefined()
  })
  it('GC removes idle sessions rather than persisting polling state', async () => {
    const first = mount(); await tick(); first.close(); cleanup = []
    await tick(PRICING_POLICY.gcTime + 1)
    const next: PricingSession = getPricingSession(client, base, [ref])
    expect(next).not.toBe(first.session)
    expect(next.attempts).toBe(0)
  })
})
