import { useId, useState } from 'react'
import { formatYen } from '../../domain/currency'
import { MAX_PRICE } from './schemas'
import { parsePriceInput } from './price-input'

export function PriceInput({ name, price, onCommit }: { name: string; price: number | null; onCommit: (price: number | null) => void }) {
  const id = useId()
  const [draft, setDraft] = useState<string | null>(null)
  const [invalid, setInvalid] = useState(false)
  const [focused, setFocused] = useState(false)
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
      <label className="sr-only" htmlFor={id}>価格：{name}（円）</label>
      <div className="price-input-wrapper">
        <input id={id} type="text" inputMode="numeric" autoComplete="off" maxLength={24}
          className={!focused && draft === null ? 'price-resting' : undefined}
          placeholder="未入力" value={draft ?? (price === null ? '' : String(price))}
          aria-invalid={invalid} aria-describedby={invalid ? `${id}-error` : undefined}
          onChange={(event) => { setDraft(event.target.value); setInvalid(false) }}
          onFocus={() => setFocused(true)}
          onBlur={() => { commit(); setFocused(false) }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return
            if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur() }
            if (event.key === 'Escape') { setDraft(null); setInvalid(false) }
          }}
        />
        {focused && <span className="price-unit" aria-hidden="true">円</span>}
        {!focused && draft === null && <span className={`price-display${price === null ? ' unpriced' : ''}`} aria-hidden="true">{price === null ? '未入力' : formatYen(price)}</span>}
      </div>
      {invalid && <p id={`${id}-error`} className="field-error" role="alert">0〜{formatYen(MAX_PRICE)}の整数を入力してください。変更は未保存です（Escで取消）。</p>}
    </div>
  )
}
