import { expect, it } from 'vitest'
import fixture from '../test/fixtures/cpu-search.json'
import { catalogProductSchema } from '../api/catalog/schemas'
import { productSpecSummary } from './product-summary'

it('formats real specs without estimating power or showing null values', () => {
  const product = catalogProductSchema.parse(fixture.data[0])
  expect(productSpecSummary(product)).toBe('AM5 / 8コア / 16スレッド')
  if (product.category !== 'cpu') throw new Error('Invalid fixture')
  expect(productSpecSummary({ ...product, specs: { ...product.specs, socket: null, core_count: null, thread_count: null } })).toBe('')
})
