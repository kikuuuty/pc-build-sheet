import { z } from 'zod'
import { catalogProductSchema } from '../../api/catalog/schemas'
import { partCategorySchema } from '../../domain/categories'

export const MAX_PRICE = 100_000_000
export const MAX_QUANTITY = 99
export const MAX_MEMO_LENGTH = 1000
export const MAX_NAME_LENGTH = 200

export const editableFieldsSchema = z.object({
  quantity: z.number().int().min(1).max(MAX_QUANTITY),
  price: z.number().int().min(0).max(MAX_PRICE).nullable(),
  source: z.enum(['buy', 'owned']),
  memo: z.string().max(MAX_MEMO_LENGTH),
})
export const itemChangesSchema = editableFieldsSchema.partial().strict()
export const customNameSchema = z.string().trim().min(1).max(MAX_NAME_LENGTH)
export const customItemInputSchema = editableFieldsSchema.partial().extend({ name: customNameSchema }).strict()

const catalogFields = {
  id: z.string().min(1),
  category: partCategorySchema,
  product: catalogProductSchema,
  ...editableFieldsSchema.shape,
}

const catalogBuildItemSchema = z.object({
  ...catalogFields,
  kind: z.literal('catalog'),
}).refine((item) => item.category === item.product.category, { message: 'Product category must match build item' })

const customBuildItemSchema = editableFieldsSchema.extend({
  id: z.string().min(1),
  kind: z.literal('custom'),
  name: customNameSchema,
})

export const buildItemSchema = z.discriminatedUnion('kind', [catalogBuildItemSchema, customBuildItemSchema])

const uniqueIds = ({ items }: { items: { id: string }[] }) => new Set(items.map((item) => item.id)).size === items.length
export const persistedBuildSchema = z.object({ items: z.array(buildItemSchema) }).refine(uniqueIds,
  { message: 'Build item IDs must be unique' },
)

// Validate legacy snapshots before adding the discriminator; never invent missing fields.
export const legacyBuildSchema = z.object({
  items: z.array(z.object(catalogFields).refine((item) => item.category === item.product.category)),
}).refine(uniqueIds,
  { message: 'Build item IDs must be unique' },
)

export function migrateV1Build(state: unknown) {
  const legacy = legacyBuildSchema.parse(state)
  return persistedBuildSchema.parse({ items: legacy.items.map((item) => ({ ...item, kind: 'catalog' })) })
}

export type BuildItem = z.infer<typeof buildItemSchema>
export type ItemChanges = z.infer<typeof itemChangesSchema>
export type CustomItemInput = z.infer<typeof customItemInputSchema>
