import { create } from 'zustand'
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware'
import { z } from 'zod'
import type { CatalogProduct } from '../../api/catalog/types'
import { persistedBuildSchema, type BuildItem } from './schemas'

export const BUILD_STORAGE_KEY = 'pc-build-sheet:build'
export const BUILD_STORAGE_VERSION = 1

type BuildState = {
  items: BuildItem[]
  addItem: (product: CatalogProduct) => void
  removeItem: (id: string) => void
  clearBuild: () => void
}

// Persistence diagnostics are ephemeral, and never saved into the build.
export const usePersistenceStatus = create<{ issue: string | null }>(() => ({ issue: null }))

const persistedEnvelopeSchema = z.object({
  version: z.literal(BUILD_STORAGE_VERSION),
  state: persistedBuildSchema,
})

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
    (set) => ({
      items: [],
      addItem: (product) => set((state) => ({
        items: [...state.items, {
          id: crypto.randomUUID(), category: product.category, product,
          quantity: 1, price: null, source: 'buy', memo: '',
        }],
      })),
      removeItem: (id) => set((state) => ({ items: state.items.filter((item) => item.id !== id) })),
      clearBuild: () => set({ items: [] }),
    }),
    {
      name: BUILD_STORAGE_KEY,
      version: BUILD_STORAGE_VERSION,
      storage: createJSONStorage(() => checkedStorage(storage, report)),
      partialize: (state) => ({ items: state.items }),
      merge: (persisted, current) => {
        const parsed = persistedBuildSchema.safeParse(persisted)
        return parsed.success ? { ...current, items: parsed.data.items } : current
      },
    },
  ))
}

export const useBuildStore = createBuildStore()
