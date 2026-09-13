import { describe, expect, it, vi } from 'vitest'
import type { StateStorage } from 'zustand/middleware'
import fixture from '../../test/fixtures/cpu-search.json'
import { catalogProductSchema } from '../../api/catalog/schemas'
import { BUILD_STORAGE_KEY, BUILD_STORAGE_VERSION, createBuildStore } from './store'
import { MAX_MEMO_LENGTH, MAX_NAME_LENGTH, MAX_PRICE, MAX_QUANTITY, type ItemChanges } from './schemas'

const product = catalogProductSchema.parse(fixture.data[0])

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
  it('adds independent build items, including two of the same product', async () => {
    const { storage } = memoryStorage()
    const { store } = await setup(storage)
    store.getState().addItem(product)
    store.getState().addItem(product)
    const [first, second] = store.getState().items
    expect(first.id).not.toBe(second.id)
    expect(first).toMatchObject({ kind: 'catalog', category: 'cpu', product, quantity: 1, price: null, source: 'buy', memo: '' })
    expect(product).not.toHaveProperty('price')
    expect(product).not.toHaveProperty('quantity')
  })

  it('removes only the specified build item, not all copies of the product', async () => {
    const { store } = await setup(memoryStorage().storage)
    store.getState().addItem(product)
    store.getState().addItem(product)
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
    store.getState().addCustomItem({ name: 'OS', price: 22000, quantity: 2, source: 'owned', memo: '移行予定' })
    store.getState().updateItem(store.getState().items[0].id, { price: 78800, quantity: 3, memo: 'CPUメモ', source: 'owned' })
    const persisted = JSON.parse(data.get(BUILD_STORAGE_KEY)!) as { version: number; state: Record<string, unknown> }
    expect(persisted.version).toBe(BUILD_STORAGE_VERSION)
    expect(Object.keys(persisted.state)).toEqual(['items'])
    expect(persisted.state.items).toEqual(store.getState().items)
    const { store: restored } = await setup(storage)
    expect(restored.getState().items).toEqual(store.getState().items)
    restored.getState().clearBuild()
    expect(restored.getState().items).toEqual([])
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
    store.getState().addItem(product)
    const [first, second] = store.getState().items
    const snapshot = structuredClone(product)
    expect(store.getState().updateItem(first.id, { price: 32800 })).toBe(true)
    expect(store.getState().updateItem(first.id, { quantity: 2 })).toBe(true)
    expect(store.getState().updateItem(first.id, { source: 'owned', memo: '以前のPCから流用' })).toBe(true)
    expect(store.getState().items[0]).toMatchObject({ price: 32800, quantity: 2, source: 'owned', memo: '以前のPCから流用' })
    store.getState().updateItem(first.id, { source: 'buy' })
    expect(store.getState().items[0].price).toBe(32800)
    store.getState().updateItem(first.id, { price: 0 })
    expect(store.getState().items[0].price).toBe(0)
    store.getState().updateItem(first.id, { price: null, memo: '' })
    expect(store.getState().items[0]).toMatchObject({ price: null, memo: '' })
    expect(store.getState().items[1]).toEqual(second)
    expect(product).toEqual(snapshot)
    expect(store.getState().updateItem('missing', { price: 100 })).toBe(false)
  })

  it.each([
    { price: -1 }, { price: 1.5 }, { price: NaN }, { price: Infinity }, { price: MAX_PRICE + 1 },
    { quantity: 0 }, { quantity: -1 }, { quantity: 1.5 }, { quantity: NaN }, { quantity: MAX_QUANTITY + 1 },
    { memo: 'a'.repeat(MAX_MEMO_LENGTH + 1) }, { source: 'invalid' }, { id: 'changed' }, { kind: 'custom' },
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
    expect(first).toMatchObject({ kind: 'custom', name: 'Windows 11 Pro', quantity: 1, price: null, source: 'buy', memo: '' })
    expect(first).not.toHaveProperty('product')
    expect(first).not.toHaveProperty('category')
    store.getState().updateItem(first.id, { price: 22000, quantity: 2, source: 'owned' })
    expect(store.getState().updateCustomDetails(first.id, { name: 'Windows 11 Home', memo: 'ライセンス確認' })).toBe(true)
    expect(store.getState().items[0]).toMatchObject({ name: 'Windows 11 Home', memo: 'ライセンス確認', price: 22000, quantity: 2, source: 'owned' })
    expect(store.getState().updateCustomDetails(first.id, { name: ' ', memo: '' })).toBe(false)
    expect(store.getState().updateCustomDetails(first.id, { name: 'OS', memo: 'a'.repeat(MAX_MEMO_LENGTH + 1) })).toBe(false)
    store.getState().addItem(product)
    expect(store.getState().updateCustomDetails(store.getState().items[1].id, { name: 'OS', memo: '' })).toBe(false)
    store.getState().removeItem(first.id)
    expect(store.getState().items).toHaveLength(1)
    expect(store.getState().items[0].kind).toBe('catalog')
  })

  it.each([{ name: ' ' }, { name: 'a'.repeat(MAX_NAME_LENGTH + 1) }, { name: 'OS', quantity: 0 }, { name: 'OS', price: -1 }, { name: 'OS', quantity: undefined }])('rejects invalid custom input %#', async (input) => {
    const { store } = await setup(memoryStorage().storage)
    expect(store.getState().addCustomItem(input)).toBe(false)
    expect(store.getState().items).toEqual([])
  })

  it('accepts the documented upper bounds', async () => {
    const { store } = await setup(memoryStorage().storage)
    expect(store.getState().addCustomItem({ name: 'a'.repeat(MAX_NAME_LENGTH), price: MAX_PRICE, quantity: MAX_QUANTITY, memo: 'a'.repeat(MAX_MEMO_LENGTH) })).toBe(true)
  })

  it('migrates version 1 to version 2 without losing IDs, duplicate products or editable fields, then saves and reloads v2', async () => {
    const { storage, data } = memoryStorage()
    const legacy = [
      { id: 'legacy-1', category: 'cpu', product, quantity: 2, price: 32800, source: 'owned', memo: '既存メモ' },
      { id: 'legacy-2', category: 'cpu', product, quantity: 1, price: null, source: 'buy', memo: '' },
      { id: 'legacy-3', category: 'cpu', product, quantity: 3, price: 0, source: 'buy', memo: '無料' },
    ]
    data.set(BUILD_STORAGE_KEY, JSON.stringify({ version: 1, state: { items: legacy } }))
    const { store, report } = await setup(storage)
    const migrated = legacy.map((item) => ({ ...item, kind: 'catalog' }))
    expect(store.getState().items).toEqual(migrated)
    expect(report).not.toHaveBeenCalledWith(expect.any(String))
    expect(JSON.parse(data.get(BUILD_STORAGE_KEY)!)).toEqual({ version: 2, state: { items: migrated } })
    const { store: restored } = await setup(storage)
    expect(restored.getState().items).toEqual(migrated)
    expect(restored.getState().updateItem('legacy-1', { source: 'buy' })).toBe(true)
  })

  it.each([1, 2])('rejects duplicate IDs in version %i without overwriting storage', async (version) => {
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
})
