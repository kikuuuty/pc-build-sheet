import { describe, expect, it } from 'vitest'
import { initialSearchPrice, searchPriceState } from './search-price'
import type { PriceSummary } from '../../api/pricing/schemas'

const summary: PriceSummary = { source: 'buildcores', upstream_key: 'CPU/test', status: 'complete', price: 57800,
  stale: false, fetchedAt: '2026-09-26T00:00:00.000Z', expiresAt: '2099-01-01T00:00:00.000Z', attribution: 'Yahoo!ショッピング' }
const success = { availability: 'enabled' as const, isPending: false, isError: false }
describe('reference price vs saved build price', () => {
  it('copies complete and stale complete only at selection, within the editor limit', () => {
    expect(initialSearchPrice(searchPriceState(summary, success))).toBe(57800)
    expect(initialSearchPrice(searchPriceState({ ...summary, stale: true }, success))).toBe(57800)
    expect(initialSearchPrice(searchPriceState({ ...summary, price: 100_000_001 }, success))).toBeNull()
    expect(initialSearchPrice(searchPriceState(summary, { ...success, isError: true }))).toBeNull()
  })
  it('separates off, config error, loading, network errors and all non-price states', () => {
    expect(searchPriceState(undefined, { ...success, availability: 'disabled' }).status).toBe('disabled')
    expect(searchPriceState(undefined, { ...success, availability: 'invalid' }).status).toBe('invalid')
    expect(searchPriceState(undefined, { ...success, isPending: true }).status).toBe('loading')
    expect(searchPriceState(undefined, { ...success, isError: true }).status).toBe('error')
    for (const status of ['pending', 'empty', 'unsupported', 'missing'] as const) {
      const state = searchPriceState({ ...summary, status, price: null }, success)
      expect(state.status).toBe(status)
      expect(initialSearchPrice(state)).toBeNull()
    }
  })
  it('marks cache expired since receipt as an old result, without changing fetched_at', () => {
    const state = searchPriceState({ ...summary, expiresAt: '2020-01-01T00:00:00.000Z' }, success)
    expect(state).toMatchObject({ status: 'ready', stale: true, fetchedAt: summary.fetchedAt })
  })
})
