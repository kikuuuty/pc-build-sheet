import { describe, expect, it } from 'vitest'
import { parsePriceInput } from './price-input'
import { MAX_PRICE } from './schemas'

describe('price draft normalization', () => {
  it.each([
    ['', null], ['  ', null], ['0', 0], ['32800', 32800], ['32,800', 32800],
    [' ３２，８００ ', 32800], ['0002', 2], [String(MAX_PRICE), MAX_PRICE],
  ])('normalizes %j to %j', (input, expected) => {
    expect(parsePriceInput(input)).toBe(expected)
  })

  it.each(['-', '-1', '1.5', '1.', 'NaN', 'Infinity', '1e3', '0x10', '12,34', '1,', '1 000', '円', String(MAX_PRICE + 1), '999999999999999999999999'])('rejects invalid or incomplete input %j without converting it to zero', (input) => {
    expect(parsePriceInput(input)).toBeUndefined()
  })
})
