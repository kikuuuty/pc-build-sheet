import { z } from 'zod'

// Contract: pc-parts-catalog 04a9d37 (2026-09-19), src/worker.js,
// src/model.js, src/extended-models.js and docs/pagination.md.
// API category discovery is independent of the nine supported UI/spec variants.
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

export const catalogProductSchema = z.discriminatedUnion('category', [
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
