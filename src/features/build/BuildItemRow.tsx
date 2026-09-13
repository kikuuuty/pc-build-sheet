import { useId, useState } from 'react'
import { Minus, Plus, Trash2 } from 'lucide-react'
import { formatYen } from '../../domain/currency'
import { productSpecSummary } from '../../domain/product-summary'
import { MAX_QUANTITY, type BuildItem } from './schemas'
import { useBuildStore } from './store'
import { getItemSubtotal } from './totals'
import { PriceInput } from './PriceInput'
import { ItemDetailsDialog } from './ItemDetailsDialog'

export function BuildItemRow({ item, onRemove, onAnnounce }: { item: BuildItem; onRemove: () => void; onAnnounce: (message: string) => void }) {
  const id = useId()
  const [editing, setEditing] = useState(false)
  const updateItem = useBuildStore((state) => state.updateItem)
  const name = item.kind === 'catalog' ? item.product.name : item.name
  const subtotal = getItemSubtotal(item)

  return (
    <li className="build-item" aria-labelledby={`${id}-name`}>
      <div className="item-heading">
        <div className="product-info">
          <p id={`${id}-name`} className="product-name">{name}</p>
          {item.kind === 'catalog' && <p className="product-details">{[item.product.manufacturer, productSpecSummary(item.product)].filter(Boolean).join(' · ')}</p>}
        </div>
        <button type="button" className="icon-button remove-button" aria-label={`${name}を構成から削除`} onClick={onRemove}><Trash2 size={17} aria-hidden="true" /></button>
      </div>
      <div className="item-controls">
        <div className="source-field">
          <span className="control-label">区分</span>
          <div className="source-toggle" role="group" aria-label={`${name}の購入区分`} aria-describedby="owned-rule">
            <button type="button" aria-pressed={item.source === 'buy'} onClick={() => updateItem(item.id, { source: 'buy' })}>購入</button>
            <button type="button" aria-pressed={item.source === 'owned'} onClick={() => updateItem(item.id, { source: 'owned' })}>流用</button>
          </div>
        </div>
        <PriceInput name={name} price={item.price} onCommit={(price) => { updateItem(item.id, { price }) }} />
        <div className="quantity-field">
          <span className="control-label">数量</span>
          <div className="quantity-stepper" role="group" aria-label={`${name}の数量`}>
            <button type="button" aria-label={`${name}の数量を減らす`} disabled={item.quantity <= 1} onClick={() => updateItem(item.id, { quantity: item.quantity - 1 })}><Minus size={14} aria-hidden="true" /></button>
            <span aria-label={`数量 ${item.quantity}`}>{item.quantity}</span>
            <button type="button" aria-label={`${name}の数量を増やす`} disabled={item.quantity >= MAX_QUANTITY} onClick={() => updateItem(item.id, { quantity: item.quantity + 1 })}><Plus size={14} aria-hidden="true" /></button>
          </div>
        </div>
        <div className="item-subtotal" role="status" aria-atomic="true">
          <span className="control-label"><span className="sr-only">{name}の</span>小計</span>
          <strong>{item.source === 'owned' ? '流用' : subtotal === null ? <><span aria-hidden="true">—</span><span className="sr-only">価格未入力</span></> : formatYen(subtotal)}</strong>
        </div>
      </div>
      <div className="item-notes">
        {item.memo && <p className="item-memo" aria-label={`${name}のメモ`}>{item.memo}</p>}
        <button type="button" className="text-button details-button" aria-label={`${name}の${item.kind === 'custom' ? '名前・メモを編集' : 'メモを編集'}`} onClick={() => setEditing(true)}>
          {item.kind === 'custom' ? '名前・メモを編集' : item.memo ? 'メモを編集' : 'メモを追加'}
        </button>
      </div>
      {editing && <ItemDetailsDialog item={item} onClose={() => setEditing(false)} onSaved={(name) => onAnnounce(`${name}を更新しました`)} />}
    </li>
  )
}
