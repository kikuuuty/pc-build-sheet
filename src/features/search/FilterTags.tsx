import { useState } from 'react'
import { X } from 'lucide-react'
import { conditionTags, emptyDraft, type SearchDraft } from './filter-state'
import type { UiFilter } from './filter-config'

export function FilterTags({ definitions, draft, onChange }: { definitions: UiFilter[]; draft: SearchDraft; onChange: (draft: SearchDraft) => void }) {
  const [expanded, setExpanded] = useState(false)
  const tags = conditionTags(definitions, draft)
  if (!tags.length) return null
  return (
    <div className="filter-tags" aria-label="選択中のフィルター">
      {(expanded ? tags : tags.slice(0, 3)).map((tag) => (
        <button type="button" className="filter-tag" key={tag.key} title={tag.label} aria-label={`${tag.label}を解除`} onClick={() => onChange(tag.remove())}>
          <span>{tag.label}</span><X size={13} aria-hidden="true" />
        </button>
      ))}
      {tags.length > 3 && <button type="button" className="text-button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? '条件を省略' : `ほか${tags.length - 3}件`}</button>}
      <button type="button" className="text-button" onClick={() => onChange({ ...emptyDraft, keyword: draft.keyword })}>フィルターをすべて解除</button>
    </div>
  )
}
