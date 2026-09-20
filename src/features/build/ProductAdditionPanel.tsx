import { Plus } from 'lucide-react'
import { additionGroups, addableOptionalCategories } from '../../domain/categories'
import type { SearchRequest } from '../search/ProductSearchDialog'
import type { OptionalCategoryFocus } from './category-focus'
import { useBuildStore } from './store'

export function ProductAdditionPanel({ onSearch, optionalRefs }: {
  onSearch: (request: SearchRequest) => void; optionalRefs: OptionalCategoryFocus
}) {
  const items = useBuildStore((state) => state.items)
  const selectedCategories = new Set(items.flatMap((item) => item.kind === 'catalog' ? [item.category] : []))
  const availableCategories = addableOptionalCategories.filter((category) => !selectedCategories.has(category.id))

  return (
    <section className="optional-products" aria-labelledby="optional-products-title">
      <h2 id="optional-products-title">製品を追加</h2>
      {additionGroups.map((group) => {
        const categories = availableCategories.filter((category) => category.additionGroup === group.id)
        if (categories.length === 0) return null
        return (
          <div key={group.id} className="optional-category-group" role="group" aria-labelledby={`addition-group-${group.id}`}>
            <h3 id={`addition-group-${group.id}`}>{group.label}</h3>
            <div className="optional-category-buttons">
              {categories.map((category) => (
                <button key={category.id} ref={optionalRefs.get(category.id)!.add} type="button" className="button secondary"
                  aria-label={`${category.label}を追加`} aria-haspopup="dialog"
                  onClick={() => onSearch({ category, target: { mode: 'add' },
                    returnFocus: optionalRefs.get(category.id)!.product,
                  })}><Plus size={12} aria-hidden="true" /><span>{category.label}</span></button>
              ))}
            </div>
          </div>
        )
      })}
      {availableCategories.length === 0 && <p className="field-hint">追加できるカテゴリはすべて構成に含まれています。</p>}
    </section>
  )
}
