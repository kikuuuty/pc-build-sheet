import { create } from 'zustand'
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware'
import { z } from 'zod'
import type { CatalogProduct } from '../../api/catalog/types'
import { partCategories } from '../../domain/categories'
import {
  buildItemSchema, customItemInputSchema, customNameSchema, itemChangesSchema,
  legacyBuildSchema, legacyDiscriminatedBuildSchema, legacyQuantityBuildSchema, migrateBuild, persistedBuildSchema,
  type BuildItem, type CustomItemInput, type ItemChanges,
} from './schemas'

export const BUILD_STORAGE_KEY = 'pc-build-sheet:build'
// The 30-category registry widens validation only; the v5 item/envelope format is unchanged.
export const BUILD_STORAGE_VERSION = 5

type BuildState = {
  items: BuildItem[]
  addItem: (product: CatalogProduct, options?: { initialPrice: number | null }) => boolean
  replaceItem: (id: string, product: CatalogProduct, options?: { initialPrice: number | null }) => boolean
  addCustomItem: (input: CustomItemInput) => boolean
  updateItem: (id: string, changes: ItemChanges) => boolean
  renameCustomItem: (id: string, name: string) => boolean
  removeItem: (id: string) => void
  clearBuild: () => void
}

// Persistence diagnostics are ephemeral, and never saved into the build.
export const usePersistenceStatus = create<{ issue: string | null }>(() => ({ issue: null }))

const persistedEnvelopeSchema = z.discriminatedUnion('version', [
  z.object({ version: z.literal(1), state: legacyBuildSchema }),
  z.object({ version: z.literal(2), state: legacyDiscriminatedBuildSchema }),
  z.object({ version: z.literal(3), state: legacyDiscriminatedBuildSchema }),
  z.object({ version: z.literal(4), state: legacyQuantityBuildSchema }),
  z.object({ version: z.literal(BUILD_STORAGE_VERSION), state: persistedBuildSchema }),
])

const browserStorage: StateStorage = {
  getItem: (key) => window.localStorage.getItem(key),
  setItem: (key, value) => window.localStorage.setItem(key, value),
  removeItem: (key) => window.localStorage.removeItem(key),
}

function checkedStorage(storage: StateStorage, report: (issue: string | null) => void): StateStorage {
  return {
    getItem: async (key) => {
      try {
        const raw = await storage.getItem(key)
        if (raw === null) return null
        const result = persistedEnvelopeSchema.safeParse(JSON.parse(raw) as unknown)
        if (!result.success) throw new Error('Invalid saved build')
        return JSON.stringify(result.data)
      } catch {
        report('保存済みの構成を読み込めませんでした。新しくパーツを追加すると、このブラウザの保存内容が更新されます。')
        return null
      }
    },
    setItem: async (key, value) => {
      try {
        await storage.setItem(key, value)
        report(null)
      } catch {
        report('ブラウザに保存できませんでした。現在の構成は画面に残っていますが、リロードすると失われます。ストレージの設定や空き容量を確認してください。')
      }
    },
    removeItem: async (key) => {
      try { await storage.removeItem(key) } catch { report('ブラウザの保存内容を削除できませんでした。') }
    },
  }
}

export function createBuildStore(
  storage: StateStorage = browserStorage,
  report: (issue: string | null) => void = (issue) => usePersistenceStatus.setState({ issue }),
) {
  return create<BuildState>()(persist(
    (set, get) => ({
      items: [],
      addItem: (product, options) => {
        const category = partCategories.find(({ id }) => id === product.category)
        if (!category || (category.cardinality === 'single' && get().items.some((item) => item.kind === 'catalog' && item.category === category.id))) return false
        const item = buildItemSchema.safeParse({
          id: crypto.randomUUID(), kind: 'catalog', category: product.category, product,
          price: options?.initialPrice ?? null,
        })
        if (!item.success) return false
        set((state) => ({ items: [...state.items, item.data] }))
        return true
      },
      replaceItem: (id, product, options) => {
        const item = get().items.find((item) => item.id === id)
        if (item?.kind !== 'catalog' || item.category !== product.category) return false
        const replacement = buildItemSchema.safeParse({ ...item, product, price: options?.initialPrice ?? null })
        if (!replacement.success) return false
        set((state) => ({ items: state.items.map((item) => item.id === id ? replacement.data : item) }))
        return true
      },
      addCustomItem: (input) => {
        const parsed = customItemInputSchema.safeParse(input)
        if (!parsed.success) return false
        const item = buildItemSchema.safeParse({
          id: crypto.randomUUID(), kind: 'custom', price: null, ...parsed.data,
        })
        if (!item.success) return false
        set((state) => ({ items: [...state.items, item.data] }))
        return true
      },
      updateItem: (id, changes) => {
        const patch = itemChangesSchema.safeParse(changes)
        const item = get().items.find((item) => item.id === id)
        if (!patch.success || !item) return false
        const parsed = buildItemSchema.safeParse({ ...item, ...patch.data })
        if (!parsed.success) return false
        set((state) => ({ items: state.items.map((item) => item.id === id ? parsed.data : item) }))
        return true
      },
      renameCustomItem: (id, input) => {
        const item = get().items.find((item) => item.id === id)
        const name = customNameSchema.safeParse(input)
        if (item?.kind !== 'custom' || !name.success) return false
        const parsed = buildItemSchema.safeParse({ ...item, name: name.data })
        if (!parsed.success) return false
        set((state) => ({ items: state.items.map((item) => item.id === id ? parsed.data : item) }))
        return true
      },
      removeItem: (id) => set((state) => ({ items: state.items.filter((item) => item.id !== id) })),
      clearBuild: () => set({ items: [] }),
    }),
    {
      name: BUILD_STORAGE_KEY,
      version: BUILD_STORAGE_VERSION,
      storage: createJSONStorage(() => checkedStorage(storage, report)),
      partialize: (state) => ({ items: state.items }),
      migrate: migrateBuild,
      merge: (persisted, current) => {
        const parsed = persistedBuildSchema.safeParse(persisted)
        return parsed.success ? { ...current, items: parsed.data.items } : current
      },
    },
  ))
}

export const useBuildStore = createBuildStore()
