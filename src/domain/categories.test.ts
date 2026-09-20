import { expect, it } from 'vitest'
import categories from '../test/fixtures/categories.json'
import { additionGroups, addableOptionalCategories, mainCategories, optionalCategories, partCategories, partCategorySchema } from './categories'

it('recognizes exactly the 30 Production categories with unique IDs', () => {
  expect(partCategories).toHaveLength(30)
  expect(new Set(partCategories.map(({ id }) => id)).size).toBe(30)
  expect(partCategories.map(({ id }) => id).sort()).toEqual([...categories.categories].sort())
  for (const id of categories.categories) expect(partCategorySchema.parse(id)).toBe(id)
  expect(partCategorySchema.safeParse('custom').success).toBe(false)
  expect(partCategorySchema.safeParse('unknown').success).toBe(false)
})

it('groups the 13 addable categories in the requested order and excludes seven suggestions', () => {
  expect(addableOptionalCategories).toHaveLength(13)
  expect(additionGroups.map((group) => ({ label: group.label,
    categories: addableOptionalCategories.filter((category) => category.additionGroup === group.id).map(({ id }) => id),
  }))).toEqual([
    { label: '拡張カード', categories: ['capture_card', 'network_card', 'sound_card'] },
    { label: '周辺機器', categories: ['monitor', 'keyboard', 'mouse', 'mousepad'] },
    { label: '音声・映像機器', categories: ['headphones', 'speaker', 'microphone', 'webcam'] },
    { label: 'その他', categories: ['thermal_compound', 'accessory'] },
  ])
  expect(optionalCategories.filter((category) => category.additionGroup === null).map(({ id }) => id).sort())
    .toEqual(['chair', 'desk', 'laptop', 'lighting', 'prebuilt_desktop', 'stand', 'vr_headset'])
})

it('keeps ten main categories with OS last and 20 optional categories', () => {
  expect(mainCategories.map(({ id }) => id)).toEqual(['cpu', 'cpu_cooler', 'memory', 'motherboard', 'gpu', 'storage', 'psu', 'case', 'case_fan', 'os'])
  expect(mainCategories.at(-1)).toMatchObject({ id: 'os', cardinality: 'single' })
  expect(optionalCategories).toHaveLength(20)
  expect(optionalCategories.filter(({ cardinality }) => cardinality === 'single').map(({ id }) => id).sort())
    .toEqual(['chair', 'desk', 'laptop', 'prebuilt_desktop', 'vr_headset'])
})
