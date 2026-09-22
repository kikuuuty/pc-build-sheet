import type { z } from 'zod'
import type { catalogCategorySchema, catalogProductSchema, catalogSourceSchema, categoriesResponseSchema, searchResponseSchema } from './schemas'
import type { PartCategory } from '../../domain/categories'
import type { SearchConditions } from './filters'

export type CatalogProduct = z.infer<typeof catalogProductSchema>
export type CatalogSource = z.infer<typeof catalogSourceSchema>
export type SearchResponse = z.infer<typeof searchResponseSchema>
export type CatalogCategory = z.infer<typeof catalogCategorySchema>
export type CategoriesResponse = z.infer<typeof categoriesResponseSchema>
export type SearchParams = { category: PartCategory; conditions?: SearchConditions } & (
  | { mode: 'keyword'; query: string; offset?: number; cursor?: never }
  | { mode: 'listing'; cursor?: string; query?: never; offset?: never }
)
