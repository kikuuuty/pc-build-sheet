import type { PartCategory } from '../../domain/categories'

export const PSU_HEADROOM = 1.25
export const PSU_CAPACITIES_W = [450, 500, 550, 600, 650, 700, 750, 800, 850, 900, 1000, 1200, 1300, 1500, 1600, 2000] as const

// Keys are normalized form factors, not substrings (e.g. XL ATX is not ATX).
export const MOTHERBOARD_POWER_W: Readonly<Record<string, number>> = {
  miniitx: 35, microatx: 45, matx: 45, atx: 50, eatx: 60, extendedatx: 60,
}
export const DEFAULT_MOTHERBOARD_POWER_W = 50
export const DIMM_POWER_W = 5
export const DEFAULT_MEMORY_POWER_W = 10
export const STORAGE_POWER_W = { nvme: 8, sataSsd: 5, hdd: 12, unknown: 8 } as const
export const COOLER_POWER_W = { air: 5, water: 20 } as const
export const CASE_FAN_POWER_W = 3

// Only explicitly included categories draw power from the PC's PSU estimate.
export const FIXED_CATEGORY_POWER_W: Readonly<Partial<Record<PartCategory, number>>> = {
  network_card: 10, sound_card: 10, capture_card: 10, lighting: 10,
}
