import { useId, useRef, useState, type RefObject } from 'react'
import { Minus, Plus, Trash2 } from 'lucide-react'
import { formatYen } from '../../domain/currency'
import { partCategories } from '../../domain/categories'
import { productSpecSummary } from '../../domain/product-summary'
import type { SearchRequest } from '../search/ProductSearchDialog'
import { MAX_QUANTITY, type BuildItem } from './schemas'
import { useBuildStore } from './store'
import { getItemSubtotal } from './totals'
import { PriceInput } from './PriceInput'
import { CustomItemDialog } from './CustomItemDialog'

export function BuildItemRow({ item, productRef, onSearch, onRemove, onAnnounce }: {
  item: BuildItem; productRef?: RefObject<HTMLButtonElement | null>
  onSearch: (request: SearchRequest) => void; onRemove: () => void; onAnnounce: (message: string) => void
}) {
  const id = useId()
  const ownRef = useRef<HTMLButtonElement>(null)
  const openerRef = productRef ?? ownRef
  const [editing, setEditing] = useState(false)
  const updateItem = useBuildStore((state) => state.updateItem)
  const name = item.kind === 'catalog' ? item.product.name : item.name
  const specs = item.kind === 'catalog' ? [item.product.manufacturer, productSpecSummary(item.product)].filter(Boolean).join(' · ') : ''
  const subtotal = getItemSubtotal(item)

  return (
    <li className="build-item" aria-labelledby={`${id}-name`}>
      {/* Keep the product opener separate from the sibling controls to avoid opening search when editing them. */}
      <button ref={openerRef} type="button" className="product-selector" title={name} aria-haspopup="dialog"
        aria-label={`${name}${item.kind === 'catalog' ? 'を変更' : 'の名前を編集'}`} onClick={() => {
          if (item.kind === 'custom') setEditing(true)
          else {
            const category = partCategories.find(({ id }) => id === item.category)!
            onSearch({ category, target: { mode: 'replace', itemId: item.id }, returnFocus: openerRef })
          }
        }}>
        <span id={`${id}-name`} className="product-name">{name}</span>
        {specs && <span className="product-details" title={specs}>{specs}</span>}
      </button>
      <div className="source-toggle" role="group" aria-label={`${name}の購入区分`} aria-describedby="owned-rule">
        <button type="button" aria-pressed={item.source === 'buy'} onClick={() => updateItem(item.id, { source: 'buy' })}>購入</button>
        <button type="button" aria-pressed={item.source === 'owned'} onClick={() => updateItem(item.id, { source: 'owned' })}>流用</button>
      </div>
      <PriceInput key={item.kind === 'catalog' ? item.product.upstream_key : item.id} name={name} price={item.price} onCommit={(price) => { updateItem(item.id, { price }) }} />
      <div className="quantity-stepper" role="group" aria-label={`${name}の数量`}>
        <button type="button" aria-label={`${name}の数量を減らす`} disabled={item.quantity <= 1} onClick={() => updateItem(item.id, { quantity: item.quantity - 1 })}><Minus size={14} aria-hidden="true" /></button>
        <span aria-label={`数量 ${item.quantity}`}>{item.quantity}</span>
        <button type="button" aria-label={`${name}の数量を増やす`} disabled={item.quantity >= MAX_QUANTITY} onClick={() => updateItem(item.id, { quantity: item.quantity + 1 })}><Plus size={14} aria-hidden="true" /></button>
      </div>
      <div className="item-subtotal" role="status" aria-atomic="true">
        <span className="sr-only">{name}の小計：</span>
        <strong>{item.source === 'owned' ? '流用' : subtotal === null ? <><span aria-hidden="true">—</span><span className="sr-only">価格未入力</span></> : formatYen(subtotal)}</strong>
      </div>
      <button type="button" className="icon-button remove-button" aria-label={`${name}を構成から削除`} onClick={onRemove}><Trash2 size={16} aria-hidden="true" /></button>
      {editing && item.kind === 'custom' && <CustomItemDialog item={item} onClose={() => setEditing(false)} onSaved={(name) => onAnnounce(`${name}に名前を変更しました`)} />}
    </li>
  )
}
