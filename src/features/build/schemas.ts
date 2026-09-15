import { z } from 'zod'
import { catalogProductSchema } from '../../api/catalog/schemas'
import { partCategorySchema } from '../../domain/categories'

export const MAX_PRICE = 100_000_000
export const MAX_NAME_LENGTH = 200

export const editableFieldsSchema = z.object({
  price: z.number().int().min(0).max(MAX_PRICE).nullable(),
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

// Only legacy storage has a purchase source. Validate it before converting owned prices to zero.
const legacySourceFields = { source: z.enum(['buy', 'owned']) }
const legacyQuantityFields = { quantity: z.number().int().min(1).max(99) }
// v1 lacks the discriminator. Zod strips obsolete fields (including memo) in v1/v2.
// Cardinality is an addition rule, not a restoration rule: preserve legacy duplicate rows.
export const legacyBuildSchema = z.object({
  items: z.array(z.object({ ...catalogFields, ...legacySourceFields, ...legacyQuantityFields }).refine((item) => item.category === item.product.category)),
}).refine(uniqueIds,
  { message: 'Build item IDs must be unique' },
)

export const legacyDiscriminatedBuildSchema = z.object({
  items: z.array(z.discriminatedUnion('kind', [
    catalogBuildItemSchema.safeExtend({ ...legacySourceFields, ...legacyQuantityFields }),
    customBuildItemSchema.extend({ ...legacySourceFields, ...legacyQuantityFields }),
  ])),
}).refine(uniqueIds, { message: 'Build item IDs must be unique' })

export const legacyQuantityBuildSchema = z.object({
  items: z.array(z.discriminatedUnion('kind', [
    catalogBuildItemSchema.safeExtend(legacyQuantityFields),
    customBuildItemSchema.extend(legacyQuantityFields),
  ])),
}).refine(uniqueIds, { message: 'Build item IDs must be unique' })

export function migrateBuild(state: unknown, version: number) {
  if (![1, 2, 3, 4].includes(version)) throw new Error('Unsupported build version')
  const items = version === 1
    ? legacyBuildSchema.parse(state).items.map((item) => ({ ...item, kind: 'catalog' }))
    : version === 4 ? legacyQuantityBuildSchema.parse(state).items : legacyDiscriminatedBuildSchema.parse(state).items
  const usedIds = new Set(items.map((item) => item.id))
  // Expand in place, keeping original IDs and preserving prices, counts and legacy duplicate categories.
  return persistedBuildSchema.parse({ items: items.flatMap((item) => Array.from({ length: item.quantity }, (_, index) => {
    let id = item.id
    if (index > 0) {
      id = `${item.id}:copy:${index}`
      while (usedIds.has(id)) id += ':'
      usedIds.add(id)
    }
    return { ...item, id, price: 'source' in item && item.source === 'owned' ? 0 : item.price }
  })) })
}

export type BuildItem = z.infer<typeof buildItemSchema>
export type ItemChanges = z.infer<typeof itemChangesSchema>
export type CustomItemInput = z.infer<typeof customItemInputSchema>
