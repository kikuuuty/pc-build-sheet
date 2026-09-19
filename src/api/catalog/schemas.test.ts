import { describe, expect, it } from 'vitest'
import fixture from '../../test/fixtures/cpu-search.json'
import listing from '../../test/fixtures/cpu-listing.json'
import categories from '../../test/fixtures/categories.json'
import { catalogProductSchema, categoriesResponseSchema, searchResponseSchema } from './schemas'
import { partCategories } from '../../domain/categories'

describe('catalog response boundary', () => {
  it('accepts the captured production 9800x3d response', () => {
    const result = searchResponseSchema.parse(fixture)
    expect(result.data[0].upstream_key).toBe('CPU/7ab840c3-8c52-4ced-a65c-7b0922ca479e')
    expect(result.meta.returned).toBe(1)
    expect(result.data[0].source).toBe('buildcores')
    expect(result.meta.next_cursor).toBeNull()
  })

  it('accepts the captured keyword-free page with a cursor and no result window', () => {
    const result = searchResponseSchema.parse(listing)
    expect(result.meta.window_limit).toBeNull()
    expect(result.meta.next_offset).toBeNull()
    expect(result.meta.next_cursor).toBe(listing.meta.next_cursor)
    expect(searchResponseSchema.parse({ ...listing, meta: { ...listing.meta, has_more: false, next_cursor: null } }).meta.next_cursor).toBeNull()
  })

  it('requires source at the HTTP boundary but still accepts older saved products', () => {
    const oldProduct = { ...fixture.data[0], source: undefined }
    expect(catalogProductSchema.safeParse(oldProduct).success).toBe(true)
    expect(searchResponseSchema.safeParse({ ...fixture, data: [oldProduct] }).success).toBe(false)
  })

  it('accepts null specs and nullable common fields without coercing them', () => {
    const product = structuredClone(fixture.data[0])
    const result = catalogProductSchema.parse({
      ...product, manufacturer: null, series: null, variant: null, release_year: null, manufacturer_url: null,
      specs: Object.fromEntries(Object.keys(product.specs).map((key) => [key, null])),
    })
    expect(result.manufacturer).toBeNull()
    expect(result.specs).toHaveProperty('socket', null)
  })

  it('accepts zero results as success', () => {
    expect(searchResponseSchema.parse({ ...fixture, data: [], meta: { ...fixture.meta, returned: 0 } }).data).toEqual([])
  })

  it('accepts has_more with null next_offset at the API window boundary', () => {
    const result = searchResponseSchema.parse({ ...fixture, meta: { ...fixture.meta, offset: 980, has_more: true, next_offset: null, window_exhausted: true } })
    expect(result.meta.next_offset).toBeNull()
  })

  it.each([
    { ...fixture.data[0], id: '372' },
    { ...fixture.data[0], category: 'unknown' },
    { ...fixture.data[0], upstream_key: undefined },
    { ...fixture.data[0], specs: { ...fixture.data[0].specs, core_count: '8' } },
    { ...fixture.data[0], specs: { ...fixture.data[0].specs, socket: undefined } },
    { ...fixture.data[0], specs: { ...fixture.data[0].specs, core_count: 8.5 } },
  ])('rejects invalid product fields %#', (product) => {
    expect(catalogProductSchema.safeParse(product).success).toBe(false)
  })

  it('rejects missing envelopes and contradictory returned counts', () => {
    expect(searchResponseSchema.safeParse(fixture.data).success).toBe(false)
    expect(searchResponseSchema.safeParse({ ...fixture, meta: { ...fixture.meta, returned: 20 } }).success).toBe(false)
  })

  it('allows additive fields but only keeps the consumer projection', () => {
    const result = searchResponseSchema.parse({ ...fixture, internal: 'unused', data: [{ ...fixture.data[0], debug: 'unused' }] })
    expect(result).not.toHaveProperty('internal')
    expect(result.data[0]).not.toHaveProperty('debug')
  })

  it('validates category responses independently of display ordering', () => {
    expect(categoriesResponseSchema.parse({ categories: partCategories.map(({ id }) => id).reverse() }).categories).toHaveLength(9)
    const result = categoriesResponseSchema.parse(categories)
    expect(result.categories).toHaveLength(30)
    for (const { id } of partCategories) expect(result.categories.includes(id)).toBe(true)
    expect(categoriesResponseSchema.parse({ categories: [...categories.categories, 'future_category'] }).categories).toContain('future_category')
  })

  it.each([{}, { categories: [] }, { categories: [''] }, { categories: [12] }])('rejects malformed categories %#', (payload) => {
    expect(categoriesResponseSchema.safeParse(payload).success).toBe(false)
  })

  it.each([{ next_cursor: undefined }, { next_cursor: 10 }, { next_cursor: '' }, { window_limit: undefined }, { window_limit: 0 }])('rejects malformed pagination metadata %#', (meta) => {
    expect(searchResponseSchema.safeParse({ ...fixture, meta: { ...fixture.meta, ...meta } }).success).toBe(false)
  })
})
