import type { CatalogProduct } from '../../api/catalog/types'
import type { BuildItem } from './schemas'
import {
  CASE_FAN_POWER_W, COOLER_POWER_W, DEFAULT_MEMORY_POWER_W, DEFAULT_MOTHERBOARD_POWER_W,
  DIMM_POWER_W, FIXED_CATEGORY_POWER_W, MOTHERBOARD_POWER_W, PSU_CAPACITIES_W, PSU_HEADROOM, STORAGE_POWER_W,
} from './power-constants'

export type PowerBreakdown = {
  cpu: number; gpu: number; motherboard: number; memory: number; storage: number
  cpuCooler: number; caseFans: number; expansionCards: number
}
export type SelectedPsu = {
  itemId: string; name: string; wattage: number | null; isBelowRecommendation: boolean | null
}
export type PowerSummary = {
  estimatedPowerW: number
  recommendedPsuW: number | null
  hasPowerParts: boolean
  hasMissingPowerData: boolean
  missingPowerItems: { itemId: string; category: 'cpu' | 'gpu'; name: string }[]
  breakdown: PowerBreakdown
  selectedPsus: SelectedPsu[]
}

function positiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

function positiveCount(value: unknown): number | null {
  const number = positiveNumber(value)
  return number !== null && Number.isSafeInteger(number) ? number : null
}

function normalizedText(value: unknown): string {
  return typeof value === 'string' ? value.normalize('NFKC').trim().toLowerCase() : ''
}

function motherboardPower(formFactor: unknown): number {
  const key = normalizedText(formFactor).replace(/[\s\-‐‑–—_]/g, '')
  return Object.hasOwn(MOTHERBOARD_POWER_W, key) ? MOTHERBOARD_POWER_W[key] : DEFAULT_MOTHERBOARD_POWER_W
}

function storagePower(specs: Extract<CatalogProduct, { category: 'storage' }>['specs']): number {
  const type = normalizedText(specs.storage_type)
  const connection = normalizedText(specs.interface)
  // Disk type takes precedence: a SATA HDD is not a SATA SSD.
  if (type === 'hdd' || type === 'sshd') return STORAGE_POWER_W.hdd
  if (specs.nvme === 1 || /\bnvme\b/.test(connection) || /\bpcie\b/.test(connection)) return STORAGE_POWER_W.nvme
  if (type === 'ssd' && /\b(?:sata|msata)\b/.test(connection)) return STORAGE_POWER_W.sataSsd
  return STORAGE_POWER_W.unknown
}

/** Derived from saved product specs only; does not mutate items or request catalog data. */
export function getPowerSummary(items: readonly BuildItem[]): PowerSummary {
  const breakdown: PowerBreakdown = { cpu: 0, gpu: 0, motherboard: 0, memory: 0, storage: 0, cpuCooler: 0, caseFans: 0, expansionCards: 0 }
  const missingPowerItems: PowerSummary['missingPowerItems'] = []
  const selectedPsus: SelectedPsu[] = []
  const seen = new Set<string>()
  let hasKnownPrimaryPower = false

  for (const item of items) {
    // Identity is the build row, not the catalog product: separate copies still count.
    if (seen.has(item.id) || item.kind !== 'catalog') continue
    seen.add(item.id)
    const product = item.product
    switch (product.category) {
      case 'cpu':
      case 'gpu': {
        const watts = (product.category === 'cpu' ? positiveNumber(product.specs.ppt_w) : null)
          ?? positiveNumber(product.specs.tdp_w)
        if (watts === null) missingPowerItems.push({ itemId: item.id, category: product.category, name: product.name })
        else {
          breakdown[product.category] += watts
          hasKnownPrimaryPower = true
        }
        break
      }
      case 'motherboard': breakdown.motherboard += motherboardPower(product.specs.form_factor); break
      case 'memory': {
        const count = positiveCount(product.specs.kit_quantity)
        breakdown.memory += count === null ? DEFAULT_MEMORY_POWER_W : count * DIMM_POWER_W
        break
      }
      case 'storage': breakdown.storage += storagePower(product.specs); break
      // Cooler fans and pump are included in this allowance; fan_quantity is not added.
      case 'cpu_cooler': breakdown.cpuCooler += product.specs.water_cooled === 1 ? COOLER_POWER_W.water : COOLER_POWER_W.air; break
      case 'case_fan': breakdown.caseFans += (positiveCount(product.specs.quantity) ?? 1) * CASE_FAN_POWER_W; break
      case 'psu': selectedPsus.push({ itemId: item.id, name: product.name, wattage: positiveNumber(product.specs.wattage), isBelowRecommendation: null }); break
      default: breakdown.expansionCards += FIXED_CATEGORY_POWER_W[product.category] ?? 0
    }
  }

  const estimatedPowerW = Object.values(breakdown).reduce((sum, watts) => sum + watts, 0)
  const recommendedRaw = estimatedPowerW * PSU_HEADROOM
  // Do not recommend a PSU from peripherals alone or from entirely missing CPU/GPU data.
  const recommendedPsuW = hasKnownPrimaryPower
    ? PSU_CAPACITIES_W.find((watts) => watts >= recommendedRaw) ?? Math.ceil(recommendedRaw)
    : null
  for (const psu of selectedPsus) {
    // Legacy builds can contain multiple PSU rows: compare individually, never pool capacity.
    if (psu.wattage !== null && recommendedPsuW !== null) psu.isBelowRecommendation = psu.wattage < recommendedPsuW
  }
  return {
    estimatedPowerW, recommendedPsuW, breakdown, selectedPsus, missingPowerItems,
    hasPowerParts: estimatedPowerW > 0 || missingPowerItems.length > 0,
    hasMissingPowerData: missingPowerItems.length > 0,
  }
}
