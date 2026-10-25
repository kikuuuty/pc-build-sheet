import { QueryClient, isCancelledError, queryOptions } from '@tanstack/react-query'
import { getPriceSummaries, isTransient, PricingError } from './client'
import { needsConfirmation, refKey, type PriceSummary, type ProductRef } from './schemas'

export const PRICING_POLICY = {
  intervals: [10_000, 20_000, 30_000], largeInterval: 35_000,
  maxAttempts: 12, maxDuration: 5 * 60_000, gcTime: 10 * 60_000,
  retryDelay: 10_000, manualInterval: 1000,
} as const
export const pricingKey = (base: string, refs: ProductRef[]) => ['pricing', base, refs.map((r) => [r.source, r.upstream_key])] as const
export const browserReady = () => (typeof document === 'undefined' || document.visibilityState !== 'hidden')
  && (typeof navigator === 'undefined' || navigator.onLine !== false)

// One runtime per QueryClient, with endpoint-wide cooldowns and one scheduler per ref set.
// Session budgets survive short remounts; Query cache GC removes the associated session.
const runtimes = new WeakMap<QueryClient, PricingRuntime>()
class PricingRuntime {
  readonly client: QueryClient
  sessions = new Map<string, PricingSession>()
  cooldowns = new Map<string, number>()
  constructor(client: QueryClient) {
    this.client = client
    client.setQueryDefaults(['pricing'], { gcTime: PRICING_POLICY.gcTime })
    client.getQueryCache().subscribe((event) => {
      if (event.type === 'updated' && event.action.type === 'success') {
        this.sessions.get(JSON.stringify(event.query.queryKey))?.wake()
      }
      if (event.type !== 'removed' || event.query.queryKey[0] !== 'pricing') return
      const key = JSON.stringify(event.query.queryKey)
      this.sessions.get(key)?.dispose()
      this.sessions.delete(key)
      // Expired endpoint cooldowns are removed lazily, not persisted.
      for (const [base, until] of this.cooldowns) if (until <= Date.now()) this.cooldowns.delete(base)
    })
  }
  defer(base: string, until: number) {
    if (until <= (this.cooldowns.get(base) ?? 0)) return
    this.cooldowns.set(base, until)
    for (const session of this.sessions.values()) if (session.base === base) session.wake()
  }
  publish(base: string, result: PriceSummary[]) {
    const latest = new Map(result.map((summary) => [refKey(summary), summary]))
    // Synchronize overlapping cached pages too. A newer pending/empty response must
    // not allow a cached complete price to reappear when returning to another page.
    for (const query of this.client.getQueryCache().findAll({ queryKey: ['pricing', base] })) {
      const previous = query.state.data as PriceSummary[] | undefined
      if (!previous) continue
      let changed = false
      const next = previous.map((s) => {
        const replacement = latest.get(refKey(s))
        if (!replacement || JSON.stringify(replacement) === JSON.stringify(s)) return s
        changed = true
        return replacement
      })
      if (changed) this.client.setQueryData(query.queryKey, next)
    }
    for (const summary of result) this.client.setQueryData(pricingKey(base, [summary]), [summary])
  }
}
export function getPricingSession(client: QueryClient, base: string, refs: ProductRef[]) {
  let runtime = runtimes.get(client)
  if (!runtime) { runtime = new PricingRuntime(client); runtimes.set(client, runtime) }
  const key = JSON.stringify(pricingKey(base, refs))
  let session = runtime.sessions.get(key)
  if (!session) { session = new PricingSession(runtime, base, refs); runtime.sessions.set(key, session) }
  return session
}

export class PricingSession {
  private runtime: PricingRuntime
  readonly base: string
  readonly refs: ProductRef[]
  attempts = 0
  startedAt: number | null = null
  nextAt = 0
  failures = 0
  stopped = false
  private active = 0
  private running = false
  private timer: ReturnType<typeof setTimeout> | undefined
  private version = 0
  private listeners = new Set<() => void>()
  constructor(runtime: PricingRuntime, base: string, refs: ProductRef[]) {
    this.runtime = runtime; this.base = base; this.refs = refs
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  snapshot = () => this.version
  get cooldownUntil() { return this.runtime.cooldowns.get(this.base) ?? 0 }
  get waitUntil() { return Math.max(this.nextAt, this.cooldownUntil) }
  get waiting() { return this.waitUntil > Date.now() }
  get exhausted() {
    return this.attempts >= PRICING_POLICY.maxAttempts
      || (this.startedAt !== null && Math.max(Date.now(), this.waitUntil) >= this.startedAt + PRICING_POLICY.maxDuration)
  }
  get manualAllowed() { return !this.running && browserReady() && Date.now() >= this.waitUntil }
  options() {
    return queryOptions({
      queryKey: pricingKey(this.base, this.refs),
      queryFn: ({ signal }) => getPriceSummaries(this.base, this.refs, signal),
      enabled: false, retry: false, staleTime: 0, gcTime: PRICING_POLICY.gcTime, networkMode: 'always',
      refetchOnMount: false, refetchOnWindowFocus: false, refetchOnReconnect: false,
    })
  }
  private data() { return this.runtime.client.getQueryData<PriceSummary[]>(pricingKey(this.base, this.refs)) }
  private notify() { this.version++; this.listeners.forEach((listener) => listener()) }
  activate() {
    if (++this.active === 1) {
      if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.wake)
      if (typeof window !== 'undefined') { window.addEventListener('online', this.wake); window.addEventListener('offline', this.wake) }
    }
    this.wake()
    return () => {
      if (--this.active === 0) this.dispose()
    }
  }
  dispose() {
    clearTimeout(this.timer)
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.wake)
    if (typeof window !== 'undefined') { window.removeEventListener('online', this.wake); window.removeEventListener('offline', this.wake) }
  }
  wake = () => {
    clearTimeout(this.timer)
    this.notify()
    if (!this.active || !browserReady() || this.running) return
    const data = this.data()
    // A successful terminal cache is not fetched again on every open. Its expiry is
    // still observed; expired complete/empty values become previous results.
    const failed = this.runtime.client.getQueryState(pricingKey(this.base, this.refs))?.status === 'error'
    const freshData = data && !needsConfirmation(data) && !failed
    if (this.stopped || this.exhausted || freshData) {
      // Update the manual control when waiting ends, including stopped sessions.
      if (this.waiting) {
        this.timer = setTimeout(this.wake, Math.min(2_147_483_647, this.waitUntil - Date.now() + 1))
        return
      }
      if (!freshData) return
      const expiry = data.filter((s) => ['complete', 'empty'].includes(s.status))
        .map((s) => Date.parse(s.expiresAt!)).filter((n) => n > Date.now())
      if (expiry.length) this.timer = setTimeout(this.wake, Math.min(2_147_483_647, Math.min(...expiry) - Date.now() + 1))
      return
    }
    const delay = Math.max(0, this.waitUntil - Date.now())
    this.timer = setTimeout(() => { void this.run(false) }, delay)
  }
  manual = () => {
    if (!this.active || !this.manualAllowed) return
    // Explicit restart only; never reset a live session or bypass endpoint cooldown.
    if (this.stopped || this.exhausted) {
      this.attempts = 0; this.startedAt = null; this.failures = 0; this.stopped = false
    }
    void this.run(true)
  }
  private async run(manual: boolean) {
    if (!this.active || !browserReady() || this.running || Date.now() < this.waitUntil
      || (!manual && (this.stopped || this.exhausted))) { this.wake(); return }
    const current = this.data()
    if (!manual && current && !needsConfirmation(current)
      && this.runtime.client.getQueryState(pricingKey(this.base, this.refs))?.status !== 'error') { this.wake(); return }
    clearTimeout(this.timer)
    this.running = true
    this.startedAt ??= Date.now()
    this.attempts++
    this.notify()
    try {
      // fetchQuery deduplicates other consumers. No TanStack retry/mount/focus path.
      const result = await this.runtime.client.fetchQuery(this.options())
      this.failures = 0
      const interval = this.refs.length > 20 ? PRICING_POLICY.largeInterval
        : PRICING_POLICY.intervals[Math.min(this.attempts - 1, 2)]
      this.nextAt = Date.now() + (needsConfirmation(result) ? interval : PRICING_POLICY.manualInterval)
      if (this.refs.length > 20) this.runtime.defer(this.base, Date.now() + PRICING_POLICY.largeInterval)
      // Exact singleton cache reuses list results in panels. Replace whole summaries;
      // pending/empty never merge a previously complete price back into a result.
      this.runtime.publish(this.base, result)
    } catch (error) {
      if (isCancelledError(error) || (error instanceof DOMException && error.name === 'AbortError')) {
        // Cancellation consumes an HTTP attempt but is neither an error nor a retry.
        this.nextAt = Date.now() + PRICING_POLICY.retryDelay
      } else {
        this.failures++
        const retryAt = error instanceof PricingError ? error.retryAt : 0
        const minimum = this.refs.length > 20 ? PRICING_POLICY.largeInterval : PRICING_POLICY.retryDelay
        this.nextAt = Math.max(Date.now() + minimum, retryAt)
        this.runtime.defer(this.base, this.nextAt)
        if (!isTransient(error) || this.failures >= 2) this.stopped = true
      }
    } finally {
      this.running = false
      this.wake()
    }
  }
}
