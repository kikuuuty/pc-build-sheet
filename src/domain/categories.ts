import { z } from 'zod'

// Display order and API category mapping have a single source of truth.
export const partCategories = [
  { id: 'cpu', label: 'CPU' },
  { id: 'cpu_cooler', label: 'CPUクーラー' },
  { id: 'motherboard', label: 'マザーボード' },
  { id: 'memory', label: 'メモリ' },
  { id: 'gpu', label: 'GPU' },
  { id: 'storage', label: 'ストレージ' },
  { id: 'psu', label: '電源' },
  { id: 'case', label: 'ケース' },
  { id: 'case_fan', label: 'ケースファン' },
] as const

export type CategoryDefinition = (typeof partCategories)[number]
export type PartCategory = CategoryDefinition['id']
export const partCategorySchema = z.enum(partCategories.map(({ id }) => id))
