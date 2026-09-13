import type { z } from 'zod'
import type { catalogProductSchema, catalogSourceSchema, searchResponseSchema } from './schemas'
import type { PartCategory } from '../../domain/categories'

export type CatalogProduct = z.infer<typeof catalogProductSchema>
export type CatalogSource = z.infer<typeof catalogSourceSchema>
export type SearchResponse = z.infer<typeof searchResponseSchema>
export type SearchParams = { category: PartCategory; query: string; offset?: number }
