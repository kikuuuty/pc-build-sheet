import { useRef, useState } from 'react'
import type { PartCategory } from '../../domain/categories'
import { getFilterLayout, optionLabel, resolutionPresets, type UiFilter } from './filter-config'
import { emptyRange, resolutionPreset, selectValues, setRange, setResolutionPreset, type SearchDraft } from './filter-state'

type Props = {
  category: PartCategory
  definitions: UiFilter[]
  draft: SearchDraft
  errors: Record<string, string>
  onChange: (draft: SearchDraft) => void
  updating?: boolean
}

export function FilterPanel({ category, definitions, draft, errors, onChange, updating }: Props) {
  const layout = getFilterLayout(category)
  function renderField(id: string) {
    if (id === 'resolution_preset') return (
      <div className="filter-field" key={id}>
        <label htmlFor="resolution-preset">解像度</label>
        <select id="resolution-preset" value={resolutionPreset(draft)} onChange={(event) => onChange(setResolutionPreset(draft, event.target.value))}>
          <option value="">指定なし</option>
          {resolutionPresets.map(({ id, label }) => <option key={id} value={id}>{label}</option>)}
          <option value="custom" disabled>カスタム（詳細条件で編集）</option>
        </select>
      </div>
    )
    const definition = definitions.find((definition) => definition.id === id)
    return definition && <FilterField key={id} {...{ category, definition, draft, onChange, updating }} error={errors[id]} />
  }
  const hasDetails = layout.detail.some((id) => definitions.some((definition) => definition.id === id))
  return (
    <>
      <p className="filter-help">変更から300ms後に自動検索します。選択中の条件に合わせて候補を更新します。</p>
      {layout.basic.map(renderField)}
      {hasDetails && <details className="advanced-filters"><summary>詳細条件</summary>{layout.detail.map(renderField)}</details>}
      {definitions.length === 0 && <p className="filter-help">このカテゴリで利用できるフィルターはありません。</p>}
      {errors._limits && <p className="field-error" role="alert">{errors._limits}</p>}
    </>
  )
}

function FilterField({ category, definition, draft, onChange, error, updating }: Omit<Props, 'definitions' | 'errors'> & { definition: UiFilter; error?: string }) {
  const id = `filter-${definition.id}`
  if (definition.control === 'range') {
    const value = draft.ranges[definition.id] ?? emptyRange
    const unavailable = !definition.range && !definition.customRange
    return (
      <fieldset className="filter-field" disabled={unavailable}>
        <legend>{definition.label}{definition.unit && `（${definition.unit}）`}</legend>
        <div className="filter-range">
          {(['min', 'max'] as const).map((bound) => (
            <label key={bound}>
              <span>{bound === 'min' ? '最小' : '最大'}</span>
              <input type="text" inputMode={definition.value_type === 'integer' ? 'numeric' : 'decimal'}
                aria-label={`${definition.label}の${bound === 'min' ? '最小値' : '最大値'}`} maxLength={24}
                aria-invalid={!!error} aria-describedby={`${id}-hint${error ? ` ${id}-error` : ''}`}
                placeholder="指定なし" value={value[bound]}
                onChange={(event) => onChange(setRange(draft, definition.id, { ...value, [bound]: event.target.value }))} />
            </label>
          ))}
        </div>
        <p id={`${id}-hint`} className="filter-help">{unavailable ? '範囲情報なし' : definition.range
          ? `カタログ範囲: ${definition.range.min}～${definition.range.max}${definition.unit ? ` ${definition.unit}` : ''}` : '片側だけの指定もできます。'}</p>
        {definition.hint && <p className="filter-help">{definition.hint}</p>}
        {error && <p id={`${id}-error`} className="field-error" role="alert">{error}</p>}
      </fieldset>
    )
  }
  const values = draft.selections[definition.id] ?? []
  const incompatible = !!definition.unavailableValues?.length
  const message = error ?? (incompatible ? 'この条件は現在の他条件と両立しません。解除して選び直してください。' : undefined)
  if (definition.single) return (
    <div className="filter-field">
      <label htmlFor={id}>{definition.label}</label>
      <select id={id} disabled={!definition.options.length && !values.length} value={values.length ? String(definition.options.findIndex(({ value }) => value === values[0])) : ''}
        aria-invalid={!!message} onChange={(event) => onChange(selectValues(draft, definition.id, event.target.value === '' ? [] : [definition.options[Number(event.target.value)].value]))}>
        <option value="">{definition.options.length ? '指定なし' : '候補なし'}</option>
        {values.length > 0 && !definition.options.some(({ value }) => value === values[0]) && <option value="-1" disabled>利用できない条件</option>}
        {definition.options.map(({ value }, index) => <option key={value} value={index} disabled={definition.unavailableValues?.includes(value) || (updating && !values.includes(value))}>{optionLabel(definition, value)}{definition.unavailableValues?.includes(value) ? '（現在利用できません）' : ''}</option>)}
      </select>
      {message && <p className="field-error" role="alert">{message}</p>}
    </div>
  )
  return <MultiSelect {...{ category, definition, draft, onChange, updating }} error={message} />
}

function MultiSelect({ definition, draft, onChange, error, updating }: Omit<Props, 'definitions' | 'errors'> & { definition: Extract<UiFilter, { control: 'multi_select' }>; error?: string }) {
  const [query, setQuery] = useState('')
  const details = useRef<HTMLDetailsElement>(null)
  const values = draft.selections[definition.id] ?? []
  const labels = values.map((value) => optionLabel(definition, value))
  const options = definition.options.filter(({ value }) => optionLabel(definition, value).toLowerCase().includes(query.trim().toLowerCase()) || String(value).toLowerCase().includes(query.trim().toLowerCase()))
  const selectedCount = Object.values(draft.selections).reduce((sum, values) => sum + values.length, 0)
  return (
    <div className="filter-field">
      <span id={`filter-label-${definition.id}`}>{definition.label}</span>
      <details ref={details} className="filter-select" onKeyDown={(event) => {
        if (event.key === 'Escape' && details.current?.open) {
          event.preventDefault(); event.stopPropagation(); details.current.open = false
          details.current.querySelector('summary')?.focus()
        }
      }}>
        <summary aria-label={`${definition.label}を選択`}>
          <span>{labels.length ? `${labels.slice(0, 2).join('、')}${labels.length > 2 ? ` ＋${labels.length - 2}` : ''}` : definition.options.length ? '指定なし' : '候補なし'}</span>
        </summary>
        <div className="filter-options" role="group" aria-labelledby={`filter-label-${definition.id}`}>
          <input type="search" aria-label={`${definition.label}の候補を検索`} placeholder="候補を検索…" value={query} onChange={(event) => setQuery(event.target.value)} />
          <div className="filter-option-list">
            {options.map(({ value }) => {
              const checked = values.includes(value)
              const next = selectValues(draft, definition.id, checked ? values.filter((selected) => selected !== value) : [...values, value])
              // The global compiler checks limits again before any request is sent.
              const disabled = !checked && (updating || values.length >= 10 || selectedCount >= 40)
              return <label className="filter-option" key={`${typeof value}:${value}`}>
                <input type="checkbox" checked={checked} disabled={disabled} onChange={() => onChange(next)} />
                <span>{optionLabel(definition, value)}{definition.unavailableValues?.includes(value) && '（現在利用できません）'}</span>
              </label>
            })}
            {!options.length && <p className="filter-help">候補がありません。</p>}
          </div>
          <p className="filter-help">{values.length}/10個選択・同じ項目内はいずれかに一致</p>
          {selectedCount >= 40 && <p className="filter-help">全体の選択上限（40個）に達しています。</p>}
        </div>
      </details>
      {error && <p className="field-error" role="alert">{error}</p>}
    </div>
  )
}
