import { describe, expect, it } from 'vitest'
import { initialSearchPrice, searchPriceState } from './search-price'

describe('search market price vs selected price', () => {
  const success = { available: true, isError: false, isPending: false }
  it('copies only complete, editable lowest prices', () => {
    const state = searchPriceState({ id: 372, status: 'complete', lowest_price: 57629, offer_count: 28 }, success)
    expect(state).toEqual({ status: 'ready', price: 57629 })
    expect(initialSearchPrice(state)).toBe(57629)
    expect(initialSearchPrice({ status: 'ready', price: 100_000_001 })).toBeNull()
  })
  it('separates disabled, loading, error, empty and unsupported without an initial price', () => {
    const states = [
      searchPriceState(undefined, { ...success, available: false }),
      searchPriceState(undefined, { ...success, isPending: true }),
      searchPriceState(undefined, { ...success, isError: true }),
      searchPriceState({ id: 372, status: 'unsupported', lowest_price: null, offer_count: 0 }, success),
      searchPriceState({ id: 372, status: 'complete', lowest_price: null, offer_count: 0 }, success),
    ]
    expect(states.map(({ status }) => status)).toEqual(['unavailable', 'loading', 'error', 'empty', 'empty'])
    expect(states.map(initialSearchPrice)).toEqual([null, null, null, null, null])
  })
})
