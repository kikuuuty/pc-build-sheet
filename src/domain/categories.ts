import { z } from 'zod'

// Display order and API category mapping have a single source of truth.
export const partCategories = [
  { id: 'cpu', label: 'CPU', cardinality: 'single' },
  { id: 'cpu_cooler', label: 'CPUクーラー', cardinality: 'single' },
  { id: 'motherboard', label: 'マザーボード', cardinality: 'single' },
  { id: 'memory', label: 'メモリ', cardinality: 'multiple' },
  { id: 'gpu', label: 'GPU', cardinality: 'single' },
  { id: 'storage', label: 'ストレージ', cardinality: 'multiple' },
  { id: 'psu', label: '電源', cardinality: 'single' },
  { id: 'case', label: 'ケース', cardinality: 'single' },
  { id: 'case_fan', label: 'ケースファン', cardinality: 'multiple' },
] as const

export const customCategory = { id: 'custom', label: 'その他', cardinality: 'multiple' } as const
export type CategoryDefinition = (typeof partCategories)[number]
export type PartCategory = CategoryDefinition['id']
export const partCategorySchema = z.enum(partCategories.map(({ id }) => id))
