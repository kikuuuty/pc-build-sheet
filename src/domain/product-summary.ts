import type { CatalogProduct } from '../api/catalog/types'

const unit = (value: number | null, suffix: string) => value === null ? null : `${value}${suffix}`

// A compact display projection, separate from the catalog and build models.
export function productSpecSummary(product: CatalogProduct): string {
  let values: (string | null)[]
  switch (product.category) {
    case 'cpu':
      values = [product.specs.socket, unit(product.specs.core_count, 'コア'), unit(product.specs.thread_count, 'スレッド')]
      break
    case 'cpu_cooler':
      values = [product.specs.water_cooled === null ? null : product.specs.water_cooled === 1 ? '水冷' : '空冷',
        product.specs.water_cooled === 1 ? unit(product.specs.radiator_size_mm, 'mmラジエーター') : unit(product.specs.height_mm, 'mm高')]
      break
    case 'motherboard':
      values = [product.specs.socket, product.specs.chipset, product.specs.form_factor]
      break
    case 'memory':
      values = [product.specs.ram_type, unit(product.specs.capacity_gb, 'GB'), unit(product.specs.kit_quantity, '枚組')]
      break
    case 'gpu':
      values = [product.specs.chipset, unit(product.specs.vram_gb, 'GB'), product.specs.memory_type]
      break
    case 'storage':
      values = [product.specs.storage_type, unit(product.specs.capacity_gb, 'GB'), product.specs.form_factor]
      break
    case 'psu':
      values = [unit(product.specs.wattage, 'W'), product.specs.efficiency_rating, product.specs.form_factor]
      break
    case 'case':
      values = [product.specs.form_factor, unit(product.specs.volume_l, 'L')]
      break
    case 'case_fan':
      values = [unit(product.specs.size_mm, 'mm'), product.specs.pwm === 1 ? 'PWM' : null, unit(product.specs.quantity, '個入り')]
      break
  }
  return values.filter((value) => value !== null && value.trim() !== '').join(' / ')
}
