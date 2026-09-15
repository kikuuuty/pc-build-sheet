import { describe, expect, it } from 'vitest'
import fixture from '../../test/fixtures/cpu-search.json'
import { catalogProductSchema } from '../../api/catalog/schemas'
import { formatYen } from '../../domain/currency'
import type { BuildItem } from './schemas'
import { getBuildSummary } from './totals'

const cpu: BuildItem = {
  kind: 'catalog', id: 'cpu', category: 'cpu', product: catalogProductSchema.parse(fixture.data[0]),
  price: 32800,
}
const custom: BuildItem = { kind: 'custom', id: 'os', name: 'OS', price: 22000 }

describe('estimate totals and row counts', () => {
  it('counts each row once even when the product is the same', () => {
    expect(getBuildSummary([cpu, { ...cpu, id: 'second', price: 30000 }])).toEqual({ partCount: 2, estimateTotal: 62800, unpricedCount: 0 })
  })

  it('sums catalog and custom items and counts only missing prices as unpriced', () => {
    const items: BuildItem[] = [cpu, custom, { ...custom, id: 'free', price: 0 }, { ...cpu, id: 'unpriced', price: null }]
    expect(getBuildSummary(items)).toEqual({ partCount: 4, estimateTotal: 54800, unpricedCount: 1 })
  })

  it('distinguishes a zero price from an unknown price for both catalog and custom items', () => {
    expect(getBuildSummary([{ ...cpu, price: 0 }, { ...custom, price: null }, { ...custom, id: 'free', price: 0 }]))
      .toEqual({ partCount: 3, estimateTotal: 0, unpricedCount: 1 })
  })

  it('handles an empty build', () => {
    expect(getBuildSummary([])).toEqual({ partCount: 0, estimateTotal: 0, unpricedCount: 0 })
  })

  it('uses the shared JPY formatter including known zero and large subtotals', () => {
    expect(formatYen(248400)).toBe('￥248,400')
    expect(formatYen(0)).toBe('￥0')
    expect(formatYen(9_900_000_000)).toBe('￥9,900,000,000')
  })
})
