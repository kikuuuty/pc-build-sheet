import { z } from 'zod'
import { partCategories, type PartCategory } from '../../domain/categories'

// Contract: pc-parts-catalog 04a9d37 (2026-09-19), src/worker.js,
// src/model.js, src/extended-models.js and docs/pagination.md.
// Discovery also accepts future API categories; selectable IDs come from the UI registry.
export const catalogCategorySchema = z.string().min(1)
const text = z.string().nullable()
const real = z.number().nullable()
const integer = z.number().int().nullable()
const commonProductFields = {
  id: z.number().int().positive(),
  // Older saved products lack source. The HTTP boundary below requires it.
  source: z.string().min(1).optional(),
  upstream_id: z.string().min(1),
  upstream_key: z.string().min(1),
  manufacturer: text,
  name: z.string().min(1),
  series: text,
  variant: text,
  release_year: integer,
  manufacturer_url: text,
}

const typedProductSchema = z.discriminatedUnion('category', [
  z.object({ ...commonProductFields, category: z.literal('cpu'), specs: z.object({
    manufacturer: text, family: text, generation: text, socket: text,
    microarchitecture: text, core_family: text, base_clock_ghz: real,
    boost_clock_ghz: real, tdp_w: real, ppt_w: real, max_memory_gb: real,
    core_count: integer, thread_count: integer, performance_cores: integer,
    efficiency_cores: integer, includes_cooler: integer,
  }) }),
  z.object({ ...commonProductFields, category: z.literal('cpu_cooler'), specs: z.object({
    height_mm: real, radiator_size_mm: real, noise_min_db: real, noise_max_db: real,
    fan_size_mm: real, rpm_min: real, rpm_max: real, water_cooled: integer, fan_quantity: integer,
  }) }),
  z.object({ ...commonProductFields, category: z.literal('motherboard'), specs: z.object({
    socket: text, chipset: text, form_factor: text, ram_type: text, max_memory_gb: real,
    memory_slots: integer, m2_slots: integer, sata_ports: integer, back_connect: integer,
  }) }),
  z.object({ ...commonProductFields, category: z.literal('memory'), specs: z.object({
    ram_type: text, form_factor: text, ecc: text, registered: text, capacity_gb: real,
    module_capacity_gb: real, speed: real, cas_latency: real, height_mm: real,
    voltage: real, kit_quantity: integer, xmp: integer, expo: integer,
  }) }),
  z.object({ ...commonProductFields, category: z.literal('gpu'), specs: z.object({
    chip_vendor: text, chipset: text, chip_series: text, memory_type: text, interface: text,
    vram_gb: real, length_mm: real, tdp_w: real, boost_clock_mhz: real,
    slot_width: real, pcie_generation: real, pcie_lanes: integer,
    pcie_6_pin: integer, pcie_8_pin: integer, pcie_12vhpwr: integer, pcie_12v_2x6: integer,
  }) }),
  z.object({ ...commonProductFields, category: z.literal('storage'), specs: z.object({
    storage_type: text, form_factor: text, interface: text, capacity_gb: real,
    pcie_generation: real, cache_mb: real, pcie_lanes: integer, nvme: integer,
  }) }),
  z.object({ ...commonProductFields, category: z.literal('psu'), specs: z.object({
    form_factor: text, efficiency_rating: text, modular: text, wattage: real,
    length_mm: real, atx_24_pin: integer, eps_8_pin: integer,
    pcie_12vhpwr: integer, pcie_6_plus_2_pin: integer,
  }) }),
  z.object({ ...commonProductFields, category: z.literal('case'), specs: z.object({
    form_factor: text, max_gpu_length_mm: real, max_cpu_cooler_height_mm: real,
    max_psu_length_mm: real, depth_mm: real, width_mm: real, height_mm: real,
    volume_l: real, expansion_slots: integer, supports_back_connect: integer,
  }) }),
  z.object({ ...commonProductFields, category: z.literal('case_fan'), specs: z.object({
    connector: text, flow_direction: text, size_mm: real, airflow_min_cfm: real,
    airflow_max_cfm: real, noise_min_db: real, noise_max_db: real,
    static_pressure_mmh2o: real, quantity: integer, pwm: integer,
  }) }),
  z.object({ ...commonProductFields, category: z.literal('monitor'), specs: z.object({
    screen_size_inches: real, resolution_width: integer, resolution_height: integer,
    refresh_rate_hz: real, panel_type: text, response_time_ms: real, hdr: text,
    brightness_nits: real, adaptive_sync: text, aspect_ratio: text,
  }) }),
  z.object({ ...commonProductFields, category: z.literal('keyboard'), specs: z.object({
    switch_model: text, switch_type: text, size: text, layout: text,
    hot_swappable: integer, polling_rate_hz: real, battery_capacity_mah: real,
  }) }),
  z.object({ ...commonProductFields, category: z.literal('mouse'), specs: z.object({
    shape: text, size: text, sensor: text, weight_g: real, max_dpi: real,
    polling_rate_hz: real, buttons: integer, battery_life_hours: real,
    length_mm: real, width_mm: real, height_mm: real,
  }) }),
  z.object({ ...commonProductFields, category: z.literal('headphones'), specs: z.object({
    headphone_type: text, ear_cup_type: text, driver_size_mm: real, weight_g: real,
    battery_life_hours: real, has_microphone: integer,
  }) }),
  z.object({ ...commonProductFields, category: z.literal('webcam'), specs: z.object({
    resolution: text, frame_rate_fps: integer,
  }) }),
])

// extended-models.js intentionally has no scalar specs for the remaining categories.
// GET search does not include facets (e.g. connectivity), so do not invent those fields.
type UntypedCategory = Exclude<PartCategory, z.infer<typeof typedProductSchema>['category']>
const typedCategories = new Set<string>(typedProductSchema.options.map((option) => option.shape.category.value))
const untypedCategories = partCategories.map(({ id }) => id).filter((id): id is UntypedCategory => !typedCategories.has(id))
export const catalogProductSchema = z.discriminatedUnion('category', [
  ...typedProductSchema.options,
  ...untypedCategories.map((category) => z.object({
    ...commonProductFields, category: z.literal(category), specs: z.object({}),
  })),
])

export const catalogSourceSchema = z.object({
  name: z.string(), url: z.httpUrl(), license: z.string(), license_url: z.httpUrl(), attribution: z.string(),
})

export const catalogProductResponseSchema = z.intersection(
  catalogProductSchema,
  z.object({ source: z.string().min(1) }),
)

export const searchResponseSchema = z.object({
  data: z.array(catalogProductResponseSchema),
  meta: z.object({
    limit: z.number().int().min(1).max(50),
    offset: z.number().int().nonnegative(),
    returned: z.number().int().nonnegative(),
    has_more: z.boolean(),
    next_offset: z.number().int().nonnegative().nullable(),
    next_cursor: z.string().min(1).nullable(),
    window_limit: z.number().int().positive().nullable(),
    window_exhausted: z.boolean(),
    source: catalogSourceSchema,
  }),
}).refine(({ data, meta }) => data.length === meta.returned && data.length <= meta.limit, {
  message: 'Returned count must match the page',
})

export const categoriesResponseSchema = z.object({ categories: z.array(catalogCategorySchema).min(1) })
