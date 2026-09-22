import { describe, expect, it } from 'vitest'
import { cpuFacets, cpuFilters, monitorFilters, selection, staticFacets, storageFilters } from '../../test/filter-fixtures'
import { getUiFilters, NVME_SSD } from './filter-config'
import { mergeDynamicFacetOptions } from './dynamic-facets'
import { compileConditions, emptyDraft, resolutionPreset, selectValues, setResolutionPreset } from './filter-state'

describe('display-only dynamic facet merge', () => {
  const definitions = getUiFilters('cpu', cpuFilters)
  it.each(['Intel', 'AMD'])('uses backend %s options including self-excluded sockets', (manufacturer) => {
    const conditions = { filters: { manufacturer: [manufacturer], socket: [manufacturer === 'Intel' ? 'LGA1700' : 'AM5'] } }
    const response = cpuFacets(conditions)
    const display = mergeDynamicFacetOptions(definitions, response, conditions.filters)
    for (const id of ['family', 'socket']) {
      const field = display.find((d) => d.id === id)!
      expect(field.control === 'multi_select' && field.options.map((o) => o.value)).toEqual(response.facets[id].options.map((o) => o.value))
    }
    expect(display.find((d) => d.id === 'socket')).toMatchObject({ options: expect.any(Array) })
    expect(response.facets.socket.options).toHaveLength(2)
    expect(display.find((d) => d.id === 'tdp_w')).toBe(definitions.find((d) => d.id === 'tdp_w'))
  })
  it('retains conflicting selections and canonical requests, hides unselected incompatible values, permits removal', () => {
    const draft = selectValues(selectValues(emptyDraft, 'socket', ['AM5']), 'manufacturer', ['Intel'])
    const before = structuredClone(draft)
    const canonical = compileConditions('cpu', definitions, draft)
    const display = mergeDynamicFacetOptions(definitions, cpuFacets(canonical.conditions), draft.selections)
    expect(display.find((d) => d.id === 'socket')).toMatchObject({ unavailableValues: ['AM5'], options: [
      { value: 'AM5' }, { value: 'LGA1700', count: 1 }, { value: 'LGA1851', count: 1 },
    ] })
    expect(draft).toEqual(before)
    expect(compileConditions('cpu', definitions, draft)).toEqual({ conditions: { filters: { socket: ['AM5'], manufacturer: ['Intel'] } }, errors: {} })
    expect(selectValues(draft, 'socket', []).selections).toEqual({ manufacturer: ['Intel'] })
  })
  it('falls back to static definitions and preserves empty dynamic options', () => {
    expect(mergeDynamicFacetOptions(definitions, undefined, {})).toBe(definitions)
    expect(mergeDynamicFacetOptions(definitions, { category: 'cpu', facets: { socket: { options: [] } } }, {}).find((d) => d.id === 'socket')).toMatchObject({ options: [] })
  })
  it.each(['motherboard', 'gpu'] as const)('merges %s without any compatibility table', (category) => {
    const field = category === 'gpu' ? 'chip_series' : 'chipset'
    const metadata = { category, filters: [selection(field, field, ['A', 'B'])] }
    const display = mergeDynamicFacetOptions(getUiFilters(category, metadata), { category, facets: { [field]: { options: [{ value: 'B', label: 'B', count: 42 }] } } }, {})
    expect(display[0]).toMatchObject({ options: [{ value: 'B', count: 42 }] })
  })
  it('preserves SSD/NVMe/HDD/SSHD single-select translations, including the synthetic option with no raw options', () => {
    const definitions = getUiFilters('storage', storageFilters)
    const response = staticFacets(storageFilters)
    for (const value of ['SSD', NVME_SSD, 'HDD', 'SSHD']) {
      const draft = selectValues(emptyDraft, 'storage_type', [value])
      const display = mergeDynamicFacetOptions(definitions, response, draft.selections)
      expect(display.find((d) => d.id === 'storage_type')).toMatchObject({ single: true, options: [{ value: 'SSD' }, { value: NVME_SSD }, { value: 'HDD' }, { value: 'SSHD' }] })
      expect(compileConditions('storage', definitions, draft).conditions.filters).toEqual(value === NVME_SSD ? { storage_type: ['SSD'], nvme: [1] } : { storage_type: [value] })
    }
    response.facets.storage_type.options = []
    expect(mergeDynamicFacetOptions(definitions, response, {}).find((d) => d.id === 'storage_type')).toMatchObject({ options: [{ value: NVME_SSD }] })
  })
  it('preserves monitor presets/custom bounds and boolean 0/1 types', () => {
    const monitor = getUiFilters('monitor', monitorFilters)
    const draft = setResolutionPreset(emptyDraft, 'wuxga')
    const display = mergeDynamicFacetOptions(monitor, staticFacets(monitorFilters), {})
    expect(display.filter((d) => d.control === 'range')).toEqual(monitor.filter((d) => d.control === 'range'))
    expect(resolutionPreset(draft)).toBe('wuxga')
    expect(compileConditions('monitor', monitor, draft).conditions.ranges).toEqual({ resolution_width: { min: 1920, max: 1920 }, resolution_height: { min: 1200, max: 1200 } })
    expect(mergeDynamicFacetOptions(definitions, cpuFacets(), {}).find((d) => d.id === 'includes_cooler')).toMatchObject({ single: true, options: [{ value: 0 }, { value: 1 }] })
  })
})
