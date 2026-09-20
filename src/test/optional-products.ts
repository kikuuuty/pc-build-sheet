import fixture from './fixtures/cpu-search.json'
import type { PartCategory } from '../domain/categories'

// Independent examples of extended-models.js scalar specs. GET search omits facets.
export const extendedSpecs: Partial<Record<PartCategory, Record<string, string | number | null>>> = {
  monitor: {
    screen_size_inches: 32, resolution_width: 3840, resolution_height: 2160, refresh_rate_hz: 144,
    panel_type: 'IPS', response_time_ms: 1, hdr: null, brightness_nits: 400, adaptive_sync: null, aspect_ratio: '16:9',
  },
  keyboard: {
    switch_model: null, switch_type: 'Mechanical', size: '75%', layout: 'ANSI', hot_swappable: 1,
    polling_rate_hz: 1000, battery_capacity_mah: null,
  },
  mouse: {
    shape: 'Symmetrical', size: null, sensor: null, weight_g: 59, max_dpi: 32000, polling_rate_hz: 8000,
    buttons: 5, battery_life_hours: 80, length_mm: 120, width_mm: 60, height_mm: 40,
  },
  headphones: {
    headphone_type: 'Wireless', ear_cup_type: 'Over-ear', driver_size_mm: 40, weight_g: 250,
    battery_life_hours: 30, has_microphone: 1,
  },
  webcam: { resolution: '1080p', frame_rate_fps: 60 },
}

export function optionalProduct(category: PartCategory) {
  return {
    ...fixture.data[0], category, name: `Test ${category}`, manufacturer: null,
    upstream_key: `${category}/test`, specs: extendedSpecs[category] ?? {},
  }
}
