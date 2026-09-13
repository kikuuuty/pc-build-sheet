import { useRef, useState } from 'react'
import { Dialog } from '../../components/Dialog'
import { MAX_MEMO_LENGTH, MAX_NAME_LENGTH, type BuildItem } from './schemas'
import { useBuildStore } from './store'

export function ItemDetailsDialog({ item, onClose, onSaved }: { item?: BuildItem; onClose: () => void; onSaved: (name: string) => void }) {
  const custom = !item || item.kind === 'custom'
  const initialName = item ? item.kind === 'custom' ? item.name : item.product.name : ''
  const [name, setName] = useState(initialName)
  const [memo, setMemo] = useState(item?.memo ?? '')
  const [error, setError] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)
  const memoRef = useRef<HTMLTextAreaElement>(null)
  const addCustomItem = useBuildStore((state) => state.addCustomItem)
  const updateItem = useBuildStore((state) => state.updateItem)
  const updateCustomDetails = useBuildStore((state) => state.updateCustomDetails)

  return (
    <Dialog variant="edit" title={!item ? '任意項目を追加' : custom ? '任意項目を編集' : 'メモを編集'} titleId="item-details-title" onClose={onClose} initialFocus={custom ? nameRef : memoRef}>
      <form className="item-details-form" onSubmit={(event) => {
        event.preventDefault()
        const saved = !item ? addCustomItem({ name, memo })
          : item.kind === 'custom' ? updateCustomDetails(item.id, { name, memo })
            : updateItem(item.id, { memo })
        if (!saved) { setError(true); return }
        onSaved(name.trim())
        onClose()
      }}>
        {custom ? <label htmlFor="custom-name">名前（必須）<input ref={nameRef} id="custom-name" value={name} required maxLength={MAX_NAME_LENGTH} onChange={(event) => setName(event.target.value)} /></label>
          : <p className="product-name">{initialName}</p>}
        <label htmlFor="item-memo">メモ<textarea ref={memoRef} id="item-memo" rows={4} maxLength={MAX_MEMO_LENGTH} value={memo} onChange={(event) => setMemo(event.target.value)} aria-describedby="memo-limit" /></label>
        <p id="memo-limit" className="field-hint">{memo.length} / {MAX_MEMO_LENGTH}文字</p>
        {!item && <p className="field-hint">追加後、シートで単価・数量・購入/流用を設定できます。</p>}
        {error && <p className="field-error" role="alert">名前は空白以外の1〜{MAX_NAME_LENGTH}文字、メモは{MAX_MEMO_LENGTH}文字以内で入力してください。</p>}
        <div className="dialog-actions">
          <button type="button" className="button secondary" onClick={onClose}>キャンセル</button>
          <button type="submit" className="button primary">{item ? '保存する' : '追加する'}</button>
        </div>
      </form>
    </Dialog>
  )
}
