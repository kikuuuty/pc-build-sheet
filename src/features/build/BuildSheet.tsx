import { useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import { customCategory, partCategories, type CategoryDefinition } from '../../domain/categories'
import type { SearchRequest } from '../search/ProductSearchDialog'
import { useBuildStore } from './store'
import type { BuildItem } from './schemas'
import { BuildItemRow } from './BuildItemRow'
import { CustomItemDialog } from './CustomItemDialog'

export function BuildSheet({ onSearch }: { onSearch: (request: SearchRequest) => void }) {
  const items = useBuildStore((state) => state.items)
  const [announcement, setAnnouncement] = useState('')

  return (
    <section className="sheet" aria-labelledby="sheet-title">
      <div className="sheet-header">
        <h2 id="sheet-title">構成パーツ</h2>
        <span>製品名から変更</span>
      </div>
      <div className="sheet-columns" aria-hidden="true">
        <span>パーツ</span><span className="number-column">価格</span><span />
      </div>
      <div className="category-list">
        {partCategories.map((category, index) => (
          <CategorySection key={category.id} category={category} index={index + 1}
            items={items.filter((item) => item.kind === 'catalog' && item.category === category.id)}
            onSearch={onSearch} onAnnounce={setAnnouncement} />
        ))}
        <CategorySection category={customCategory} items={items.filter((item) => item.kind === 'custom')} onSearch={onSearch} onAnnounce={setAnnouncement} />
      </div>
      <div className="sr-only" role="status">{announcement}</div>
    </section>
  )
}

function CategorySection({ category, index, items, onSearch, onAnnounce }: {
  category: CategoryDefinition | typeof customCategory; index?: number; items: BuildItem[]
  onSearch: (request: SearchRequest) => void; onAnnounce: (message: string) => void
}) {
  const addRef = useRef<HTMLButtonElement>(null)
  const firstItemRef = useRef<HTMLButtonElement>(null)
  const sectionRef = useRef<HTMLElement>(null)
  const [addingCustom, setAddingCustom] = useState(false)
  const removeItem = useBuildStore((state) => state.removeItem)
  const selected = items.length > 0
  const canAdd = category.cardinality === 'multiple'
  return (
    <section ref={sectionRef} className={`category-row${selected ? ' has-items' : ''}`} aria-labelledby={`category-${category.id}`}>
      <div className="category-header">
        <h3 id={`category-${category.id}`}><span className="category-number" aria-hidden="true">{index ? String(index).padStart(2, '0') : '＋'}</span>{category.label}</h3>
        {(!selected || canAdd) && <button ref={addRef} type="button" className={selected ? 'add-another' : 'select-part'} aria-haspopup="dialog"
          aria-label={category.id === 'custom' ? '任意項目を追加' : `${category.label}を${selected ? '追加' : '選択'}`}
          onClick={() => {
            if (category.id === 'custom') setAddingCustom(true)
            else onSearch({ category, target: { mode: 'add' }, returnFocus: category.cardinality === 'single' ? firstItemRef : addRef })
          }}>{selected ? <><Plus size={14} aria-hidden="true" />追加</> : <><span aria-hidden="true">—</span>{category.id === 'custom' ? '任意項目を入力' : 'パーツを選択'}</>}</button>}
      </div>
      {selected && <ul className="build-items">
        {items.map((item, index) => <BuildItemRow key={item.id} item={item} productRef={index === 0 ? firstItemRef : undefined}
          onSearch={onSearch} onAnnounce={onAnnounce} onRemove={() => {
            removeItem(item.id)
            onAnnounce(`${item.kind === 'catalog' ? item.product.name : item.name}を構成から削除しました`)
            // The empty-category opener may be mounted by this update; focus after the render.
            requestAnimationFrame(() => {
              const target = sectionRef.current?.querySelector<HTMLButtonElement>('.product-selector') ?? addRef.current
              target?.focus()
            })
          }} />)}
      </ul>}
      {addingCustom && <CustomItemDialog onClose={() => setAddingCustom(false)} onSaved={(name) => onAnnounce(`${name}を構成に追加しました`)} />}
    </section>
  )
}
