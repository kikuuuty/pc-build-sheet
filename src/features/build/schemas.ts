import { z } from 'zod'
import { catalogProductSchema } from '../../api/catalog/schemas'
import { partCategorySchema } from '../../domain/categories'

export const buildItemSchema = z.object({
  id: z.string().min(1),
  category: partCategorySchema,
  product: catalogProductSchema,
  quantity: z.number().int().positive(),
  price: z.number().nonnegative().nullable(),
  source: z.enum(['buy', 'owned']),
  memo: z.string(),
}).refine((item) => item.category === item.product.category, { message: 'Product category must match build item' })

export const persistedBuildSchema = z.object({ items: z.array(buildItemSchema) }).refine(
  ({ items }) => new Set(items.map((item) => item.id)).size === items.length,
  { message: 'Build item IDs must be unique' },
)
export type BuildItem = z.infer<typeof buildItemSchema>
