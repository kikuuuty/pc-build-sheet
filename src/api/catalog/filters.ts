import { z } from 'zod'

const common = {
  id: z.string().regex(/^[a-z][a-z0-9_]*$/),
  label: z.string().trim().min(1),
  unit: z.string().nullable(),
}
const valueType = z.enum(['string', 'integer', 'number'])
export const filterDefinitionSchema = z.discriminatedUnion('control', [
  z.object({
    ...common, control: z.literal('multi_select'), target: z.enum(['filters', 'facets']), value_type: valueType,
    options: z.array(z.object({ value: z.union([z.string().min(1).max(200), z.number()]), label: z.string().min(1) })).max(512),
  }),
  z.object({
    ...common, control: z.literal('range'), target: z.literal('ranges'), value_type: z.enum(['integer', 'number']),
    range: z.object({ min: z.number(), max: z.number(), step: z.number().positive() }).nullable(),
  }),
]).superRefine((definition, context) => {
  const invalid = () => context.addIssue({ code: 'custom', message: 'Filter metadata types or bounds do not match' })
  if (definition.control === 'multi_select') {
    if (definition.target === 'facets' && definition.value_type !== 'string') invalid()
    if (new Set(definition.options.map(({ value }) => value)).size !== definition.options.length) invalid()
    for (const { value } of definition.options) {
      if (definition.value_type === 'string' ? typeof value !== 'string' || !value.trim()
        : typeof value !== 'number' || (definition.value_type === 'integer' && !Number.isInteger(value))) invalid()
    }
  } else if (definition.range) {
    const { min, max, step } = definition.range
    if (min > max || (definition.value_type === 'integer' && (!Number.isInteger(min) || !Number.isInteger(max) || step !== 1))) invalid()
  }
})

export const filtersResponseSchema = z.object({ category: z.string().min(1), filters: z.array(filterDefinitionSchema) })
  .refine(({ filters }) => new Set(filters.map(({ id }) => id)).size === filters.length, 'Duplicate filter IDs')

export type FilterDefinition = z.infer<typeof filterDefinitionSchema>
export type FilterMetadata = z.infer<typeof filtersResponseSchema>
export type FilterValue = string | number
export const dynamicFacetOptionSchema = z.object({
  value: z.union([z.string().min(1).max(200).refine((value) => !!value.trim()), z.number()]),
  label: z.string().refine((label) => !!label.trim()),
  count: z.number().int().positive(),
})
export const dynamicFacetResponseSchema = z.object({
  category: z.string().refine((category) => !!category.trim()),
  facets: z.record(common.id, z.object({
    options: z.array(dynamicFacetOptionSchema).max(512)
      .refine((options) => new Set(options.map(({ value }) => value)).size === options.length, 'Duplicate facet values'),
  })),
})
export type DynamicFacetOption = z.infer<typeof dynamicFacetOptionSchema>
export type DynamicFacetResponse = z.infer<typeof dynamicFacetResponseSchema>
export type SearchConditions = {
  filters?: Record<string, FilterValue[]>
  ranges?: Record<string, { min?: number; max?: number }>
  facets?: Record<string, string[]>
}

// Explicit projection shared by the facet HTTP body and cache key. Never include keyword/pagination.
export function typedConditions({ filters, ranges, facets }: SearchConditions): SearchConditions {
  return {
    ...(filters && Object.keys(filters).length ? { filters } : {}),
    ...(ranges && Object.keys(ranges).length ? { ranges } : {}),
    ...(facets && Object.keys(facets).length ? { facets } : {}),
  }
}

export function hasSearchConditions(conditions: SearchConditions): boolean {
  return Object.keys(typedConditions(conditions)).length > 0
}

export function conditionsLimitError(conditions: SearchConditions): string | undefined {
  const filters = Object.values(conditions.filters ?? {})
  const ranges = Object.values(conditions.ranges ?? {})
  const facets = Object.values(conditions.facets ?? {})
  const selections = [...filters, ...facets]
  if (selections.some((values) => values.length > 10)) return '1項目につき選択できるのは10個までです。'
  if (selections.reduce((sum, values) => sum + values.length, 0) > 40) return '選択肢は全体で40個までです。'
  if (filters.length > 8 || ranges.length > 8 || facets.length > 4 || filters.length + ranges.length + facets.length > 16) {
    return '検索条件が多すぎます。いずれかの条件を解除してください。'
  }
}
