import { describe, expect, it, vi } from 'vitest'
import type { StateStorage } from 'zustand/middleware'
import fixture from '../../test/fixtures/cpu-search.json'
import { catalogProductSchema } from '../../api/catalog/schemas'
import { BUILD_STORAGE_KEY, BUILD_STORAGE_VERSION, createBuildStore } from './store'

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
    expect(first).toMatchObject({ category: 'cpu', product, quantity: 1, price: null, source: 'buy', memo: '' })
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
    const persisted = JSON.parse(data.get(BUILD_STORAGE_KEY)!) as { version: number; state: Record<string, unknown> }
    expect(persisted.version).toBe(BUILD_STORAGE_VERSION)
    expect(Object.keys(persisted.state)).toEqual(['items'])
    expect(persisted.state.items).toEqual(store.getState().items)
    const { store: restored } = await setup(storage)
    expect(restored.getState().items).toEqual(store.getState().items)
    restored.getState().removeItem(restored.getState().items[0].id)
    expect(restored.getState().items).toEqual([])
  })

  it('persists clearBuild and remains empty on reload', async () => {
    const { storage } = memoryStorage()
    const { store } = await setup(storage)
    store.getState().addItem(product)
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
})
