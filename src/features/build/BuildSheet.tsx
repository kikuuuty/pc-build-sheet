import { useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import { partCategories, type CategoryDefinition } from '../../domain/categories'
import { useBuildStore } from './store'
import type { BuildItem } from './schemas'
import { BuildItemRow } from './BuildItemRow'
import { ItemDetailsDialog } from './ItemDetailsDialog'

export function BuildSheet({ onSelect }: { onSelect: (category: CategoryDefinition) => void }) {
  const items = useBuildStore((state) => state.items)
  const [addingCustom, setAddingCustom] = useState(false)
  const [announcement, setAnnouncement] = useState('')

  return (
    <section className="sheet" aria-labelledby="sheet-title">
      <div className="sheet-header">
        <h2 id="sheet-title">構成パーツ</h2>
        <span>カテゴリからパーツを選択</span>
      </div>
      <div className="category-list">
        {partCategories.map((category, index) => {
          const selected = items.filter((item) => item.kind === 'catalog' && item.category === category.id)
          return (
            <section className="category-row" key={category.id} aria-labelledby={`category-${category.id}`}>
              <h3 id={`category-${category.id}`}><span className="category-number" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>{category.label}</h3>
              <CategoryItems items={selected} addLabel={`${category.label}${selected.length ? 'を追加' : 'を選択'}`} onAdd={() => onSelect(category)} onAnnounce={setAnnouncement} />
            </section>
          )
        })}
        <section className="category-row" aria-labelledby="category-custom">
          <h3 id="category-custom"><span className="category-number" aria-hidden="true">＋</span>その他</h3>
          <CategoryItems items={items.filter((item) => item.kind === 'custom')} addLabel="任意項目を追加" onAdd={() => setAddingCustom(true)} onAnnounce={setAnnouncement} />
        </section>
      </div>
      <div className="sr-only" role="status">{announcement}</div>
      {addingCustom && <ItemDetailsDialog onClose={() => setAddingCustom(false)} onSaved={(name) => setAnnouncement(`${name}を構成に追加しました`)} />}
    </section>
  )
}

function CategoryItems({ items, addLabel, onAdd, onAnnounce }: { items: BuildItem[]; addLabel: string; onAdd: () => void; onAnnounce: (message: string) => void }) {
  const addRef = useRef<HTMLButtonElement>(null)
  const removeItem = useBuildStore((state) => state.removeItem)
  return (
    <div className="category-content">
      {items.length > 0 && <ul className="build-items">
        {items.map((item) => <BuildItemRow key={item.id} item={item} onAnnounce={onAnnounce} onRemove={() => {
          addRef.current?.focus()
          removeItem(item.id)
          onAnnounce(`${item.kind === 'catalog' ? item.product.name : item.name}を構成から削除しました`)
        }} />)}
      </ul>}
      <button ref={addRef} type="button" className={items.length ? 'add-another' : 'select-part'} onClick={onAdd}><Plus size={17} aria-hidden="true" />{addLabel}</button>
    </div>
  )
}
