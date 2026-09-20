import { z } from 'zod'

export const additionGroups = [
  { id: 'expansion_cards', label: '拡張カード' },
  { id: 'peripherals', label: '周辺機器' },
  { id: 'audio_video', label: '音声・映像機器' },
  { id: 'assembly', label: 'その他' },
] as const

type CategoryRegistration = {
  id: string; label: string; cardinality: 'single' | 'multiple'
} & ({ placement: 'main' } | {
  placement: 'optional'
  // null excludes a category from new-category suggestions, not from saved builds/API parsing.
  additionGroup: (typeof additionGroups)[number]['id'] | null
})

// Registry order is the display order, including optional sections once selected.
export const partCategories = [
  { id: 'cpu', label: 'CPU', placement: 'main', cardinality: 'single' },
  { id: 'cpu_cooler', label: 'CPUクーラー', placement: 'main', cardinality: 'single' },
  { id: 'memory', label: 'メモリ', placement: 'main', cardinality: 'multiple' },
  { id: 'motherboard', label: 'マザーボード', placement: 'main', cardinality: 'single' },
  { id: 'gpu', label: 'GPU', placement: 'main', cardinality: 'single' },
  { id: 'storage', label: 'ストレージ', placement: 'main', cardinality: 'multiple' },
  { id: 'psu', label: '電源', placement: 'main', cardinality: 'single' },
  { id: 'case', label: 'ケース', placement: 'main', cardinality: 'single' },
  { id: 'case_fan', label: 'ケースファン', placement: 'main', cardinality: 'multiple' },
  { id: 'os', label: 'OS', placement: 'main', cardinality: 'single' },
  { id: 'monitor', label: 'モニター', placement: 'optional', cardinality: 'multiple', additionGroup: 'peripherals' },
  { id: 'keyboard', label: 'キーボード', placement: 'optional', cardinality: 'multiple', additionGroup: 'peripherals' },
  { id: 'mouse', label: 'マウス', placement: 'optional', cardinality: 'multiple', additionGroup: 'peripherals' },
  { id: 'headphones', label: 'ヘッドホン', placement: 'optional', cardinality: 'multiple', additionGroup: 'audio_video' },
  { id: 'speaker', label: 'スピーカー', placement: 'optional', cardinality: 'multiple', additionGroup: 'audio_video' },
  { id: 'microphone', label: 'マイク', placement: 'optional', cardinality: 'multiple', additionGroup: 'audio_video' },
  { id: 'webcam', label: 'Webカメラ', placement: 'optional', cardinality: 'multiple', additionGroup: 'audio_video' },
  { id: 'capture_card', label: 'キャプチャーカード', placement: 'optional', cardinality: 'multiple', additionGroup: 'expansion_cards' },
  { id: 'network_card', label: 'ネットワークカード', placement: 'optional', cardinality: 'multiple', additionGroup: 'expansion_cards' },
  { id: 'sound_card', label: 'サウンドカード', placement: 'optional', cardinality: 'multiple', additionGroup: 'expansion_cards' },
  { id: 'vr_headset', label: 'VRヘッドセット', placement: 'optional', cardinality: 'single', additionGroup: null },
  { id: 'mousepad', label: 'マウスパッド', placement: 'optional', cardinality: 'multiple', additionGroup: 'peripherals' },
  { id: 'desk', label: 'デスク', placement: 'optional', cardinality: 'single', additionGroup: null },
  { id: 'chair', label: 'チェア', placement: 'optional', cardinality: 'single', additionGroup: null },
  { id: 'stand', label: 'スタンド', placement: 'optional', cardinality: 'multiple', additionGroup: null },
  { id: 'lighting', label: '照明', placement: 'optional', cardinality: 'multiple', additionGroup: null },
  { id: 'laptop', label: 'ノートPC', placement: 'optional', cardinality: 'single', additionGroup: null },
  { id: 'prebuilt_desktop', label: '完成品PC', placement: 'optional', cardinality: 'single', additionGroup: null },
  { id: 'thermal_compound', label: 'サーマルペースト', placement: 'optional', cardinality: 'multiple', additionGroup: 'assembly' },
  { id: 'accessory', label: 'アクセサリー', placement: 'optional', cardinality: 'multiple', additionGroup: 'assembly' },
] as const satisfies readonly CategoryRegistration[]

// Kept only to display custom items from existing saves; new custom entry is retired.
export const customCategory = { id: 'custom', label: '保存済みの任意項目', cardinality: 'multiple' } as const
export type CategoryDefinition = (typeof partCategories)[number]
export type PartCategory = CategoryDefinition['id']
export const partCategorySchema = z.enum(partCategories.map(({ id }) => id))
export const mainCategories = partCategories.filter((category) => category.placement === 'main')
export const optionalCategories = partCategories.filter((category) => category.placement === 'optional')
export const addableOptionalCategories = optionalCategories.filter((category) => category.additionGroup !== null)
