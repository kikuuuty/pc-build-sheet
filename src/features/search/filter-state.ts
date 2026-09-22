import { create } from 'zustand'
import { conditionsLimitError, type FilterValue, type SearchConditions } from '../../api/catalog/filters'
import type { PartCategory } from '../../domain/categories'
import { NVME_SSD, optionLabel, resolutionPresets, type UiFilter } from './filter-config'

export type RangeDraft = { min: string; max: string }
export type SearchDraft = { keyword: string; selections: Record<string, FilterValue[]>; ranges: Record<string, RangeDraft> }
export const emptyDraft: SearchDraft = { keyword: '', selections: {}, ranges: {} }
export const emptyRange: RangeDraft = { min: '', max: '' }

// Memory only: shared between add/replace, deliberately absent from build persistence.
export const useSearchSession = create<{
  drafts: Partial<Record<PartCategory, SearchDraft>>
  update: (category: PartCategory, draft: SearchDraft) => void
}>((set) => ({ drafts: {}, update: (category, draft) => set((state) => ({ drafts: { ...state.drafts, [category]: draft } })) }))

export function selectValues(draft: SearchDraft, id: string, values: FilterValue[]): SearchDraft {
  const selections = { ...draft.selections }
  if (values.length) selections[id] = values
  else delete selections[id]
  return { ...draft, selections }
}
export function setRange(draft: SearchDraft, id: string, value: RangeDraft): SearchDraft {
  const ranges = { ...draft.ranges }
  if (value.min || value.max) ranges[id] = value
  else delete ranges[id]
  return { ...draft, ranges }
}
export function setResolutionPreset(draft: SearchDraft, id: string): SearchDraft {
  const preset = resolutionPresets.find((preset) => preset.id === id)
  const withWidth = setRange(draft, 'resolution_width', preset ? { min: String(preset.width), max: String(preset.width) } : emptyRange)
  return setRange(withWidth, 'resolution_height', preset ? { min: String(preset.height), max: String(preset.height) } : emptyRange)
}
export function resolutionPreset(draft: SearchDraft): string {
  const width = draft.ranges.resolution_width ?? emptyRange
  const height = draft.ranges.resolution_height ?? emptyRange
  if (!width.min && !width.max && !height.min && !height.max) return ''
  return resolutionPresets.find((preset) => [width.min, width.max].every((value) => value.trim() && Number(value) === preset.width)
    && [height.min, height.max].every((value) => value.trim() && Number(value) === preset.height))?.id ?? 'custom'
}

export function compileConditions(category: PartCategory, definitions: UiFilter[], draft: SearchDraft) {
  const conditions: Required<SearchConditions> = { filters: {}, ranges: {}, facets: {} }
  const errors: Record<string, string> = {}
  for (const [id, values] of Object.entries(draft.selections)) {
    if (!values.length) continue
    const definition = definitions.find((definition) => definition.id === id)
    if (!definition || definition.control !== 'multi_select' || values.some((value) => !definition.options.some((option) => option.value === value))) {
      errors[id] = 'この条件は現在利用できません。解除して選び直してください。'
      continue
    }
    if (definition.single && values.length > 1) { errors[id] = '1つ選択してください。'; continue }
    if (category === 'storage' && id === 'storage_type' && values[0] === NVME_SSD) {
      conditions.filters.storage_type = ['SSD']
      conditions.filters.nvme = [1]
    } else if (definition.target === 'facets') conditions.facets[id] = values as string[]
    else conditions.filters[id] = values
  }
  for (const [id, draftRange] of Object.entries(draft.ranges)) {
    if (!draftRange.min && !draftRange.max) continue
    const definition = definitions.find((definition) => definition.id === id)
    if (!definition || definition.control !== 'range' || (!definition.range && !definition.customRange)) {
      errors[id] = 'この条件は現在利用できません。解除してください。'
      continue
    }
    const bounds: { min?: number; max?: number } = {}
    for (const bound of ['min', 'max'] as const) {
      const raw = draftRange[bound].trim()
      if (!raw) continue
      const value = Number(raw)
      if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw) || !Number.isFinite(value)
        || (definition.value_type === 'integer' && !Number.isSafeInteger(value))) {
        errors[id] = definition.value_type === 'integer' ? '整数を入力してください。' : '有効な数値を入力してください。'
      } else bounds[bound] = value
    }
    if (bounds.min !== undefined && bounds.max !== undefined && bounds.min > bounds.max) errors[id] = '最小値は最大値以下にしてください。'
    if (Object.keys(bounds).length) conditions.ranges[id] = bounds
  }
  const limitError = conditionsLimitError(conditions)
  if (limitError) errors._limits = limitError
  // Omit empty groups as well as empty values. This also preserves the cached GET path.
  const compact: SearchConditions = {}
  if (Object.keys(conditions.filters).length) compact.filters = conditions.filters
  if (Object.keys(conditions.ranges).length) compact.ranges = conditions.ranges
  if (Object.keys(conditions.facets).length) compact.facets = conditions.facets
  return { conditions: compact, errors }
}

export function conditionTags(definitions: UiFilter[], draft: SearchDraft) {
  const tags: { key: string; label: string; remove: () => SearchDraft }[] = []
  for (const [id, values] of Object.entries(draft.selections)) {
    const definition = definitions.find((definition) => definition.id === id)
    for (const value of values) tags.push({ key: `${id}:${typeof value}:${value}`, label: `${definition?.label ?? id}: ${definition ? optionLabel(definition, value) : value}`,
      remove: () => selectValues(draft, id, values.filter((selected) => selected !== value)) })
  }
  for (const [id, range] of Object.entries(draft.ranges)) {
    const definition = definitions.find((definition) => definition.id === id)
    const unit = definition?.unit ? ` ${definition.unit}` : ''
    const value = range.min && range.max ? `${range.min}～${range.max}${unit}` : range.min ? `${range.min}${unit}以上` : `${range.max}${unit}以下`
    tags.push({ key: id, label: `${definition?.label ?? id}: ${value}`, remove: () => setRange(draft, id, emptyRange) })
  }
  return tags
}
