import { useId, useState } from 'react'
import { formatYen } from '../../domain/currency'
import { MAX_PRICE } from './schemas'
import { parsePriceInput } from './price-input'

export function PriceInput({ name, price, onCommit }: { name: string; price: number | null; onCommit: (price: number | null) => void }) {
  const id = useId()
  const [draft, setDraft] = useState<string | null>(null)
  const [invalid, setInvalid] = useState(false)
  function commit() {
    if (draft === null) return
    const value = parsePriceInput(draft)
    if (value === undefined) { setInvalid(true); return }
    onCommit(value)
    setDraft(null)
    setInvalid(false)
  }
  return (
    <div className="price-field">
      <label htmlFor={id}>単価<span className="sr-only">：{name}（円）</span></label>
      <div className="price-input-wrapper">
        <input id={id} type="text" inputMode="numeric" autoComplete="off" maxLength={24}
          placeholder="未入力" value={draft ?? (price === null ? '' : String(price))}
          aria-invalid={invalid} aria-describedby={invalid ? `${id}-error` : undefined}
          onChange={(event) => { setDraft(event.target.value); setInvalid(false) }}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return
            if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur() }
            if (event.key === 'Escape') { setDraft(null); setInvalid(false) }
          }}
        />
        <span aria-hidden="true">円</span>
      </div>
      {invalid && <p id={`${id}-error`} className="field-error" role="alert">0〜{formatYen(MAX_PRICE)}の整数を入力してください。変更は未保存です（Escで取消）。</p>}
    </div>
  )
}
