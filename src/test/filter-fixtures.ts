import type { FilterDefinition, FilterMetadata, FilterValue } from '../api/catalog/filters'

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
  selection('socket', 'ソケット', ['AM4', 'AM5']),
  selection('generation', '世代', ['9000']),
  range('core_count', 'コア数', true), range('tdp_w', 'TDP'),
  { ...selection('includes_cooler', 'クーラー付属', [0, 1]), options: [{ value: 0, label: 'なし' }, { value: 1, label: 'あり' }] } as FilterDefinition,
] }
export const storageFilters: FilterMetadata = { category: 'storage', filters: [
  selection('manufacturer', 'メーカー', ['Samsung']), selection('storage_type', 'ストレージ種類', ['SSD', 'HDD', 'SSHD']),
  selection('nvme', 'NVMe', [0, 1]), selection('form_factor', 'フォームファクター', ['M.2-2280', '2.5"']),
  selection('interface', 'インターフェース', ['M.2 PCIe 4.0 x4', 'M.2 PCIe 5.0 x4']), range('capacity_gb', '容量'), range('pcie_generation', 'PCIe世代'),
] }
export const monitorFilters: FilterMetadata = { category: 'monitor', filters: [
  selection('manufacturer', 'メーカー', ['Dell']), range('screen_size_inches', '画面サイズ'), range('refresh_rate_hz', 'リフレッシュレート'),
  selection('panel_type', 'パネル種類', ['IPS', 'OLED']), selection('ports', '映像入力端子', ['hdmi_2_1', 'usb_c'], 'facets'),
] }
