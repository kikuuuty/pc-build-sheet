import { describe, expect, it } from 'vitest'
import fixture from '../../test/fixtures/cpu-search.json'
import { catalogProductSchema } from '../../api/catalog/schemas'
import { formatYen } from '../../domain/currency'
import type { BuildItem } from './schemas'
import { getBuildSummary, getItemSubtotal } from './totals'

const cpu: BuildItem = {
  kind: 'catalog', id: 'cpu', category: 'cpu', product: catalogProductSchema.parse(fixture.data[0]),
  quantity: 2, price: 32800,
}
const custom: BuildItem = { kind: 'custom', id: 'os', name: 'OS', quantity: 1, price: 22000 }

describe('estimate totals and quantities', () => {
  it('multiplies unit price by quantity and reflects a quantity change', () => {
    expect(getItemSubtotal(cpu)).toBe(65600)
    expect(getItemSubtotal({ ...cpu, quantity: 3 })).toBe(98400)
    expect(getBuildSummary([{ ...cpu, quantity: 3 }])).toEqual({ partCount: 3, estimateTotal: 98400, unpricedCount: 0 })
  })

  it('sums catalog and custom items and counts only missing prices as unpriced', () => {
    const items: BuildItem[] = [cpu, custom, { ...custom, id: 'free', price: 0, quantity: 3 }, { ...cpu, id: 'unpriced', price: null, quantity: 4 }]
    expect(getBuildSummary(items)).toEqual({ partCount: 10, estimateTotal: 87600, unpricedCount: 4 })
    expect(getItemSubtotal(items[2])).toBe(0)
    expect(getItemSubtotal(items[3])).toBeNull()
  })

  it('distinguishes a zero price from an unknown price for both catalog and custom items', () => {
    expect(getItemSubtotal({ ...cpu, price: 0 })).toBe(0)
    expect(getBuildSummary([{ ...cpu, price: 0 }, { ...custom, price: null, quantity: 3 }, { ...custom, id: 'free', price: 0, quantity: 4 }]))
      .toEqual({ partCount: 9, estimateTotal: 0, unpricedCount: 3 })
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
