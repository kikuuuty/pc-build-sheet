import { describe, expect, it } from 'vitest'
import { conditionsLimitError, filtersResponseSchema } from './filters'
import { cpuFilters, range, selection } from '../../test/filter-fixtures'

describe('filter metadata boundary', () => {
  it('accepts typed values, empty definitions/options and null/equal ranges', () => {
    expect(filtersResponseSchema.parse(cpuFilters)).toEqual(cpuFilters)
    for (const filters of [[], [selection('manufacturer', 'メーカー', [])], [{ ...range('weight_g', '重量'), range: null }], [{ ...range('weight_g', '重量'), range: { min: 2.89, max: 2.89, step: 0.1 } }]]) {
      expect(filtersResponseSchema.safeParse({ category: 'mouse', filters }).success).toBe(true)
    }
  })
  it.each([
    { ...selection('socket', 'ソケット', ['AM5']), value_type: 'integer' },
    { ...selection('pwm', 'PWM', [0, 1]), target: 'facets' },
    { ...selection('socket', 'ソケット', ['AM5']), options: [{ value: null, label: 'unknown' }] },
    { ...selection('socket', 'ソケット', ['AM5']), options: [{ value: '   ', label: 'blank' }] },
    { ...range('cores', 'コア数', true), range: { min: 2.5, max: 8, step: 1 } },
    { ...range('weight_g', '重量'), range: { min: 3, max: 2, step: 1 } },
    { ...range('weight_g', '重量'), range: { min: 2, max: 3, step: 0 } },
    { ...range('weight_g', '重量'), target: 'filters' },
    { ...range('weight_g', '重量'), range: { min: 2, max: Infinity, step: 1 } },
  ])('rejects incompatible or malformed metadata %#', (definition) => {
    expect(filtersResponseSchema.safeParse({ category: 'cpu', filters: [definition] }).success).toBe(false)
  })
  it('rejects duplicate field IDs and option values', () => {
    expect(filtersResponseSchema.safeParse({ category: 'cpu', filters: [cpuFilters.filters[0], cpuFilters.filters[0]] }).success).toBe(false)
    expect(filtersResponseSchema.safeParse({ category: 'cpu', filters: [selection('socket', 'ソケット', ['AM5', 'AM5'])] }).success).toBe(false)
  })
})
it('enforces aggregate values and per-target/total field limits', () => {
  const ten = Array.from({ length: 10 }, (_, i) => String(i))
  expect(conditionsLimitError({ filters: { a: ten, b: ten, c: ten, d: ten } })).toBeUndefined()
  expect(conditionsLimitError({ filters: { a: ten, b: ten, c: ten, d: ten }, facets: { e: ['x'] } })).toBeTruthy()
  expect(conditionsLimitError({ filters: Object.fromEntries(Array.from({ length: 9 }, (_, i) => [String(i), ['x']])) })).toBeTruthy()
  expect(conditionsLimitError({ ranges: Object.fromEntries(Array.from({ length: 9 }, (_, i) => [String(i), { min: 0 }])) })).toBeTruthy()
  expect(conditionsLimitError({ facets: Object.fromEntries(Array.from({ length: 5 }, (_, i) => [String(i), ['x']])) })).toBeTruthy()
})
