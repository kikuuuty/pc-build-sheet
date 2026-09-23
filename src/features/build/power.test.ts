import { describe, expect, it } from 'vitest'
import { partCategories } from '../../domain/categories'
import { powerItem, powerProduct } from '../../test/power-products'
import { getPowerSummary } from './power'

const cpu = (tdp_w: number | null, ppt_w: number | null = null) => powerItem(powerProduct('cpu', { tdp_w, ppt_w }))
const gpu = (tdp_w: number | null) => powerItem(powerProduct('gpu', { tdp_w }))

describe('power estimates', () => {
  it('keeps CPU + GPU consumption separate from the recommended PSU', () => {
    expect(getPowerSummary([cpu(170), gpu(360)])).toMatchObject({
      estimatedPowerW: 530, recommendedPsuW: 700, hasMissingPowerData: false,
      breakdown: { cpu: 170, gpu: 360, motherboard: 0, memory: 0, storage: 0, cpuCooler: 0, caseFans: 0, expansionCards: 0 },
    })
  })

  it('prefers PPT over TDP, including a smaller valid PPT', () => {
    expect(getPowerSummary([cpu(120, 170)]).breakdown.cpu).toBe(170)
    expect(getPowerSummary([cpu(170, 120)]).breakdown.cpu).toBe(120)
    expect(getPowerSummary([cpu(120)]).breakdown.cpu).toBe(120)
    expect(getPowerSummary([cpu(null, 170)]).breakdown.cpu).toBe(170)
  })

  it.each([null, undefined, NaN, Infinity, -Infinity, 0, -1, '170', true])('handles invalid power spec %s without name-based inference', (invalid) => {
    const processor = powerProduct('cpu', { tdp_w: 65 })
    Object.assign(processor.specs, { ppt_w: invalid })
    expect(getPowerSummary([powerItem(processor)]).breakdown.cpu).toBe(65)
    Object.assign(processor.specs, { tdp_w: invalid })
    const graphics = powerProduct('gpu')
    graphics.name = 'GeForce RTX 5090 600W'
    Object.assign(graphics.specs, { tdp_w: invalid })
    expect(getPowerSummary([powerItem(processor), powerItem(graphics)])).toMatchObject({
      estimatedPowerW: 0, recommendedPsuW: null, hasPowerParts: true, hasMissingPowerData: true,
      missingPowerItems: [{ itemId: 'cpu', category: 'cpu' }, { itemId: 'gpu', category: 'gpu' }],
    })
  })

  it('keeps known power and identifies the missing GPU row', () => {
    expect(getPowerSummary([cpu(170), gpu(null), powerItem(powerProduct('motherboard'))])).toMatchObject({
      estimatedPowerW: 220, recommendedPsuW: 450, hasMissingPowerData: true,
      missingPowerItems: [{ itemId: 'gpu', category: 'gpu', name: 'Power test gpu' }],
    })
    expect(getPowerSummary([cpu(null), gpu(360)])).toMatchObject({ estimatedPowerW: 360, recommendedPsuW: 450, hasMissingPowerData: true })
  })

  it.each([[1, 5], [2, 10], [4, 20], [null, 10]])('RAM kit %s uses %iW', (kit_quantity, expected) => {
    expect(getPowerSummary([powerItem(powerProduct('memory', { kit_quantity }))]).breakdown.memory).toBe(expected)
  })

  it.each([undefined, NaN, Infinity, 0, -2, 1.5, '4', true])('falls back for invalid quantities %s', (invalid) => {
    const memory = powerProduct('memory')
    const fan = powerProduct('case_fan')
    Object.assign(memory.specs, { kit_quantity: invalid })
    Object.assign(fan.specs, { quantity: invalid })
    expect(getPowerSummary([powerItem(memory), powerItem(fan)])).toMatchObject({
      estimatedPowerW: 13, breakdown: { memory: 10, caseFans: 3 }, hasMissingPowerData: false,
    })
  })

  it('counts multiple RAM kits once per row, not once per catalog ID', () => {
    const kit = powerProduct('memory', { kit_quantity: 2 })
    expect(getPowerSummary([powerItem(kit, 'kit-a'), powerItem(kit, 'kit-b')]).breakdown.memory).toBe(20)
  })

  it.each([
    ['SSD', 'M.2 PCIe 4.0 x4', 1, 8], ['SSD', 'PCIe 3.0 x4', null, 8],
    ['SSD', 'NVMe', null, 8], ['SSD', 'SATA 6.0 Gb/s', 0, 5], ['SSD', 'M.2 SATA', null, 5],
    [' ssd ', 'mSATA', null, 5], ['HDD', 'SATA 6.0 Gb/s', 0, 12], ['SSHD', 'SATA', null, 12],
    ['HDD', 'PCIe', 1, 12], [null, 'SATA', null, 8], ['SSD', 'M.2', null, 8], [null, null, null, 8],
  ] as const)('classifies storage %s / %s / %s as %iW', (storage_type, connection, nvme, expected) => {
    expect(getPowerSummary([powerItem(powerProduct('storage', { storage_type, interface: connection, nvme }))]).breakdown.storage).toBe(expected)
  })

  it('adds multiple NVMe drives independently of capacity', () => {
    const first = powerProduct('storage', { storage_type: 'SSD', nvme: 1, capacity_gb: 1000 })
    const second = powerProduct('storage', { storage_type: 'SSD', nvme: 1, capacity_gb: 4000 })
    expect(getPowerSummary([powerItem(first, 'disk-a'), powerItem(second, 'disk-b')]).breakdown.storage).toBe(16)
  })

  it.each([[0, 5], [1, 20], [null, 5], [-1, 5], [2, 5]])('cooler water_cooled=%s uses %iW including its fans', (water_cooled, expected) => {
    const result = getPowerSummary([powerItem(powerProduct('cpu_cooler', { water_cooled, fan_quantity: 3 }))])
    expect(result.breakdown.cpuCooler).toBe(expected)
    expect(result.breakdown.caseFans).toBe(0)
  })

  it('adds a three-fan kit and other case fan products without adding AIO fans again', () => {
    const fan = powerProduct('case_fan', { quantity: 3 })
    expect(getPowerSummary([powerItem(fan)]).breakdown.caseFans).toBe(9)
    expect(getPowerSummary([
      powerItem(fan, 'fan-a'), powerItem(fan, 'fan-b'), powerItem(powerProduct('case_fan'), 'fan-c'),
      powerItem(powerProduct('cpu_cooler', { water_cooled: 1, fan_quantity: 3 })),
    ])).toMatchObject({ estimatedPowerW: 41, breakdown: { cpuCooler: 20, caseFans: 21 } })
  })

  it.each([
    ['ATX', 50], ['Mini-ITX', 35], [' mini ITX ', 35], ['Mini‑ITX', 35], ['Ｍｉｎｉ－ＩＴＸ', 35],
    ['Micro ATX', 45], ['mATX', 45], ['micro-atx', 45], ['E-ATX', 60], ['EATX', 60], ['Extended ATX', 60],
    ['Thin Mini-ITX', 50], ['XL ATX', 50], ['SSI EEB', 50], ['toString', 50], [null, 50],
  ] as const)('motherboard %s uses %iW', (form_factor, expected) => {
    expect(getPowerSummary([powerItem(powerProduct('motherboard', { form_factor }))]).breakdown.motherboard).toBe(expected)
  })

  it('adds every expansion card and lighting row', () => {
    const items = (['network_card', 'sound_card', 'capture_card', 'lighting'] as const).flatMap((category) => {
      const product = powerProduct(category)
      return [powerItem(product, `${category}-a`), powerItem(product, `${category}-b`)]
    })
    expect(getPowerSummary(items).breakdown.expansionCards).toBe(80)
  })

  it('excludes all other registered categories and legacy custom rows', () => {
    const included = new Set(['cpu', 'gpu', 'motherboard', 'memory', 'storage', 'cpu_cooler', 'case_fan', 'network_card', 'sound_card', 'capture_card', 'lighting'])
    const items = partCategories.filter(({ id }) => !included.has(id)).map(({ id }) => powerItem(powerProduct(id)))
    expect(getPowerSummary([...items, { id: 'custom', kind: 'custom', name: 'GPU 600W', price: 1000 }])).toMatchObject({
      estimatedPowerW: 0, recommendedPsuW: null, hasPowerParts: false, hasMissingPowerData: false,
    })
  })

  it('handles an empty or incomplete build without an arbitrary PSU recommendation', () => {
    expect(getPowerSummary([])).toMatchObject({ estimatedPowerW: 0, recommendedPsuW: null, hasPowerParts: false, selectedPsus: [] })
    expect(getPowerSummary([powerItem(powerProduct('motherboard')), powerItem(powerProduct('memory'))])).toMatchObject({
      estimatedPowerW: 60, recommendedPsuW: null, hasPowerParts: true,
    })
  })

  it('returns the complete breakdown and does not mutate or double count a row', () => {
    const processor = cpu(120, 170)
    const items = [processor, gpu(360), powerItem(powerProduct('motherboard', { form_factor: 'ATX' })),
      powerItem(powerProduct('memory', { kit_quantity: 2 })),
      powerItem(powerProduct('storage', { nvme: 1 }), 'ssd-a'), powerItem(powerProduct('storage', { nvme: 1 }), 'ssd-b'),
      powerItem(powerProduct('cpu_cooler', { water_cooled: 1 })), powerItem(powerProduct('case_fan', { quantity: 4 })),
    ]
    const before = structuredClone(items)
    const result = getPowerSummary(Object.freeze(items))
    expect(result).toMatchObject({
      estimatedPowerW: 638, recommendedPsuW: 800,
      breakdown: { cpu: 170, gpu: 360, motherboard: 50, memory: 10, storage: 16, cpuCooler: 20, caseFans: 12, expansionCards: 0 },
    })
    expect(items).toEqual(before)
    expect(getPowerSummary([...items, processor])).toEqual(result)
  })
})

describe('PSU recommendations and comparisons', () => {
  it.each([
    [65, 450], [360, 450], [360.1, 500], [400, 500], [440, 550], [480, 600], [520, 650],
    [560, 700], [600, 750], [640, 800], [680, 850], [720, 900], [800, 1000], [800.1, 1200],
    [960, 1200], [1040, 1300], [1200, 1500], [1280, 1600], [1600, 2000], [1600.1, 2001], [2000, 2500],
  ])('consumption %sW recommends at least %iW without rounding consumption first', (consumption, recommendation) => {
    expect(getPowerSummary([cpu(consumption)])).toMatchObject({ estimatedPowerW: consumption, recommendedPsuW: recommendation })
  })

  it.each([[750, true], [800, false], [850, false], [null, null], [0, null], [-1, null]] as const)('compares a selected %sW PSU with 800W', (wattage, below) => {
    expect(getPowerSummary([cpu(280), gpu(360), powerItem(powerProduct('psu', { wattage }))]).selectedPsus[0])
      .toMatchObject({ wattage: wattage !== null && wattage > 0 ? wattage : null, isBelowRecommendation: below })
  })

  it.each([undefined, NaN, Infinity, '850'])('leaves invalid PSU capacity %s unknown', (invalid) => {
    const psu = powerProduct('psu')
    Object.assign(psu.specs, { wattage: invalid })
    expect(getPowerSummary([cpu(100), powerItem(psu)]).selectedPsus[0]).toMatchObject({ wattage: null, isBelowRecommendation: null })
  })

  it('does not pool legacy PSU capacities or compare without a recommendation', () => {
    const psus = [powerItem(powerProduct('psu', { wattage: 450 }), 'psu-a'), powerItem(powerProduct('psu', { wattage: 500 }), 'psu-b')]
    expect(getPowerSummary([cpu(280), gpu(360), ...psus]).selectedPsus.map((psu) => psu.isBelowRecommendation)).toEqual([true, true])
    expect(getPowerSummary(psus).selectedPsus.map((psu) => psu.isBelowRecommendation)).toEqual([null, null])
  })
})
