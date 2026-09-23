import fixture from './fixtures/cpu-search.json' with { type: 'json' }
import { catalogProductSchema } from '../api/catalog/schemas'
import type { CatalogProduct } from '../api/catalog/types'
import type { PartCategory } from '../domain/categories'
import type { BuildItem } from '../features/build/schemas'

// Synthetic contract-valid products. Unspecified specs are deliberately unknown.
export function powerProduct<C extends PartCategory>(category: C, specs: Partial<Extract<CatalogProduct, { category: C }>['specs']> = {}) {
  const variant = catalogProductSchema.options.find((option) => option.shape.category.value === category)!
  const unknownSpecs = Object.fromEntries(Object.keys(variant.shape.specs.shape).map((key) => [key, null]))
  return catalogProductSchema.parse({
    ...fixture.data[0], category, name: `Power test ${category}`, upstream_key: `${category}/power-test`,
    specs: { ...unknownSpecs, ...specs },
  }) as Extract<CatalogProduct, { category: C }>
}

export function powerItem(product: CatalogProduct, id: string = product.category): BuildItem {
  return { kind: 'catalog', id, category: product.category, product, price: null }
}
