import type { FilterDefinition, FilterMetadata, FilterValue } from '../../api/catalog/filters'
import type { PartCategory } from '../../domain/categories'

type FilterLayout = { basic: string[]; detail: string[] }
const layouts: Partial<Record<PartCategory, FilterLayout>> = {
  cpu: { basic: ['manufacturer', 'family', 'socket'], detail: ['core_count', 'tdp_w', 'includes_cooler'] },
  cpu_cooler: { basic: ['manufacturer', 'water_cooled', 'height_mm', 'radiator_size_mm'], detail: ['fan_size_mm'] },
  memory: { basic: ['manufacturer', 'ram_type', 'speed', 'capacity_gb', 'kit_quantity'], detail: ['ecc', 'xmp', 'expo'] },
  motherboard: { basic: ['manufacturer', 'socket', 'chipset', 'form_factor', 'ram_type'], detail: ['memory_slots', 'max_memory_gb', 'm2_slots', 'back_connect'] },
  gpu: { basic: ['manufacturer', 'chip_vendor', 'chip_series', 'vram_gb'], detail: ['length_mm', 'tdp_w', 'memory_type'] },
  storage: { basic: ['manufacturer', 'storage_type', 'form_factor', 'interface', 'capacity_gb'], detail: [] },
  psu: { basic: ['manufacturer', 'form_factor', 'wattage', 'efficiency_rating'], detail: ['modular', 'length_mm', 'pcie_12vhpwr'] },
  case: { basic: ['manufacturer', 'form_factor', 'max_gpu_length_mm', 'max_cpu_cooler_height_mm'], detail: ['max_psu_length_mm', 'volume_l', 'supports_back_connect'] },
  case_fan: { basic: ['manufacturer', 'size_mm', 'flow_direction', 'pwm'], detail: ['connector', 'quantity'] },
  os: { basic: [], detail: [] },
  monitor: { basic: ['manufacturer', 'screen_size_inches', 'resolution_preset', 'refresh_rate_hz', 'panel_type'], detail: ['resolution_width', 'resolution_height', 'aspect_ratio', 'response_time_ms', 'hdr', 'adaptive_sync', 'ports'] },
  keyboard: { basic: ['manufacturer', 'size', 'switch_type', 'connectivity'], detail: ['layout', 'hot_swappable', 'polling_rate_hz', 'features'] },
  mouse: { basic: ['manufacturer', 'connectivity', 'shape', 'weight_g'], detail: ['size', 'grip_types', 'polling_rate_hz', 'max_dpi'] },
  headphones: { basic: ['manufacturer', 'ear_cup_type', 'connection_types', 'has_microphone'], detail: ['headphone_type', 'weight_g', 'features', 'platforms'] },
  microphone: { basic: ['manufacturer', 'connectivity_type', 'polar_pattern'], detail: ['features'] },
  webcam: { basic: ['manufacturer', 'resolution', 'frame_rate_fps', 'connectivity_type'], detail: [] },
}
export function getFilterLayout(category: PartCategory): FilterLayout {
  return layouts[category] ?? { basic: ['manufacturer'], detail: [] }
}

export const NVME_SSD = '__nvme_ssd'
export const resolutionPresets = [
  { id: 'fhd', label: 'フルHD（1920×1080）', width: 1920, height: 1080 },
  { id: 'wuxga', label: 'WUXGA（1920×1200）', width: 1920, height: 1200 },
  { id: 'wqhd', label: 'WQHD（2560×1440）', width: 2560, height: 1440 },
  { id: 'uwqhd', label: 'UWQHD（3440×1440）', width: 3440, height: 1440 },
  { id: 'uhd', label: '4K UHD（3840×2160）', width: 3840, height: 2160 },
]

const optionLabels: Record<string, Record<string, string>> = {
  modular: { Full: 'フルプラグイン', 'Semi-Modular': 'セミプラグイン', 'Non-Modular': '直付け' },
  flow_direction: { Standard: '標準', Reverse: 'リバース' },
  switch_type: { Linear: 'リニア', Tactile: 'タクタイル', Clicky: 'クリッキー', Magnetic: '磁気式', Membrane: 'メンブレン' },
  shape: { Ambidextrous: '左右対称型', Ergonomic: 'エルゴノミクス型' },
  size: { Small: '小型', Medium: '中型', Large: '大型', 'Full Size': 'フルサイズ', 'TKL (80%)': 'テンキーレス（80%）', Numpad: 'テンキー', Other: 'その他' },
  grip_types: { Claw: 'つかみ持ち', Fingertip: 'つまみ持ち', Palm: 'かぶせ持ち' },
  headphone_type: { 'Closed-Back': '密閉型', 'Open-Back': '開放型', 'Semi-Open': '半開放型' },
  ear_cup_type: { 'Over-Ear': 'オーバーイヤー', 'On-Ear': 'オンイヤー', 'In-Ear': 'カナル型', Earbuds: 'インナーイヤー型' },
  has_microphone: { '0': 'なし', '1': 'あり' },
  polar_pattern: { Cardioid: '単一指向性（カーディオイド）', Omnidirectional: '全指向性', Bidirectional: '双指向性', 'Multi-Pattern': '複数パターン' },
  platforms: { Console: 'ゲーム機', Mobile: 'モバイル', PC: 'PC' },
  features: { Knob: 'ノブ', 'Low Profile': 'ロープロファイル', Screen: '画面', Silent: '静音', ANC: 'ANC', 'App Support': 'アプリ対応', 'EQ Customization': 'EQカスタマイズ', 'Multi-Device Pairing': '複数デバイスのペアリング', 'Spatial Audio': '空間オーディオ', 'Gain Control': 'ゲイン調整', 'Mute Button': 'ミュートボタン', 'RGB Lighting': 'RGBライティング' },
  ports: { displayport_1_4a: 'DisplayPort 1.4a', displayport_2_1: 'DisplayPort 2.1', hdmi_2_0: 'HDMI 2.0', hdmi_2_0b: 'HDMI 2.0b', hdmi_2_1: 'HDMI 2.1', hdmi_2_2: 'HDMI 2.2', usb_c: 'USB-C' },
}
const connectionLabels: Record<string, string> = { Wired: '有線', 'Wired USB-A': 'USB-A有線', 'Wired USB-C': 'USB-C有線', 'Wired 3.5mm': '3.5mm有線', 'Wireless 2.4GHz': '2.4GHz無線', 'Wireless RF': '無線RF' }
export function optionLabel(definition: FilterDefinition, value: FilterValue): string {
  const original = definition.control === 'multi_select' ? definition.options.find((option) => option.value === value)?.label : undefined
  return optionLabels[definition.id]?.[String(value)]
    ?? (['connectivity', 'connectivity_type', 'connection_types'].includes(definition.id) ? connectionLabels[String(value)] : undefined)
    ?? original ?? String(value)
}

export type UiFilter = FilterDefinition & { single?: boolean; customRange?: boolean; hint?: string }
const booleans = new Set(['includes_cooler', 'water_cooled', 'xmp', 'expo', 'back_connect', 'supports_back_connect', 'pwm', 'hot_swappable', 'has_microphone'])

export function getUiFilters(category: PartCategory, metadata?: FilterMetadata): UiFilter[] {
  if (!metadata || category === 'os') return []
  const layout = getFilterLayout(category)
  const allowed = new Set([...layout.basic, ...layout.detail])
  const definitions: UiFilter[] = metadata.filters.filter(({ id }) => allowed.has(id)).map((definition) => ({ ...definition, single: booleans.has(definition.id) }))
  for (const definition of definitions) {
    if (category === 'gpu' && definition.id === 'manufacturer') definition.label = 'ボードメーカー'
    if (category === 'case' && definition.id === 'form_factor') definition.label = 'ケースタイプ'
    if (category === 'case_fan' && definition.id === 'quantity') definition.label = 'セット個数'
    if (definition.id === 'ear_cup_type') definition.label = '装着タイプ'
    if (category === 'storage' && definition.id === 'capacity_gb') definition.hint = '1TB＝1,000GB'
    if (category === 'case' && definition.id === 'max_gpu_length_mm') definition.hint = '搭載するGPUの長さ以上を下限に指定'
    if (category === 'case' && definition.id === 'max_cpu_cooler_height_mm') definition.hint = '搭載するクーラーの高さ以上を下限に指定'
    if (category === 'storage' && definition.id === 'storage_type' && definition.control === 'multi_select') {
      definition.single = true
      definition.options = definition.options.map((option) => option.value === 'SSD' ? { ...option, label: 'SSD（すべて）' } : option)
      const nvme = metadata.filters.find(({ id }) => id === 'nvme')
      if (definition.options.some(({ value }) => value === 'SSD') && nvme?.control === 'multi_select' && nvme.options.some(({ value }) => value === 1)) {
        definition.options = [...definition.options, { value: NVME_SSD, label: 'NVMe SSD' }]
      }
      const order = ['SSD', NVME_SSD, 'HDD', 'SSHD']
      definition.options.sort((a, b) => {
        const rank = (value: FilterValue) => { const index = order.indexOf(String(value)); return index < 0 ? order.length : index }
        return rank(a.value) - rank(b.value)
      })
    }
  }
  // Documented POST fields; discovery deliberately does not advertise their bounds.
  if (category === 'monitor') for (const [id, label] of [['resolution_width', '横解像度'], ['resolution_height', '縦解像度']]) {
    definitions.push({ id, label, control: 'range', target: 'ranges', value_type: 'integer', unit: 'px', range: null, customRange: true })
  }
  return definitions
}
