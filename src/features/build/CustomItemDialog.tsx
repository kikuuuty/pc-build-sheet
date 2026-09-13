import { useRef, useState } from 'react'
import { Dialog } from '../../components/Dialog'
import { MAX_NAME_LENGTH, type BuildItem } from './schemas'
import { useBuildStore } from './store'

export function CustomItemDialog({ item, onClose, onSaved }: { item?: Extract<BuildItem, { kind: 'custom' }>; onClose: () => void; onSaved: (name: string) => void }) {
  const [name, setName] = useState(item?.name ?? '')
  const [error, setError] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)
  const addCustomItem = useBuildStore((state) => state.addCustomItem)
  const renameCustomItem = useBuildStore((state) => state.renameCustomItem)

  return (
    <Dialog variant="edit" title={!item ? '任意項目を追加' : '任意項目名を編集'} titleId="custom-item-title" onClose={onClose} initialFocus={nameRef}>
      <form className="custom-item-form" onSubmit={(event) => {
        event.preventDefault()
        const saved = !item ? addCustomItem({ name }) : renameCustomItem(item.id, name)
        if (!saved) { setError(true); return }
        onSaved(name.trim())
        onClose()
      }}>
        <label htmlFor="custom-name">名前（必須）<input ref={nameRef} id="custom-name" value={name} required maxLength={MAX_NAME_LENGTH} onChange={(event) => setName(event.target.value)} /></label>
        {!item && <p className="field-hint">追加後、シートで単価・数量・購入/流用を設定できます。</p>}
        {error && <p className="field-error" role="alert">名前は空白以外の1〜{MAX_NAME_LENGTH}文字で入力してください。</p>}
        <div className="dialog-actions">
          <button type="button" className="button secondary" onClick={onClose}>キャンセル</button>
          <button type="submit" className="button primary">{item ? '保存する' : '追加する'}</button>
        </div>
      </form>
    </Dialog>
  )
}
