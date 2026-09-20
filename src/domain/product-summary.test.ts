import { expect, it } from 'vitest'
import fixture from '../test/fixtures/cpu-search.json'
import { catalogProductSchema } from '../api/catalog/schemas'
import { productSpecSummary } from './product-summary'
import { partCategories } from './categories'
import { optionalProduct } from '../test/optional-products'

it('formats real specs without estimating power or showing null values', () => {
  const product = catalogProductSchema.parse(fixture.data[0])
  expect(productSpecSummary(product)).toBe('AM5 / 8コア / 16スレッド')
  if (product.category !== 'cpu') throw new Error('Invalid fixture')
  expect(productSpecSummary({ ...product, specs: { ...product.specs, socket: null, core_count: null, thread_count: null } })).toBe('')
})

it.each(partCategories)('safely summarizes $id with all unknown specs', ({ id }) => {
  const variant = catalogProductSchema.options.find((option) => option.shape.category.value === id)!
  const specs = Object.fromEntries(Object.keys(variant.shape.specs.shape).map((key) => [key, null]))
  expect(productSpecSummary(catalogProductSchema.parse({ ...fixture.data[0], category: id, specs }))).toBe('')
})

it.each([
  ['monitor', '32インチ / 3840×2160 / 144Hz'],
  ['keyboard', '75% / Mechanical / ANSI'],
  ['mouse', 'Symmetrical / 59g / 8000Hz'],
  ['headphones', 'Wireless / Over-ear'],
  ['webcam', '1080p / 60fps'],
  ['accessory', ''], ['microphone', ''],
] as const)('shows only available scalar specs for %s', (category, summary) => {
  expect(productSpecSummary(catalogProductSchema.parse(optionalProduct(category)))).toBe(summary)
})
