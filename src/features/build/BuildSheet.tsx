import { Plus, Trash2 } from 'lucide-react'
import { partCategories, type CategoryDefinition } from '../../domain/categories'
import { productSpecSummary } from '../../domain/product-summary'
import { useBuildStore } from './store'

export function BuildSheet({ onSelect }: { onSelect: (category: CategoryDefinition) => void }) {
  const items = useBuildStore((state) => state.items)
  const removeItem = useBuildStore((state) => state.removeItem)

  return (
    <section className="sheet" aria-labelledby="sheet-title">
      <div className="sheet-header">
        <h2 id="sheet-title">構成パーツ</h2>
        <span>カテゴリからパーツを選択</span>
      </div>
      <div className="category-list">
        {partCategories.map((category, index) => {
          const selected = items.filter((item) => item.category === category.id)
          return (
            <section className="category-row" key={category.id} aria-labelledby={`category-${category.id}`}>
              <h3 id={`category-${category.id}`}><span className="category-number" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>{category.label}</h3>
              <div className="category-content">
                {selected.length > 0 && (
                  <ul className="build-items">
                    {selected.map((item) => (
                      <li className="build-item" key={item.id}>
                        <div className="product-info">
                          <p className="product-name">{item.product.name}</p>
                          <p className="product-details">{[item.product.manufacturer, productSpecSummary(item.product)].filter(Boolean).join(' · ')}</p>
                          {item.quantity > 1 && <span className="quantity">数量 {item.quantity}</span>}
                        </div>
                        <button type="button" className="icon-button remove-button" aria-label={`${item.product.name}を構成から削除`} onClick={() => removeItem(item.id)}>
                          <Trash2 size={17} aria-hidden="true" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <button type="button" className={selected.length ? 'add-another' : 'select-part'} onClick={() => onSelect(category)}>
                  <Plus size={17} aria-hidden="true" />
                  {category.label}{selected.length ? 'を追加' : 'を選択'}
                </button>
              </div>
            </section>
          )
        })}
      </div>
    </section>
  )
}
