import { describe, expect, it, vi } from 'vitest'
import type { StateStorage } from 'zustand/middleware'
import fixture from '../../test/fixtures/cpu-search.json'
import { catalogProductSchema } from '../../api/catalog/schemas'
import { BUILD_STORAGE_KEY, BUILD_STORAGE_VERSION, createBuildStore } from './store'
import { MAX_NAME_LENGTH, MAX_PRICE, type ItemChanges } from './schemas'
import { mainCategories, optionalCategories, partCategories } from '../../domain/categories'
import { optionalProduct } from '../../test/optional-products'
import { getBuildSummary } from './totals'

const product = catalogProductSchema.parse(fixture.data[0])
const storageProduct = catalogProductSchema.parse({ ...product, category: 'storage', upstream_key: 'Storage/test', name: 'Test SSD', specs: {
  storage_type: 'SSD', form_factor: 'M.2', interface: 'PCIe', capacity_gb: 2000, pcie_generation: 4, cache_mb: null, pcie_lanes: 4, nvme: 1,
} })

function memoryStorage() {
  const data = new Map<string, string>()
  const storage: StateStorage = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, value) },
    removeItem: (key) => { data.delete(key) },
  }
  return { storage, data }
}

async function setup(storage: StateStorage) {
  const report = vi.fn()
  const store = createBuildStore(storage, report)
  await vi.waitFor(() => expect(store.persist.hasHydrated()).toBe(true))
  return { store, report }
}

describe('build state and persistence', () => {
  it.each([1, 2, 3, 4, 5])('loads all nine main categories from v%i with IDs, products and prices intact', async (version) => {
    const { storage, data } = memoryStorage()
    const items = mainCategories.filter(({ id }) => id !== 'os').map(({ id }, index) => {
      const variant = catalogProductSchema.options.find((option) => option.shape.category.value === id)!
      const specs = Object.fromEntries(Object.keys(variant.shape.specs.shape).map((key) => [key, null]))
      return { id: `legacy-${id}`, kind: 'catalog', category: id,
        product: catalogProductSchema.parse({ ...product, category: id, specs }), price: index === 0 ? null : index * 1000 }
    })
    data.set(BUILD_STORAGE_KEY, JSON.stringify({ version, state: { items: items.map((item) => ({
      ...item, kind: version === 1 ? undefined : item.kind,
      ...(version < 5 ? { quantity: 1 } : {}), ...(version < 4 ? { source: 'buy', memo: '旧メモ' } : {}),
    })) } }))
    const { store, report } = await setup(storage)
    expect(store.getState().items).toEqual(items)
    expect(report).not.toHaveBeenCalledWith(expect.any(String))
    const { store: restored } = await setup(storage)
    expect(restored.getState().items).toEqual(items)
  })

  it('persists and restores all 30 categories alongside custom items without losing references or prices', async () => {
    const { storage } = memoryStorage()
    const { store } = await setup(storage)
    for (const { id } of partCategories) {
      const variant = catalogProductSchema.options.find((option) => option.shape.category.value === id)!
      const specs = Object.fromEntries(Object.keys(variant.shape.specs.shape).map((key) => [key, null]))
      expect(store.getState().addItem(catalogProductSchema.parse({ ...product, category: id, specs }))).toBe(true)
    }
    store.getState().addCustomItem({ name: '任意のケーブル', price: 0 })
    for (const [index, item] of store.getState().items.entries()) store.getState().updateItem(item.id, { price: index * 100 })
    const { store: restored, report } = await setup(storage)
    expect(restored.getState().items).toHaveLength(31)
    expect(restored.getState().items).toEqual(store.getState().items)
    expect(report).not.toHaveBeenCalled()
  })

  it.each(optionalCategories)('adds, replaces and removes $id while preserving other items', async ({ id, cardinality }) => {
    const { store } = await setup(memoryStorage().storage)
    const candidate = catalogProductSchema.parse(optionalProduct(id))
    store.getState().addItem(product)
    const cpu = store.getState().items[0]
    expect(store.getState().addItem(candidate)).toBe(true)
    const added = store.getState().items[1]
    expect(store.getState().addItem(candidate)).toBe(cardinality === 'multiple')
    store.getState().updateItem(added.id, { price: 10000 })
    const replacement = { ...candidate, name: 'Replacement', upstream_key: `${id}/replacement` }
    expect(store.getState().replaceItem(added.id, replacement)).toBe(true)
    expect(store.getState().items[1]).toEqual({ ...added, product: replacement, price: null })
    for (const item of store.getState().items.slice(1)) store.getState().removeItem(item.id)
    expect(store.getState().items).toEqual([cpu])
    expect(store.getState().addItem(candidate)).toBe(true)
  })

  it('adds independent build items, including two of the same product', async () => {
    const { storage } = memoryStorage()
    const { store } = await setup(storage)
    store.getState().addItem(storageProduct)
    store.getState().addItem(storageProduct)
    const [first, second] = store.getState().items
    expect(first.id).not.toBe(second.id)
    expect(first).toMatchObject({ kind: 'catalog', category: 'storage', product: storageProduct, price: null })
    expect(first).not.toHaveProperty('quantity')
    expect(first).not.toHaveProperty('source')
    expect(first).not.toHaveProperty('memo')
    expect(product).not.toHaveProperty('price')
    expect(product).not.toHaveProperty('quantity')
  })

  it('removes only the specified build item, not all copies of the product', async () => {
    const { store } = await setup(memoryStorage().storage)
    store.getState().addItem(storageProduct)
    store.getState().addItem(storageProduct)
    const [first, second] = store.getState().items
    store.getState().removeItem(first.id)
    expect(store.getState().items).toEqual([second])
    store.getState().removeItem('does-not-exist')
    expect(store.getState().items).toEqual([second])
  })

  it('persists only items plus a schema version, and restores without losing actions', async () => {
    const { storage, data } = memoryStorage()
    const { store } = await setup(storage)
    store.getState().addItem(product)
    store.getState().addCustomItem({ name: 'OS', price: 0 })
    store.getState().updateItem(store.getState().items[0].id, { price: 78800 })
    const persisted = JSON.parse(data.get(BUILD_STORAGE_KEY)!) as { version: number; state: Record<string, unknown> }
    expect(persisted.version).toBe(BUILD_STORAGE_VERSION)
    expect(Object.keys(persisted.state)).toEqual(['items'])
    expect(persisted.state.items).toEqual(store.getState().items)
    for (const item of store.getState().items) expect(item).not.toHaveProperty('source')
    const { store: restored } = await setup(storage)
    expect(restored.getState().items).toEqual(store.getState().items)
    restored.getState().clearBuild()
    expect(restored.getState().items).toEqual([])
  })

  it('restores existing v5 products without source after the API contract update', async () => {
    const { storage, data } = memoryStorage()
    const oldProduct = { ...product, source: undefined }
    data.set(BUILD_STORAGE_KEY, JSON.stringify({ version: 5, state: { items: [
      { id: 'saved-cpu', kind: 'catalog', category: 'cpu', product: oldProduct, price: 32800 },
    ] } }))
    const { store, report } = await setup(storage)
    expect(report).not.toHaveBeenCalled()
    expect(store.getState().items).toHaveLength(1)
    expect(store.getState().items[0]).toMatchObject({ id: 'saved-cpu', price: 32800, product: { name: product.name } })
    store.getState().updateItem('saved-cpu', { price: 33000 })
    const { store: restored } = await setup(storage)
    expect(restored.getState().items[0]).toMatchObject({ id: 'saved-cpu', price: 33000 })
  })

  it('persists clearBuild and remains empty on reload', async () => {
    const { storage } = memoryStorage()
    const { store } = await setup(storage)
    store.getState().addItem(product)
    store.getState().addCustomItem({ name: 'ケーブル' })
    store.getState().clearBuild()
    const { store: restored } = await setup(storage)
    expect(restored.getState().items).toEqual([])
  })

  it.each(['{broken', JSON.stringify({ version: 99, state: { items: [] } }), JSON.stringify({ version: 1, state: { items: [{}] } })])('recovers from invalid storage without crashing or silently claiming success %#', async (raw) => {
    const { storage, data } = memoryStorage()
    data.set(BUILD_STORAGE_KEY, raw)
    const { store, report } = await setup(storage)
    expect(store.getState().items).toEqual([])
    expect(report).toHaveBeenCalledWith(expect.any(String))
    expect(data.get(BUILD_STORAGE_KEY)).toBe(raw)
  })

  it.each([
    { category: 'gpu' }, { quantity: 0 }, { quantity: 1.5 }, { price: -1 }, { source: 'invalid' },
  ])('rejects invalid persisted build fields %#', async (overrides) => {
    const { storage, data } = memoryStorage()
    data.set(BUILD_STORAGE_KEY, JSON.stringify({ version: 1, state: { items: [{ id: 'item-1', category: 'cpu', product, quantity: 1, price: null, source: 'buy', memo: '', ...overrides }] } }))
    const { store, report } = await setup(storage)
    expect(store.getState().items).toEqual([])
    expect(report).toHaveBeenCalled()
  })

  it('keeps the in-memory build usable when localStorage is unavailable or full', async () => {
    const storage: StateStorage = {
      getItem: () => { throw new Error('SecurityError') },
      setItem: () => { throw new Error('QuotaExceededError') },
      removeItem: () => {},
    }
    const { store, report } = await setup(storage)
    expect(() => store.getState().addItem(product)).not.toThrow()
    expect(store.getState().items).toHaveLength(1)
    expect(report).toHaveBeenLastCalledWith(expect.stringContaining('保存できませんでした'))
  })

  it('partially updates user fields, preserves zero/null and keeps catalog data and other rows intact', async () => {
    const { store } = await setup(memoryStorage().storage)
    store.getState().addItem(product)
    store.getState().addItem(storageProduct)
    const [first, second] = store.getState().items
    const snapshot = structuredClone(product)
    expect(store.getState().updateItem(first.id, { price: 32800 })).toBe(true)
    expect(store.getState().items[0]).toMatchObject({ price: 32800 })
    store.getState().updateItem(first.id, { price: 0 })
    expect(store.getState().items[0].price).toBe(0)
    store.getState().updateItem(first.id, { price: null })
    expect(store.getState().items[0]).toMatchObject({ price: null })
    expect(store.getState().items[1]).toEqual(second)
    expect(product).toEqual(snapshot)
    expect(store.getState().updateItem('missing', { price: 100 })).toBe(false)
  })

  it.each([
    { price: -1 }, { price: 1.5 }, { price: NaN }, { price: Infinity }, { price: MAX_PRICE + 1 },
    { quantity: 1 }, { quantity: 2, price: 100 },
    { memo: 'obsolete field' }, { source: 'invalid' }, { source: 'buy' }, { source: 'owned', price: 100 }, { id: 'changed' }, { kind: 'custom' },
    { product: {} }, { category: 'gpu' }, { price: undefined },
  ])('rejects an invalid update atomically %#', async (changes) => {
    const { store } = await setup(memoryStorage().storage)
    store.getState().addItem(product)
    const original = store.getState().items[0]
    expect(store.getState().updateItem(original.id, changes as ItemChanges)).toBe(false)
    expect(store.getState().items[0]).toEqual(original)
  })

  it('adds, edits and removes a custom item without a fake product or category', async () => {
    const { store } = await setup(memoryStorage().storage)
    expect(store.getState().addCustomItem({ name: '  Windows 11 Pro  ' })).toBe(true)
    const first = store.getState().items[0]
    expect(first).toMatchObject({ kind: 'custom', name: 'Windows 11 Pro', price: null })
    expect(first).not.toHaveProperty('quantity')
    expect(first).not.toHaveProperty('source')
    expect(first).not.toHaveProperty('memo')
    expect(first).not.toHaveProperty('product')
    expect(first).not.toHaveProperty('category')
    store.getState().updateItem(first.id, { price: 22000 })
    expect(store.getState().renameCustomItem(first.id, 'Windows 11 Home')).toBe(true)
    expect(store.getState().items[0]).toMatchObject({ name: 'Windows 11 Home', price: 22000 })
    expect(store.getState().renameCustomItem(first.id, ' ')).toBe(false)
    expect(store.getState().renameCustomItem(first.id, 'a'.repeat(MAX_NAME_LENGTH + 1))).toBe(false)
    store.getState().addItem(product)
    expect(store.getState().renameCustomItem(store.getState().items[1].id, 'OS')).toBe(false)
    store.getState().removeItem(first.id)
    expect(store.getState().items).toHaveLength(1)
    expect(store.getState().items[0].kind).toBe('catalog')
  })

  it.each([{ name: ' ' }, { name: 'a'.repeat(MAX_NAME_LENGTH + 1) }, { name: 'OS', quantity: 1 }, { name: 'OS', price: -1 }, { name: 'OS', quantity: undefined }, { name: 'OS', source: 'owned' }])('rejects invalid custom input %#', async (input) => {
    const { store } = await setup(memoryStorage().storage)
    expect(store.getState().addCustomItem(input)).toBe(false)
    expect(store.getState().items).toEqual([])
  })

  it('accepts the documented upper bounds', async () => {
    const { store } = await setup(memoryStorage().storage)
    expect(store.getState().addCustomItem({ name: 'a'.repeat(MAX_NAME_LENGTH), price: MAX_PRICE })).toBe(true)
  })

  it.each([32800, 0, null])('migrates v1 owned price %s to zero, dropping source/memo while preserving legacy single-category duplicates', async (ownedPrice) => {
    const { storage, data } = memoryStorage()
    const legacy = [
      { id: 'legacy-1', category: 'cpu', product, quantity: 2, price: ownedPrice, source: 'owned', memo: '既存メモ' },
      { id: 'legacy-2', category: 'cpu', product, quantity: 1, price: null, source: 'buy', memo: '' },
      { id: 'legacy-3', category: 'cpu', product, quantity: 3, price: 0, source: 'buy', memo: '無料' },
    ]
    data.set(BUILD_STORAGE_KEY, JSON.stringify({ version: 1, state: { items: legacy } }))
    const { store, report } = await setup(storage)
    const migrated = legacy.flatMap(({ id, category, product, quantity, price, source }) => Array.from({ length: quantity }, (_, index) => ({ id: index === 0 ? id : expect.any(String), category, product, price: source === 'owned' ? 0 : price, kind: 'catalog' })))
    expect(store.getState().items).toEqual(migrated)
    expect(report).not.toHaveBeenCalledWith(expect.any(String))
    expect(getBuildSummary(store.getState().items)).toEqual({ partCount: 6, estimateTotal: 0, unpricedCount: 1 })
    expect(JSON.parse(data.get(BUILD_STORAGE_KEY)!)).toEqual({ version: 5, state: { items: migrated } })
    const { store: restored } = await setup(storage)
    expect(restored.getState().items).toEqual(store.getState().items)
    expect(restored.getState().updateItem('legacy-1', { price: 100 })).toBe(true)
    expect(getBuildSummary(restored.getState().items).estimateTotal).toBe(100)
    expect(restored.getState().addItem(product)).toBe(false)
    expect(restored.getState().replaceItem('legacy-2', { ...product, name: 'Replacement CPU' })).toBe(true)
    expect(restored.getState().items).toHaveLength(6)
  })

  it.each([1, 2, 3, 4, 5])('rejects duplicate IDs in version %i without overwriting storage', async (version) => {
    const { storage, data } = memoryStorage()
    const item = { id: 'duplicate', kind: 'catalog', category: 'cpu', product, quantity: 1, price: null, source: 'buy', memo: '' }
    const raw = JSON.stringify({ version, state: { items: [item, item] } })
    data.set(BUILD_STORAGE_KEY, raw)
    const { store, report } = await setup(storage)
    expect(store.getState().items).toEqual([])
    expect(report).toHaveBeenCalledWith(expect.any(String))
    expect(data.get(BUILD_STORAGE_KEY)).toBe(raw)
  })

  it.each([
    { kind: 'custom', name: 'OS', price: 1.2 }, { kind: 'custom', name: '' }, { kind: 'unknown' },
    { kind: 'catalog', category: 'gpu', product }, { kind: 'custom', name: 'OS', quantity: 100 },
  ])('rejects invalid phase 2 storage %#', async (overrides) => {
    const { storage, data } = memoryStorage()
    const raw = JSON.stringify({ version: 2, state: { items: [{ id: 'bad', quantity: 1, price: null, source: 'buy', memo: '', ...overrides }] } })
    data.set(BUILD_STORAGE_KEY, raw)
    const { store, report } = await setup(storage)
    expect(store.getState().items).toEqual([])
    expect(report).toHaveBeenCalledWith(expect.any(String))
    expect(data.get(BUILD_STORAGE_KEY)).toBe(raw)
  })

  it.each([2, 3])('migrates v%i catalog/custom items to v5 with zero prices for owned items and preserves totals', async (version) => {
    const { storage, data } = memoryStorage()
    const catalog = { id: 'cpu', kind: 'catalog', category: 'cpu', product, quantity: 2, price: 32800, source: 'buy' }
    const custom = { id: 'custom', kind: 'custom', name: 'USBハブ', quantity: 3, price: 2200, source: 'owned' }
    const legacy = [
      catalog, custom,
      { ...catalog, id: 'owned-unpriced', source: 'owned', price: null, quantity: 4 },
      { ...custom, id: 'unpriced', source: 'buy', price: null, quantity: 5 },
      { ...custom, id: 'free', source: 'buy', price: 0, quantity: 6 },
    ]
    data.set(BUILD_STORAGE_KEY, JSON.stringify({ version, state: { items: legacy.map((item) => ({ ...item, memo: '旧メモ' })) } }))
    const { store } = await setup(storage)
    const migrated = legacy.flatMap(({ source, quantity, ...item }) => Array.from({ length: quantity }, (_, index) => ({ ...item, id: index === 0 ? item.id : expect.any(String), price: source === 'owned' ? 0 : item.price })))
    expect(store.getState().items).toEqual(migrated)
    expect(getBuildSummary(store.getState().items)).toEqual({ partCount: 20, estimateTotal: 65600, unpricedCount: 5 })
    expect(JSON.parse(data.get(BUILD_STORAGE_KEY)!)).toEqual({ version: 5, state: { items: migrated } })
    const { store: restored } = await setup(storage)
    expect(restored.getState().items).toEqual(store.getState().items)
    expect(restored.getState().renameCustomItem('custom', 'ケーブル')).toBe(true)
  })

  it('expands v4 quantities without ID collisions or lost prices and persists independent rows once', async () => {
    const { storage, data } = memoryStorage()
    const legacy = [
      { id: 'ssd', kind: 'catalog', category: 'storage', product: storageProduct, quantity: 2, price: MAX_PRICE },
      { id: 'ssd:copy:1', kind: 'custom', name: 'Cable', quantity: 3, price: 0 },
      { id: 'cpu', kind: 'catalog', category: 'cpu', product, quantity: 99, price: null },
    ]
    data.set(BUILD_STORAGE_KEY, JSON.stringify({ version: 4, state: { items: legacy } }))
    const { store, report } = await setup(storage)
    const rows = store.getState().items
    expect(report).not.toHaveBeenCalledWith(expect.any(String))
    expect(rows).toHaveLength(104)
    expect(new Set(rows.map(({ id }) => id)).size).toBe(104)
    expect(rows[0]).toMatchObject({ id: 'ssd', price: MAX_PRICE, product: storageProduct })
    expect(rows[1]).toMatchObject({ price: MAX_PRICE, product: storageProduct })
    expect(rows[2]).toMatchObject({ id: 'ssd:copy:1', name: 'Cable', price: 0 })
    expect(rows[5]).toMatchObject({ id: 'cpu', price: null, product })
    for (const row of rows) expect(row).not.toHaveProperty('quantity')
    expect(getBuildSummary(rows)).toEqual({ partCount: 104, estimateTotal: 2 * MAX_PRICE, unpricedCount: 99 })
    expect(JSON.parse(data.get(BUILD_STORAGE_KEY)!)).toEqual({ version: 5, state: { items: rows } })
    const { store: restored } = await setup(storage)
    expect(restored.getState().items).toEqual(rows)
    restored.getState().updateItem(rows[1].id, { price: 500 })
    restored.getState().removeItem('cpu')
    expect(getBuildSummary(restored.getState().items)).toEqual({ partCount: 103, estimateTotal: MAX_PRICE + 500, unpricedCount: 98 })
    expect(restored.getState().items[0]).toEqual(rows[0])
    const { store: reloaded } = await setup(storage)
    expect(reloaded.getState().items).toEqual(restored.getState().items)
  })

  it.each([0, 1.5, 100, null])('rejects invalid v4 quantity %s without overwriting storage', async (quantity) => {
    const { storage, data } = memoryStorage()
    const raw = JSON.stringify({ version: 4, state: { items: [{ id: 'custom', kind: 'custom', name: 'OS', price: 0, quantity }] } })
    data.set(BUILD_STORAGE_KEY, raw)
    const { store, report } = await setup(storage)
    expect(store.getState().items).toEqual([])
    expect(report).toHaveBeenCalledWith(expect.any(String))
    expect(data.get(BUILD_STORAGE_KEY)).toBe(raw)
  })

  it.each(partCategories)('enforces $id cardinality with one product per row', async (category) => {
    const { store } = await setup(memoryStorage().storage)
    // Use null spec fields from the category schema to test every category, without live API calls.
    const variant = catalogProductSchema.options.find((option) => option.shape.category.value === category.id)!
    const specs = Object.fromEntries(Object.keys(variant.shape.specs.shape).map((key) => [key, null]))
    const candidate = catalogProductSchema.parse({ ...product, category: category.id, specs })
    expect(store.getState().addItem(candidate)).toBe(true)
    expect(store.getState().addItem(candidate)).toBe(category.cardinality === 'multiple')
    expect(store.getState().items).toHaveLength(category.cardinality === 'multiple' ? 2 : 1)
  })

  it.each([18800, 0])('replaces a product atomically, resets price %i and preserves ID', async (price) => {
    const { store } = await setup(memoryStorage().storage)
    store.getState().addItem(storageProduct)
    store.getState().addItem(storageProduct)
    const [first, second] = store.getState().items
    store.getState().updateItem(first.id, { price })
    const replacement = { ...storageProduct, upstream_key: 'Storage/replacement', name: 'Other SSD' }
    expect(store.getState().replaceItem(first.id, replacement)).toBe(true)
    expect(store.getState().items).toEqual([{ ...first, product: replacement, price: null }, second])
    expect(getBuildSummary(store.getState().items)).toMatchObject({ estimateTotal: 0, unpricedCount: 2 })
    expect(replacement).not.toHaveProperty('price')
  })

  it('rejects cross-category, custom, missing and invalid-product replacements without altering state', async () => {
    const { store } = await setup(memoryStorage().storage)
    store.getState().addItem(product)
    store.getState().addCustomItem({ name: 'OS' })
    const original = store.getState().items
    expect(store.getState().replaceItem(original[0].id, storageProduct)).toBe(false)
    expect(store.getState().replaceItem(original[1].id, product)).toBe(false)
    expect(store.getState().replaceItem('missing', product)).toBe(false)
    expect(store.getState().replaceItem(original[0].id, { ...product, name: '' })).toBe(false)
    expect(store.getState().items).toEqual(original)
  })
})
