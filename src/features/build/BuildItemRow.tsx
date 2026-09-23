import { useId, useRef, useState, type RefObject } from 'react'
import { Trash2 } from 'lucide-react'
import { partCategories } from '../../domain/categories'
import { productSpecSummary } from '../../domain/product-summary'
import { formatYen } from '../../domain/currency'
import type { SearchRequest } from '../search/ProductSearchDialog'
import type { BuildItem } from './schemas'
import { useBuildStore } from './store'
import { PriceInput } from './PriceInput'
import { CustomItemDialog } from './CustomItemDialog'
import { OfferButton } from './OfferButton'

export function BuildItemRow({ item, productRef, onSearch, onRemove, onAnnounce }: {
  item: BuildItem; productRef?: RefObject<HTMLButtonElement | null>
  onSearch: (request: SearchRequest) => void; onRemove: () => void; onAnnounce: (message: string) => void
}) {
  const id = useId()
  const ownRef = useRef<HTMLButtonElement>(null)
  const openerRef = productRef ?? ownRef
  const [editing, setEditing] = useState(false)
  const [priceRevision, setPriceRevision] = useState(0)
  const updateItem = useBuildStore((state) => state.updateItem)
  const name = item.kind === 'catalog' ? item.product.name : item.name
  const specs = item.kind === 'catalog' ? [item.product.manufacturer, productSpecSummary(item.product)].filter(Boolean).join(' · ') : ''

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
      <PriceInput key={`${item.kind === 'catalog' ? item.product.upstream_key : item.id}:${priceRevision}`} name={name} price={item.price} onCommit={(price) => { updateItem(item.id, { price }) }} />
      {item.kind === 'catalog' && <OfferButton key={item.product.id} productId={item.product.id} name={name} onUsePrice={(price) => {
        if (updateItem(item.id, { price })) {
          // Explicit selection replaces even an invalid, uncommitted editor draft.
          setPriceRevision((revision) => revision + 1)
          onAnnounce(`${name}の価格を${formatYen(price)}に変更しました`)
        }
      }} />}
      <button type="button" className="icon-button remove-button" aria-label={`${name}を構成から削除`} onClick={onRemove}><Trash2 size={16} aria-hidden="true" /></button>
      {editing && item.kind === 'custom' && <CustomItemDialog item={item} onClose={() => setEditing(false)} onSaved={(name) => onAnnounce(`${name}に名前を変更しました`)} />}
    </li>
  )
}
