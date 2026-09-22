import { beforeEach, describe, expect, it } from 'vitest'
import { getFilterLayout, getUiFilters, NVME_SSD } from './filter-config'
import { compileConditions, emptyDraft, resolutionPreset, selectValues, setRange, setResolutionPreset, useSearchSession } from './filter-state'
import { cpuFilters, monitorFilters, range, selection, storageFilters } from '../../test/filter-fixtures'
import { partCategories } from '../../domain/categories'

beforeEach(() => useSearchSession.setState({ drafts: {} }))
describe('search condition translation', () => {
  it('preserves numeric zero and one-sided bounds; omits blank groups', () => {
    const definitions = getUiFilters('cpu', cpuFilters)
    const draft = setRange(selectValues(emptyDraft, 'includes_cooler', [0]), 'core_count', { min: '8', max: '' })
    expect(compileConditions('cpu', definitions, draft)).toEqual({ conditions: { filters: { includes_cooler: [0] }, ranges: { core_count: { min: 8 } } }, errors: {} })
    expect(compileConditions('cpu', definitions, emptyDraft).conditions).toEqual({})
  })
  it('maps NVMe SSD atomically and removes nvme when changing storage type', () => {
    const definitions = getUiFilters('storage', storageFilters)
    const nvme = selectValues(emptyDraft, 'storage_type', [NVME_SSD])
    expect(compileConditions('storage', definitions, nvme).conditions).toEqual({ filters: { storage_type: ['SSD'], nvme: [1] } })
    expect(compileConditions('storage', definitions, selectValues(nvme, 'storage_type', ['HDD'])).conditions).toEqual({ filters: { storage_type: ['HDD'] } })
    expect(compileConditions('storage', definitions, selectValues(nvme, 'storage_type', [])).conditions).toEqual({})
    const noNvme = { ...storageFilters, filters: storageFilters.filters.filter(({ id }) => id !== 'nvme') }
    expect(compileConditions('storage', getUiFilters('storage', noNvme), nvme).errors.storage_type).toBeTruthy()
  })
  it('links preset and custom resolution without leftover equality filters', () => {
    const definitions = getUiFilters('monitor', monitorFilters)
    const preset = setResolutionPreset(emptyDraft, 'wuxga')
    expect(resolutionPreset(preset)).toBe('wuxga')
    const custom = setRange(setRange(preset, 'resolution_width', { min: '', max: '' }), 'resolution_height', { min: '1080', max: '1200' })
    expect(resolutionPreset(custom)).toBe('custom')
    expect(compileConditions('monitor', definitions, custom).conditions).toEqual({ ranges: { resolution_height: { min: 1080, max: 1200 } } })
    expect(setResolutionPreset(custom, '').ranges).toEqual({})
  })
  it('does not round REAL ranges to step or clamp to observed catalog bounds', () => {
    const definitions = getUiFilters('cpu', cpuFilters)
    const draft = setRange(emptyDraft, 'tdp_w', { min: '1.25', max: '1200.1' })
    expect(compileConditions('cpu', definitions, draft)).toEqual({ conditions: { ranges: { tdp_w: { min: 1.25, max: 1200.1 } } }, errors: {} })
  })
  it.each([
    ['9', '8'], ['1.5', ''], ['1e3', ''], ['-', ''], ['Infinity', ''], ['0x10', ''],
  ])('blocks invalid integer ranges %s/%s', (min, max) => {
    expect(compileConditions('cpu', getUiFilters('cpu', cpuFilters), setRange(emptyDraft, 'core_count', { min, max })).errors.core_count).toBeTruthy()
  })
  it('rejects removed options, empty catalog ranges and unknown fields rather than broadening a saved search', () => {
    const definitions = getUiFilters('cpu', cpuFilters)
    expect(compileConditions('cpu', definitions, selectValues(emptyDraft, 'socket', ['LGA 1851'])).errors.socket).toBeTruthy()
    expect(compileConditions('cpu', definitions, selectValues(emptyDraft, 'generation', ['9000'])).errors.generation).toBeTruthy()
    const unavailable = { ...range('core_count', 'コア数', true), range: null }
    expect(compileConditions('cpu', [unavailable], setRange(emptyDraft, 'core_count', { min: '8', max: '' })).errors.core_count).toBeTruthy()
  })
  it('keeps multi-values in their correct target and validates HTTP complexity limits', () => {
    const definitions = [selection('manufacturer', 'メーカー', Array.from({ length: 11 }, (_, i) => `Brand${i}`)), selection('connectivity', '接続方式', ['Bluetooth', 'Wired'], 'facets')]
    const draft = selectValues(selectValues(emptyDraft, 'manufacturer', ['Brand0', 'Brand1']), 'connectivity', ['Bluetooth', 'Wired'])
    expect(compileConditions('keyboard', definitions, draft)).toEqual({ conditions: { filters: { manufacturer: ['Brand0', 'Brand1'] }, facets: { connectivity: ['Bluetooth', 'Wired'] } }, errors: {} })
    expect(compileConditions('keyboard', definitions, selectValues(draft, 'manufacturer', Array.from({ length: 11 }, (_, i) => `Brand${i}`))).errors._limits).toBeTruthy()
  })
})

it('keeps category drafts independent and out of build persistence', () => {
  useSearchSession.getState().update('cpu', { ...emptyDraft, keyword: 'ryzen' })
  useSearchSession.getState().update('storage', selectValues(emptyDraft, 'storage_type', [NVME_SSD]))
  expect(useSearchSession.getState().drafts.cpu?.keyword).toBe('ryzen')
  expect(useSearchSession.getState().drafts.memory).toBeUndefined()
  expect(useSearchSession.getState().drafts.storage?.selections.storage_type).toEqual([NVME_SSD])
})

it('covers every UI category, keeps agreed ordering, and does not expose unwanted API fields', () => {
  for (const { id } of partCategories) {
    const { basic, detail } = getFilterLayout(id)
    expect(new Set([...basic, ...detail]).size).toBe(basic.length + detail.length)
    if (id !== 'os') expect(basic[0]).toBe('manufacturer')
  }
  expect(getFilterLayout('memory').basic).toEqual(['manufacturer', 'ram_type', 'speed', 'capacity_gb', 'kit_quantity'])
  expect(getUiFilters('cpu', cpuFilters).map(({ id }) => id)).not.toContain('generation')
  expect(getUiFilters('storage', storageFilters).map(({ id }) => id)).not.toContain('pcie_generation')
  expect(getUiFilters('os', { category: 'os', filters: [selection('manufacturer', 'メーカー', ['Microsoft'])] })).toEqual([])
  expect(getFilterLayout('accessory')).toEqual({ basic: ['manufacturer'], detail: [] })
})
