import type { CatalogProduct } from '../api/catalog/types'

const unit = (value: number | null | undefined, suffix: string) => typeof value === 'number' && Number.isFinite(value) ? `${value}${suffix}` : null
const tdp = (value: number | null | undefined) => {
  const watts = unit(value, 'W')
  return watts === null ? null : `TDP ${watts}`
}

// A compact display projection, separate from the catalog and build models.
export function productSpecSummary(product: CatalogProduct): string {
  let values: (string | null | undefined)[] = []
  switch (product.category) {
    case 'cpu':
      values = [product.specs.socket, unit(product.specs.core_count, 'コア'), unit(product.specs.thread_count, 'スレッド'), tdp(product.specs.tdp_w)]
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
      values = [product.specs.chipset, unit(product.specs.vram_gb, 'GB'), product.specs.memory_type, tdp(product.specs.tdp_w)]
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
    case 'monitor':
      values = [unit(product.specs.screen_size_inches, 'インチ'),
        product.specs.resolution_width != null && product.specs.resolution_height != null
          ? `${product.specs.resolution_width}×${product.specs.resolution_height}` : null,
        unit(product.specs.refresh_rate_hz, 'Hz')]
      break
    case 'keyboard':
      values = [product.specs.size, product.specs.switch_type, product.specs.layout]
      break
    case 'mouse':
      values = [product.specs.shape, unit(product.specs.weight_g, 'g'), unit(product.specs.polling_rate_hz, 'Hz')]
      break
    case 'headphones':
      values = [product.specs.headphone_type, product.specs.ear_cup_type]
      break
    case 'webcam':
      values = [product.specs.resolution, unit(product.specs.frame_rate_fps, 'fps')]
      break
  }
  return values.filter((value) => typeof value === 'string' && value.trim() !== '').join(' / ')
}
