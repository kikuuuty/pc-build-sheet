import type { DynamicFacetResponse, FilterDefinition, FilterMetadata, FilterValue, SearchConditions } from '../api/catalog/filters'

// Synthetic metadata for deterministic UI/contract tests, not a copy of the catalog.
export function selection(id: string, label: string, values: FilterValue[], target: 'filters' | 'facets' = 'filters'): FilterDefinition {
  return { id, label, unit: null, control: 'multi_select', target, value_type: typeof values[0] === 'number' ? 'integer' : 'string', options: values.map((value) => ({ value, label: String(value) })) }
}
export function range(id: string, label: string, integer = false): FilterDefinition {
  return { id, label, unit: null, control: 'range', target: 'ranges', value_type: integer ? 'integer' : 'number', range: { min: 0, max: 1000, step: 1 } }
}
export const cpuFilters: FilterMetadata = { category: 'cpu', filters: [
  selection('manufacturer', 'メーカー', ['AMD', 'Intel']),
  selection('family', 'ファミリー', ['Ryzen 7', 'Core i7']),
  selection('socket', 'ソケット', ['AM4', 'AM5', 'LGA1700', 'LGA1851']),
  selection('generation', '世代', ['9000']),
  range('core_count', 'コア数', true), range('tdp_w', 'TDP'),
  { ...selection('includes_cooler', 'クーラー付属', [0, 1]), options: [{ value: 0, label: 'なし' }, { value: 1, label: 'あり' }] } as FilterDefinition,
] }

export function staticFacets(metadata: FilterMetadata): DynamicFacetResponse {
  return { category: metadata.category, facets: Object.fromEntries(metadata.filters.flatMap((definition) => definition.control === 'multi_select'
    ? [[definition.id, { options: definition.options.map((option) => ({ ...option, count: 1 })) }]] : [])) }
}

// Fixed tiny catalog, used only by tests to provide self-excluding backend responses.
const cpus = [
  { manufacturer: 'AMD', family: 'Ryzen 7', socket: 'AM4' },
  { manufacturer: 'AMD', family: 'Ryzen 7', socket: 'AM5' },
  { manufacturer: 'Intel', family: 'Core i7', socket: 'LGA1700' },
  { manufacturer: 'Intel', family: 'Core i7', socket: 'LGA1851' },
]
export function cpuFacets(conditions: SearchConditions = {}): DynamicFacetResponse {
  const response = staticFacets(cpuFilters)
  for (const id of ['manufacturer', 'family', 'socket'] as const) {
    response.facets[id].options = response.facets[id].options.filter(({ value }) => cpus.some((cpu) => cpu[id] === value
      && Object.entries(conditions.filters ?? {}).every(([field, values]) => field === id || !(field in cpu) || values.includes(cpu[field as keyof typeof cpu]))))
  }
  return response
}
export const storageFilters: FilterMetadata = { category: 'storage', filters: [
  selection('manufacturer', 'メーカー', ['Samsung']), selection('storage_type', 'ストレージ種類', ['SSD', 'HDD', 'SSHD']),
  selection('nvme', 'NVMe', [0, 1]), selection('form_factor', 'フォームファクター', ['M.2-2280', '2.5"']),
  selection('interface', 'インターフェース', ['M.2 PCIe 4.0 x4', 'M.2 PCIe 5.0 x4']), range('capacity_gb', '容量'), range('pcie_generation', 'PCIe世代'),
] }
export const monitorFilters: FilterMetadata = { category: 'monitor', filters: [
  selection('manufacturer', 'メーカー', ['Dell']), range('screen_size_inches', '画面サイズ'), range('refresh_rate_hz', 'リフレッシュレート'),
  selection('panel_type', 'パネル種類', ['IPS', 'OLED']), selection('ports', '映像入力端子', ['hdmi_2_1', 'usb_c'], 'facets'),
] }
