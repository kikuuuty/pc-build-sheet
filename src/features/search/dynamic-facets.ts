import type { DynamicFacetResponse } from '../../api/catalog/filters'
import { NVME_SSD, type UiFilter } from './filter-config'
import type { SearchDraft } from './filter-state'

// Display-only projection: the compiler and tags continue to use static definitions.
export function mergeDynamicFacetOptions(definitions: UiFilter[], response: DynamicFacetResponse | undefined, selections: SearchDraft['selections']): UiFilter[] {
  if (!response) return definitions
  return definitions.map((definition) => {
    if (definition.control !== 'multi_select') return definition
    const facet = response.facets[definition.id]
    if (!facet) return definition
    const selected = selections[definition.id] ?? []
    const unavailableValues: (string | number)[] = []
    const options = definition.options.flatMap((option) => {
      // This composite UI value is not a backend facet. Preserve the existing NVMe UX.
      if (definition.id === 'storage_type' && option.value === NVME_SSD) return [option]
      const dynamic = facet.options.find(({ value }) => value === option.value)
      if (dynamic) return [{ ...dynamic, label: option.label }]
      if (!selected.includes(option.value)) return []
      unavailableValues.push(option.value)
      return [option]
    })
    return { ...definition, options, unavailableValues }
  })
}
