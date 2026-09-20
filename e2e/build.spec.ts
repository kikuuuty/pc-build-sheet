import { expect, test, type Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import fixture from '../src/test/fixtures/cpu-search.json' with { type: 'json' }
import categoriesFixture from '../src/test/fixtures/categories.json' with { type: 'json' }
import { additionGroups, addableOptionalCategories, mainCategories, partCategories, optionalCategories, type PartCategory } from '../src/domain/categories'
import { catalogProductSchema } from '../src/api/catalog/schemas'

const api = 'https://pc-parts-catalog.kikuuuty.workers.dev'
const productName = fixture.data[0].name

// Synthetic pages use production metadata for the requested pagination mode.
function searchResponse(url: string, data = [makeProduct('cpu', productName)]) {
  const params = new URL(url).searchParams
  return { data, meta: { ...fixture.meta, returned: data.length,
    offset: Number(params.get('offset') ?? 0), window_limit: params.has('q') ? 1000 : null } }
}

function makeProduct(category: PartCategory, name: string, index = 0) {
  const variant = catalogProductSchema.options.find((option) => option.shape.category.value === category)!
  const specs = category === 'cpu' ? fixture.data[0].specs : Object.fromEntries(Object.keys(variant.shape.specs.shape).map((key) => [key, null]))
  return catalogProductSchema.parse({ ...fixture.data[0], category, name, upstream_key: `${category}/test-${index}`, specs })
}

async function mockCatalog(page: Page) {
  await page.route(`${api}/v1/categories`, (route) => route.fulfill({ json: categoriesFixture }))
  await page.route(`${api}/v1/search?**`, (route) => {
    const params = new URL(route.request().url()).searchParams
    const category = params.get('category') as PartCategory
    return route.fulfill({ json: searchResponse(route.request().url(), params.get('q') === 'missing' ? [] : [makeProduct(category, productName)]) })
  })
}

test.beforeEach(async ({ page }) => { await mockCatalog(page) })

async function expectCenteredSearchDialog(page: Page) {
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  const box = (await dialog.boundingBox())!
  const viewport = page.viewportSize()!
  expect(Math.abs(box.x + box.width / 2 - viewport.width / 2)).toBeLessThan(1)
  expect(Math.abs(box.y + box.height / 2 - viewport.height / 2)).toBeLessThan(1)
  expect(box.x).toBeGreaterThanOrEqual(12)
  expect(box.y).toBeGreaterThanOrEqual(12)
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width - 12)
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height - 12)
  if (viewport.width > 700) {
    expect(box.width).toBe(Math.min(900, viewport.width - 32))
    expect(box.height).toBeLessThanOrEqual(viewport.height * .85 + 1)
  } else {
    expect(box.width).toBe(viewport.width - 24)
    expect(box.height).toBe(viewport.height - 24)
  }
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  expect(await dialog.locator('.search-body').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
}

test('10 main categories, real build actions, persistence, reset and responsive layout', async ({ page }, testInfo) => {
  const issues: string[] = []
  page.on('pageerror', (error) => issues.push(error.message))
  page.on('console', (message) => { if (['warning', 'error'].includes(message.type())) issues.push(message.text()) })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '自作PC構成シート', exact: true })).toBeVisible()
  const sheet = page.getByRole('region', { name: '構成パーツ' })
  for (const category of mainCategories) await expect(sheet.getByRole('heading', { name: category.label, exact: true })).toBeVisible()
  for (const section of await sheet.locator('.category-row').all()) {
    const height = (await section.boundingBox())!.height
    expect(height).toBeGreaterThanOrEqual(68)
    expect(height).toBeLessThanOrEqual(72)
  }
  await expect(page.locator('.search-result')).toHaveCount(0)
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', await page.evaluate(() => window.innerWidth))
  await page.screenshot({ path: testInfo.outputPath('sheet-empty.png'), fullPage: true })

  await page.getByRole('button', { name: 'CPUを選択', exact: true }).click()
  const input = page.getByRole('textbox', { name: '製品名・型番で検索' })
  await expect(input).toBeFocused()
  await input.fill('9800x3d')
  await expect(page.getByRole('dialog').getByText(productName, { exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('search.png') })
  await page.getByRole('button', { name: `${productName}を構成に追加`, exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(sheet.getByText(productName, { exact: true })).toBeVisible()
  await expect(page.locator('.summary-count strong')).toHaveText('1')
  await page.reload()
  await expect(sheet.getByText(productName, { exact: true })).toBeVisible()

  await expect(page.getByRole('button', { name: 'CPUを追加', exact: true })).toHaveCount(0)
  await sheet.getByRole('button', { name: `${productName}を構成から削除` }).click()
  await expect(page.getByRole('button', { name: 'CPUを選択', exact: true })).toBeFocused()
  await page.getByRole('button', { name: 'CPUを選択', exact: true }).click()
  await page.getByRole('button', { name: `${productName}を構成に追加`, exact: true }).click()
  await page.reload()
  await expect(page.locator('.summary-count strong')).toHaveText('1')
  await page.screenshot({ path: testInfo.outputPath('sheet-selected.png'), fullPage: true })

  await page.getByRole('button', { name: '構成をリセット' }).click()
  await page.getByRole('button', { name: 'キャンセル' }).click()
  await expect(sheet.getByText(productName, { exact: true })).toHaveCount(1)
  await page.getByRole('button', { name: '構成をリセット' }).click()
  await page.getByRole('button', { name: 'リセットする', exact: true }).click()
  await page.reload()
  await expect(page.locator('.summary-count strong')).toHaveText('0')
  expect(issues).toEqual([])
})

test('all selectable category dialogs use the same search interaction and Escape restores focus', async ({ page }) => {
  test.setTimeout(60_000)
  await page.goto('/')
  for (const category of [...mainCategories, ...addableOptionalCategories]) {
    const opener = page.getByRole('button', { name: `${category.label}を${category.placement === 'main' ? '選択' : '追加'}`, exact: true })
    await opener.click()
    await expect(page.getByRole('dialog', { name: `${category.label}を選択`, exact: true })).toBeVisible()
    await expect(page.getByRole('textbox', { name: '製品名・型番で検索' })).toBeFocused()
    await expect(page.getByRole('dialog').getByText(productName, { exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(opener).toBeFocused()
  }
})

test('main rows are permanent, custom entry is removed and additions sit below the summary', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.category-row h3')).toHaveText([
    '01CPU', '02CPUクーラー', '03メモリ', '04マザーボード', '05GPU', '06ストレージ', '07電源', '08ケース', '09ケースファン', '10OS',
  ])
  const additions = page.getByRole('region', { name: '製品を追加', exact: true })
  await expect(additions.getByRole('button')).toHaveCount(13)
  for (const category of optionalCategories) {
    await expect(page.getByRole('region', { name: category.label, exact: true })).toHaveCount(0)
    const button = additions.getByRole('button', { name: `${category.label}を追加`, exact: true })
    if (category.additionGroup === null) await expect(button).toHaveCount(0)
    else await expect(button).toBeVisible()
  }
  await expect(additions.getByRole('heading', { level: 3 })).toHaveText(additionGroups.map(({ label }) => label))
  for (const group of additionGroups) {
    await expect(additions.getByRole('group', { name: group.label, exact: true }).getByRole('button'))
      .toHaveText(addableOptionalCategories.filter((category) => category.additionGroup === group.id).map(({ label }) => label))
  }
  await expect(page.getByRole('region', { name: 'その他', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '任意項目を追加', exact: true })).toHaveCount(0)
  await expect(page.getByText('任意項目を入力', { exact: true })).toHaveCount(0)
  await expect(page.locator('.sheet .optional-products')).toHaveCount(0)
  for (const width of [1280, 740, 320]) {
    await page.setViewportSize({ width, height: 960 })
    const summary = (await page.getByRole('complementary', { name: '構成サマリー', exact: true }).boundingBox())!
    const panel = (await additions.boundingBox())!
    const sheet = (await page.locator('.sheet').boundingBox())!
    expect(panel.y).toBeGreaterThanOrEqual(summary.y + summary.height)
    expect(Math.abs(panel.x - summary.x)).toBeLessThan(1)
    expect(Math.abs(panel.width - summary.width)).toBeLessThan(1)
    if (width > 1100) expect(summary.x).toBeGreaterThan(sheet.x + sheet.width)
    else expect(summary.y).toBeGreaterThanOrEqual(sheet.y + sheet.height)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    const buttonSizes = await additions.getByRole('button').evaluateAll((buttons) => buttons.map((button) => {
      const { width, height } = button.getBoundingClientRect()
      return { width, height, fits: button.scrollWidth <= button.clientWidth && button.scrollHeight <= button.clientHeight }
    }))
    expect(Math.max(...buttonSizes.map(({ width }) => width)) - Math.min(...buttonSizes.map(({ width }) => width))).toBeLessThan(1)
    for (const button of buttonSizes) {
      expect(button.height).toBe(34)
      expect(button.fits).toBe(true)
    }
    for (const group of await additions.getByRole('group').all()) {
      const boxes = await group.getByRole('button').evaluateAll((buttons) => buttons.map((button) => {
        const { x, y, width } = button.getBoundingClientRect()
        return { x, y, width }
      }))
      expect(boxes[0].y).toBe(boxes[1].y)
      expect(boxes[1].x).toBeGreaterThan(boxes[0].x + boxes[0].width)
      if (boxes.length > 2) {
        expect(boxes[2].x).toBe(boxes[0].x)
        expect(boxes[2].y).toBeGreaterThan(boxes[0].y)
      }
    }
  }
})

for (const category of addableOptionalCategories) {
test(`optional ${category.id}: search, cardinality, replace, restore, remove and focus`, async ({ page }) => {
  const requests: { category: string | null; query: string | null; method: string }[] = []
  const products = [makeProduct(category.id, `${category.label} test`, 1), makeProduct(category.id, `${category.label} replacement`, 2)]
  await page.route(`${api}/v1/search?**`, (route) => {
    const params = new URL(route.request().url()).searchParams
    requests.push({ category: params.get('category'), query: params.get('q'), method: route.request().method() })
    return route.fulfill({ json: searchResponse(route.request().url(), products) })
  })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/')
  const additions = page.getByRole('region', { name: '製品を追加', exact: true })
  const opener = additions.getByRole('button', { name: `${category.label}を追加`, exact: true })
  const section = page.getByRole('region', { name: category.label, exact: true })
  await opener.click()
  await expect(page.getByRole('dialog').getByText(products[0].name, { exact: true })).toBeVisible()
  await page.getByRole('dialog').getByRole('textbox').fill('test')
  await expect(page.getByRole('dialog').getByRole('status')).toContainText('「test」の検索結果')
  await page.getByRole('button', { name: `${products[0].name}を構成に追加`, exact: true }).click()
  await expect(section).toHaveCount(1)
  await expect(section.locator('.build-item')).toHaveCount(1)
  const productButton = section.getByRole('button', { name: `${products[0].name}を変更`, exact: true })
  await expect(opener).toHaveCount(0)
  await expect(productButton).toBeFocused()
  await section.getByRole('button', { name: `${category.label}を追加`, exact: true }).click()
  await page.getByRole('button', { name: `${products[0].name}を構成に追加`, exact: true }).click()
  await expect(section).toHaveCount(1)
  await expect(section.locator('.build-item')).toHaveCount(2)
  await expect(section.getByRole('button', { name: `${category.label}を追加`, exact: true })).toBeVisible()
  const rows = section.locator('.build-item')
  await rows.first().getByRole('textbox').fill('10000')
  await rows.first().getByRole('textbox').press('Enter')
  await productButton.first().click()
  await page.getByRole('button', { name: `${products[1].name}に置き換える`, exact: true }).click()
  await expect(rows.first().getByRole('button', { name: `${products[1].name}を変更`, exact: true })).toBeFocused()
  await expect(rows.first().getByRole('textbox')).toHaveValue('')
  await rows.first().getByRole('textbox').fill('22000')
  await rows.first().getByRole('textbox').press('Enter')
  await page.reload()
  await expect(rows).toHaveCount(2)
  await expect(rows.first().getByText(products[1].name, { exact: true })).toBeVisible()
  await expect(rows.first().getByRole('textbox')).toHaveValue('22000')
  await expect(opener).toHaveCount(0)
  await expect(page.locator('.category-row h3').nth(mainCategories.length)).toHaveText(`＋${category.label}`)
  await expect(page.locator('.workspace-sidebar > :last-child')).toHaveAttribute('aria-labelledby', 'optional-products-title')
  await rows.last().getByRole('button', { name: `${products[0].name}を構成から削除`, exact: true }).click()
  await expect(rows).toHaveCount(1)
  await expect(opener).toHaveCount(0)
  await rows.first().getByRole('button', { name: `${products[1].name}を構成から削除`, exact: true }).click()
  await expect(section).toHaveCount(0)
  await expect(opener).toBeFocused()
  await expect(additions.getByRole('button')).toHaveCount(13)
  await page.reload()
  await expect(section).toHaveCount(0)
  await expect(page.locator('.category-row')).toHaveCount(10)
  expect(requests).toContainEqual({ category: category.id, query: null, method: 'GET' })
  expect(requests).toContainEqual({ category: category.id, query: 'test', method: 'GET' })
  expect(errors).toEqual([])
})
}

for (const initial of ['empty', 'saved-v5'] as const) {
test(`OS is a permanent single category: ${initial}, replace, reload and remove`, async ({ page }) => {
  const products = [makeProduct('os', 'Windows 11 Home', 1), makeProduct('os', 'Windows 11 Pro', 2)]
  const requests: string[] = []
  await page.route(`${api}/v1/search?**`, (route) => {
    requests.push(new URL(route.request().url()).searchParams.get('category')!)
    return route.fulfill({ json: searchResponse(route.request().url(), products) })
  })
  if (initial === 'saved-v5') await page.addInitScript((product) => {
    if (!localStorage.getItem('pc-build-sheet:build')) localStorage.setItem('pc-build-sheet:build', JSON.stringify({ version: 5, state: { items: [
      { id: 'previously-optional-os', kind: 'catalog', category: 'os', product, price: 22000 },
    ] } }))
  }, products[0])
  await page.goto('/')
  const section = page.getByRole('region', { name: 'OS', exact: true })
  const additions = page.getByRole('region', { name: '製品を追加', exact: true })
  await expect(page.locator('.category-row h3').nth(9)).toHaveText('10OS')
  await expect(additions.getByRole('button', { name: 'OSを追加', exact: true })).toHaveCount(0)
  const opener = section.getByRole('button', { name: 'OSを選択', exact: true })
  if (initial === 'empty') {
    await expect(opener).toBeVisible()
    await expect(page.getByRole('alert')).toHaveCount(0)
    await opener.click()
    await page.getByRole('button', { name: `${products[0].name}を構成に追加`, exact: true }).click()
    await expect(section.getByRole('button', { name: `${products[0].name}を変更`, exact: true })).toBeFocused()
  } else {
    await expect(section.getByRole('textbox')).toHaveValue('22000')
    await expect(page.locator('.summary-total dd')).toHaveText('￥22,000')
  }
  await expect(section.locator('.build-item')).toHaveCount(1)
  await expect(opener).toHaveCount(0)
  await expect(section.getByRole('button', { name: 'OSを追加', exact: true })).toHaveCount(0)
  const original = await page.evaluate(() => JSON.parse(localStorage.getItem('pc-build-sheet:build')!) as { version: number; state: { items: { id: string }[] } })
  expect(original.version).toBe(5)
  if (initial === 'saved-v5') expect(original.state.items[0].id).toBe('previously-optional-os')
  await section.getByRole('textbox').fill('30000')
  await section.getByRole('textbox').press('Enter')
  await page.reload()
  await expect(section.getByRole('textbox')).toHaveValue('30000')
  const productButton = section.getByRole('button', { name: `${products[0].name}を変更`, exact: true })
  await productButton.click()
  await page.keyboard.press('Escape')
  await expect(productButton).toBeFocused()
  await expect(section.getByRole('textbox')).toHaveValue('30000')
  await productButton.click()
  await page.getByRole('button', { name: `${products[1].name}に置き換える`, exact: true }).click()
  await expect(section.getByRole('button', { name: `${products[1].name}を変更`, exact: true })).toBeFocused()
  await expect(section.getByRole('textbox')).toHaveValue('')
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('pc-build-sheet:build')!) as unknown)).toMatchObject({ version: 5, state: { items: [
    { id: original.state.items[0].id, category: 'os', product: products[1], price: null },
  ] } })
  await page.reload()
  await expect(section.getByText(products[1].name, { exact: true })).toBeVisible()
  await section.getByRole('button', { name: `${products[1].name}を構成から削除`, exact: true }).click()
  await expect(opener).toBeFocused()
  await page.reload()
  await expect(opener).toBeVisible()
  await expect(page.locator('.category-row')).toHaveCount(10)
  await expect(section.locator('.build-item')).toHaveCount(0)
  await expect(additions.getByRole('button')).toHaveCount(13)
  await expect(page.getByRole('alert')).toHaveCount(0)
  expect(requests.length).toBeGreaterThan(0)
  expect(requests.every((category) => category === 'os')).toBe(true)
})
}

test('empty groups disappear and return when the last product in a category is removed', async ({ page }) => {
  const items = addableOptionalCategories.map(({ id }) => ({ id, kind: 'catalog', category: id, product: makeProduct(id, `Saved ${id}`), price: 1000 }))
  await page.addInitScript((items) => {
    if (!localStorage.getItem('pc-build-sheet:build')) localStorage.setItem('pc-build-sheet:build', JSON.stringify({ version: 5, state: { items } }))
  }, items)
  await page.goto('/')
  const additions = page.getByRole('region', { name: '製品を追加', exact: true })
  await expect(page.locator('.build-item')).toHaveCount(13)
  await expect(additions.getByRole('button')).toHaveCount(0)
  await expect(additions.getByRole('group')).toHaveCount(0)
  await expect(additions.getByText('追加できるカテゴリはすべて構成に含まれています。')).toBeVisible()
  await page.getByRole('button', { name: 'Saved mousepadを構成から削除', exact: true }).click()
  const group = additions.getByRole('group', { name: '周辺機器', exact: true })
  await expect(group).toBeVisible()
  await expect(additions.getByRole('group')).toHaveCount(1)
  const opener = group.getByRole('button', { name: 'マウスパッドを追加', exact: true })
  await expect(opener).toBeFocused()
  await page.reload()
  await opener.click()
  await page.getByRole('button', { name: `${productName}を構成に追加`, exact: true }).click()
  await expect(group).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'マウスパッド', exact: true }).getByRole('button', { name: `${productName}を変更`, exact: true })).toBeFocused()
})

test('excluded categories remain restorable and removable but never return to suggestions', async ({ page }) => {
  const excluded = optionalCategories.filter((category) => category.additionGroup === null)
  const items = excluded.map(({ id }) => ({ id, kind: 'catalog', category: id, product: makeProduct(id, `Saved ${id}`), price: 1000 }))
  await page.addInitScript((items) => {
    if (!localStorage.getItem('pc-build-sheet:build')) localStorage.setItem('pc-build-sheet:build', JSON.stringify({ version: 5, state: { items } }))
  }, items)
  await page.goto('/')
  const additions = page.getByRole('region', { name: '製品を追加', exact: true })
  await expect(page.locator('.build-item')).toHaveCount(7)
  await expect(page.locator('.summary-total dd')).toHaveText('￥7,000')
  await page.reload()
  for (const { id, label } of excluded) {
    const section = page.getByRole('region', { name: label, exact: true })
    await expect(section.getByText(`Saved ${id}`, { exact: true })).toBeVisible()
    await expect(section.getByRole('textbox')).toHaveValue('1000')
    await section.getByRole('button', { name: `Saved ${id}を構成から削除`, exact: true }).click()
    await expect(section).toHaveCount(0)
    await expect(additions.getByRole('button', { name: `${label}を追加`, exact: true })).toHaveCount(0)
  }
  await expect(additions.getByRole('button')).toHaveCount(13)
  await expect(page.getByRole('button', { name: 'CPUを選択', exact: true })).toBeFocused()
  await page.reload()
  await expect(page.locator('.build-item')).toHaveCount(0)
  await expect(page.locator('.summary-total dd')).toHaveText('￥0')
})

test('unknown API categories do not block supported categories, but missing CPU does', async ({ page }) => {
  const requests: string[] = []
  page.on('request', (request) => { if (request.url().includes('/v1/search?')) requests.push(request.url()) })
  await page.route(`${api}/v1/categories`, (route) => route.fulfill({ json: {
    categories: [...categoriesFixture.categories.filter((category) => category !== 'cpu'), 'future_category'],
  } }))
  await page.goto('/')
  await page.getByRole('button', { name: 'CPUを選択', exact: true }).click()
  await expect(page.getByText('このカテゴリは現在カタログで利用できません。')).toBeVisible()
  expect(requests).toEqual([])
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'GPUを選択', exact: true }).click()
  await expect(page.getByRole('dialog').getByText(productName, { exact: true })).toBeVisible()
  expect(requests).toHaveLength(1)
})

for (const mode of ['keyword', 'listing'] as const) {
test(`${mode} pagination follows API tokens, goes back through history and resets on query changes`, async ({ page }) => {
  const requests: Record<string, string>[] = []
  const cursors = ['opaque-page-two', 'opaque-page-three']
  await page.route(`${api}/v1/search?**`, (route) => {
    const params = new URL(route.request().url()).searchParams
    requests.push(Object.fromEntries(params))
    const keyword = params.has('q')
    // A listing that sends any offset fails, including on its first page.
    if (!keyword && params.has('offset')) return route.fulfill({ status: 400, json: { error: 'Use cursor' } })
    const index = keyword ? Number(params.get('offset')) / 20 : params.has('cursor') ? cursors.indexOf(params.get('cursor')!) + 1 : 0
    const hasMore = index < 2
    const products = Array.from({ length: hasMore ? 20 : 1 }, (_, item) => makeProduct('cpu', `${params.get('q') ?? '一覧'} page ${index + 1} item ${item + 1}`, index * 20 + item))
    const response = searchResponse(route.request().url(), products)
    return route.fulfill({ json: { ...response, meta: { ...response.meta, has_more: hasMore,
      next_offset: keyword && hasMore ? (index + 1) * 20 : null,
      next_cursor: !keyword && hasMore ? cursors[index] : null,
    } } })
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'CPUを選択', exact: true }).click()
  const dialog = page.getByRole('dialog')
  const input = dialog.getByRole('textbox')
  if (mode === 'keyword') await input.fill('ryzen')
  const label = mode === 'keyword' ? 'ryzen' : '一覧'
  const next = dialog.getByRole('button', { name: '次へ', exact: true })
  const previous = dialog.getByRole('button', { name: '前へ', exact: true })
  async function expectPage(number: number, name = label) {
    await expect(dialog.getByText(`${name} page ${number} item 1`, { exact: true })).toBeVisible()
    await expect(dialog.getByRole('navigation')).toContainText(`${number}ページ`)
  }
  await expectPage(1)
  await expect(previous).toBeDisabled()
  await next.click()
  await expectPage(2)
  await next.click()
  await expectPage(3)
  await expect(next).toBeDisabled()
  await previous.click()
  await expectPage(2)
  await previous.click()
  await expectPage(1)
  await expect(previous).toBeDisabled()
  await next.click()
  await expectPage(2)
  await input.fill('intel')
  await expectPage(1, 'intel')
  await expect(previous).toBeDisabled()
  await next.click()
  await expectPage(2, 'intel')
  await dialog.getByRole('button', { name: '検索語をクリア' }).click()
  await expectPage(1, '一覧')
  await expect(previous).toBeDisabled()

  expect(requests).toContainEqual({ category: 'cpu', limit: '20' })
  expect(requests).toContainEqual({ category: 'cpu', limit: '20', q: 'intel', offset: '0' })
  expect(requests).toContainEqual({ category: 'cpu', limit: '20', q: 'intel', offset: '20' })
  for (let index = 1; index <= 2; index++) {
    expect(requests).toContainEqual(mode === 'keyword'
      ? { category: 'cpu', limit: '20', q: 'ryzen', offset: String(index * 20) }
      : { category: 'cpu', limit: '20', cursor: cursors[index - 1] })
  }
  for (const params of requests) {
    if (params.q) expect(params).not.toHaveProperty('cursor')
    else expect(params).not.toHaveProperty('offset')
  }
})
}

test('query changes abort an in-flight cursor page and start keyword pagination at zero', async ({ page }) => {
  const aborted: string[] = []
  let pendingStarted = false
  page.on('requestfailed', (request) => aborted.push(request.url()))
  await page.route(`${api}/v1/search?**`, async (route) => {
    const params = new URL(route.request().url()).searchParams
    if (params.has('cursor')) {
      pendingStarted = true
      await new Promise((resolve) => setTimeout(resolve, 1500))
    }
    const response = searchResponse(route.request().url())
    await route.fulfill({ json: { ...response, meta: { ...response.meta,
      has_more: !params.has('q'), next_cursor: params.has('q') ? null : 'pending-cursor',
    } } })
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'CPUを選択', exact: true }).click()
  await page.getByRole('button', { name: '次へ', exact: true }).click()
  await expect.poll(() => pendingStarted).toBe(true)
  await page.getByRole('textbox').fill('9800x3d')
  await expect.poll(() => aborted.some((url) => url.includes('cursor=pending-cursor'))).toBe(true)
  await expect(page.getByRole('dialog').getByRole('status')).toContainText('「9800x3d」の検索結果')
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('broad selection and product areas support pointer and keyboard without intercepting row controls', async ({ page }, testInfo) => {
  await page.goto('/')
  const viewport = page.viewportSize()!
  for (const width of [320, 393, 740, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 960 })
    for (const category of mainCategories) {
      const section = page.getByRole('region', { name: category.label, exact: true })
      const opener = section.getByRole('button', { name: `${category.label}を選択`, exact: true })
      await expect(opener).toHaveText('—パーツを選択')
      await expect(section.getByRole('button', { name: `${category.label}を追加`, exact: true })).toHaveCount(0)
      const box = (await opener.boundingBox())!
      expect(box.width).toBeGreaterThanOrEqual(100)
      expect(box.height).toBeGreaterThanOrEqual(44)
      const heading = (await section.getByRole('heading').boundingBox())!
      expect(box.y).toBeGreaterThanOrEqual(heading.y + heading.height)
      const sectionBox = (await section.boundingBox())!
      expect(Math.abs(box.x - sectionBox.x)).toBeLessThan(1)
      expect(Math.abs(box.width - sectionBox.width)).toBeLessThan(1)
      expect(Math.abs(box.y + box.height - (sectionBox.y + sectionBox.height))).toBeLessThan(1)
      const height = sectionBox.height
      expect(height).toBeGreaterThanOrEqual(68)
      expect(height).toBeLessThanOrEqual(72)
      expect(await section.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`empty-sheet-${width}.png`), fullPage: true })
  }
  await page.setViewportSize(viewport)
  const section = page.getByRole('region', { name: 'CPU', exact: true })
  const opener = section.getByRole('button', { name: 'CPUを選択', exact: true })
  const box = (await opener.boundingBox())!
  await opener.hover()
  await expect(opener).toHaveCSS('box-shadow', 'none')
  await page.screenshot({ path: testInfo.outputPath('selection-row-hover.png'), fullPage: true })
  // The empty space away from the label must also open the existing search dialog.
  await opener.click({ position: { x: box.width - 3, y: box.height - 3 } })
  await expect(page.getByRole('dialog', { name: 'CPUを選択', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(opener).toBeFocused()
  for (const key of ['Enter', 'Space']) {
    await opener.press(key)
    await expect(page.getByRole('dialog', { name: 'CPUを選択', exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(opener).toBeFocused()
  }
  await section.getByText('パーツを選択').click()
  await page.getByRole('button', { name: `${productName}を構成に追加`, exact: true }).click()
  const row = section.locator('.build-item')
  const product = row.getByRole('button', { name: `${productName}を変更`, exact: true })
  await expect(product).toBeFocused()
  const emptyProduct = page.getByRole('button', { name: 'CPUクーラーを選択', exact: true })
  expect(Math.abs((await product.boundingBox())!.x - (await emptyProduct.locator('span').boundingBox())!.x)).toBeLessThan(1)
  await expect(section.getByRole('button', { name: 'CPUを追加', exact: true })).toHaveCount(0)
  for (const area of [product.locator('.product-name'), product.locator('.product-details')]) {
    await area.click()
    await expect(page.getByRole('dialog', { name: 'CPUを変更', exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(product).toBeFocused()
  }
  const productBox = (await product.boundingBox())!
  await product.click({ position: { x: productBox.width - 2, y: 1 } })
  await expect(page.getByRole('dialog', { name: 'CPUを変更', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  for (const key of ['Enter', 'Space']) {
    await product.press(key)
    await expect(page.getByRole('dialog', { name: 'CPUを変更', exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(product).toBeFocused()
  }
  await row.getByRole('textbox').fill('10000')
  await row.getByRole('textbox').press('Enter')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(row.getByRole('button', { name: /数量/ })).toHaveCount(0)
  await expect(page.locator('.summary-total dd')).toHaveText('￥10,000')
  await row.getByRole('button', { name: `${productName}を構成から削除`, exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(opener).toBeFocused()
  await expect(row).toHaveCount(0)
})

for (const mode of ['add', 'replace'] as const) {
test(`wide search dialog is centered, scrolls only results and supports search and paging in ${mode} mode`, async ({ page }, testInfo) => {
  const pageOneProducts = Array.from({ length: 20 }, (_, index) => ({
    ...fixture.data[0],
    id: index + 1,
    upstream_key: `CPU/test-page-1-${index}`,
    name: `${productName} ${index === 0 ? 'LongProductName'.repeat(12) : `モデル ${index + 1}`}`,
  }))
  const pageTwoProduct = { ...fixture.data[0], upstream_key: 'CPU/test-page-2', name: `${productName} 最終候補` }
  const requests: { query: string | null; offset: string | null; cursor: string | null; limit: string | null }[] = []
  await page.route(`${api}/v1/search?**`, (route) => {
    const params = new URL(route.request().url()).searchParams
    const offset = Number(params.get('offset'))
    requests.push({ query: params.get('q'), offset: params.get('offset'), cursor: params.get('cursor'), limit: params.get('limit') })
    return route.fulfill({ json: {
      ...fixture,
      data: offset === 0 ? pageOneProducts : [pageTwoProduct],
      meta: { ...searchResponse(route.request().url()).meta, offset, returned: offset === 0 ? 20 : 1,
        has_more: offset === 0, next_offset: params.has('q') && offset === 0 ? 20 : null,
        next_cursor: !params.has('q') && offset === 0 ? 'page-2' : null },
    } })
  })
  if (mode === 'replace') await page.addInitScript((product) => localStorage.setItem('pc-build-sheet:build', JSON.stringify({ version: 4, state: { items: [
    { id: 'cpu', kind: 'catalog', category: 'cpu', product, quantity: 1, price: 96800 },
  ] } })), fixture.data[0])
  await page.goto('/')
  await page.getByRole('button', { name: mode === 'add' ? 'CPUを選択' : `${productName}を変更`, exact: true }).click()
  const dialog = page.getByRole('dialog')
  const input = dialog.getByRole('textbox')
  await input.fill('9800x3d')
  await expect(dialog.getByRole('status')).toContainText('「9800x3d」の検索結果')
  await expect(dialog.locator('.search-result')).toHaveCount(20)
  await expectCenteredSearchDialog(page)
  await page.screenshot({ path: testInfo.outputPath('wide-search-results.png') })

  const headingBox = await dialog.locator('.dialog-header').boundingBox()
  const inputBox = await input.boundingBox()
  const pageScroll = await page.evaluate(() => window.scrollY)
  const results = dialog.locator('.search-body')
  await results.evaluate((element) => element.scrollTo({ top: element.scrollHeight }))
  expect(await results.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
  expect(await dialog.locator('.dialog-header').boundingBox()).toEqual(headingBox)
  expect(await input.boundingBox()).toEqual(inputBox)
  expect(await dialog.evaluate((element) => element.scrollTop)).toBe(0)
  expect(await page.evaluate(() => window.scrollY)).toBe(pageScroll)

  const next = dialog.getByRole('button', { name: '次へ', exact: true })
  const previous = dialog.getByRole('button', { name: '前へ', exact: true })
  await expect(previous).toBeDisabled()
  await next.click()
  await expect(dialog.getByText(pageTwoProduct.name, { exact: true })).toBeVisible()
  await expect(dialog.getByRole('navigation')).toContainText('2ページ')
  await expect(next).toBeDisabled()
  await expect(input).toHaveValue('9800x3d')
  expect(requests).toContainEqual({ query: '9800x3d', offset: '20', cursor: null, limit: '20' })
  await previous.click()
  await expect(dialog.locator('.search-result')).toHaveCount(20)
  await next.click()
  await dialog.getByRole('button', { name: mode === 'add' ? `${pageTwoProduct.name}を構成に追加` : `${pageTwoProduct.name}に置き換える`, exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('region', { name: '構成パーツ' }).getByText(pageTwoProduct.name, { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: `${pageTwoProduct.name}を変更`, exact: true })).toBeFocused()
})
}

test('search dialog stays within a small viewport and adapts to landscape resizing', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 })
  await page.goto('/')
  await page.getByRole('button', { name: 'CPUを選択', exact: true }).click()
  await expect(page.getByRole('dialog').getByText(productName, { exact: true })).toBeVisible()
  await expectCenteredSearchDialog(page)
  await page.setViewportSize({ width: 740, height: 420 })
  await expectCenteredSearchDialog(page)
  await expect(page.getByRole('textbox')).toBeInViewport()
  await expect(page.getByRole('button', { name: '閉じる', exact: true })).toBeInViewport()
})

test('focus stays inside the modal and backdrop clicks restore focus without closing on text drags', async ({ page, isMobile }) => {
  await page.goto('/')
  const opener = page.getByRole('button', { name: 'CPUを選択', exact: true })
  await opener.click()
  const dialog = page.getByRole('dialog')
  const input = dialog.getByRole('textbox')
  await expect(dialog.getByText(productName, { exact: true })).toBeVisible()
  const close = dialog.getByRole('button', { name: '閉じる', exact: true })
  const lastLink = dialog.getByRole('link').last()
  await lastLink.focus()
  await page.keyboard.press('Tab')
  await expect(close).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(lastLink).toBeFocused()

  await input.fill('9800x3d')
  const box = (await input.boundingBox())!
  const y = box.y + box.height / 2
  const x = box.x + box.width / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(1, y, { steps: 10 })
  await page.mouse.up()
  await expect(dialog).toBeVisible()
  await expect(input).toHaveValue('9800x3d')
  await page.mouse.move(1, y)
  await page.mouse.down()
  await page.mouse.move(x, y, { steps: 10 })
  await page.mouse.up()
  await expect(dialog).toBeVisible()

  if (isMobile) await page.touchscreen.tap(1, y)
  else await page.mouse.click(1, y)
  await expect(dialog).toHaveCount(0)
  await expect(opener).toBeFocused()
  await expect(page.locator('body')).not.toHaveCSS('overflow', 'hidden')
})

test('IME composition suppresses requests even after the debounce interval', async ({ page }) => {
  const queries: string[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.pathname === '/v1/search' && url.searchParams.has('q')) queries.push(url.searchParams.get('q')!)
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'CPUを選択', exact: true }).click()
  await expect(page.getByRole('dialog').getByText(productName, { exact: true })).toBeVisible()
  await page.clock.install()
  const input = page.getByRole('textbox')
  await input.dispatchEvent('compositionstart')
  await input.fill('9800x3d')
  await page.clock.runFor(400)
  await expect(page.getByText('入力を待っています…')).toBeVisible()
  expect(queries).toEqual([])
  await input.dispatchEvent('compositionend')
  await expect(page.getByRole('dialog').getByRole('status')).toContainText('「9800x3d」の検索結果')
  expect(queries).toEqual(['9800x3d'])
})

test('debounces typing, displays zero results and clears back to the category list', async ({ page }) => {
  const queries: string[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.pathname === '/v1/search' && url.searchParams.has('q')) queries.push(url.searchParams.get('q')!)
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'CPUを選択', exact: true }).click()
  await expect(page.getByRole('dialog').getByText(productName, { exact: true })).toBeVisible()
  await page.getByRole('textbox').pressSequentially('missing', { delay: 30 })
  await expect(page.getByText('入力を待っています…')).toBeVisible()
  await expect(page.getByText('製品が見つかりませんでした')).toBeVisible()
  expect(queries).toEqual(['missing'])
  await page.getByRole('button', { name: '検索語をクリア' }).click()
  await expect(page.getByRole('dialog').getByText(productName, { exact: true })).toBeVisible()
})

test('displays HTTP errors, retries manually and respects Retry-After', async ({ page }) => {
  let attempts = 0
  await page.route(`${api}/v1/search?**`, (route) => {
    attempts++
    return attempts === 1
      ? route.fulfill({ status: 429, headers: { 'Retry-After': '2', 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'Retry-After' }, json: { error: { message: 'DO NOT DISPLAY RAW ERROR' } } })
      : route.fulfill({ json: searchResponse(route.request().url()) })
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'CPUを選択', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('検索が混み合っています')
  await expect(page.getByRole('button', { name: /秒後に再試行できます/ })).toBeDisabled()
  await expect(page.getByText('DO NOT DISPLAY RAW ERROR')).toHaveCount(0)
  await page.getByRole('button', { name: '再試行', exact: true }).click()
  await expect(page.getByRole('dialog').getByText(productName, { exact: true })).toBeVisible()
  expect(attempts).toBe(2)
})

test('invalid API responses are an error rather than an empty catalog', async ({ page }) => {
  await page.route(`${api}/v1/search?**`, (route) => route.fulfill({ json: { products: [] } }))
  await page.goto('/')
  await page.getByRole('button', { name: 'CPUを選択', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('製品データの形式を確認できませんでした')
  await expect(page.getByText('製品が見つかりませんでした')).toHaveCount(0)
})

for (const mode of ['add', 'replace'] as const) {
test(`closing a pending ${mode} search aborts it and reopening starts with a clean search`, async ({ page }) => {
  let pendingStarted = false
  const aborted: string[] = []
  page.on('requestfailed', (request) => aborted.push(request.url()))
  await page.route(`${api}/v1/search?**`, async (route) => {
    if (new URL(route.request().url()).searchParams.get('q') === 'pending') {
      pendingStarted = true
      await new Promise((resolve) => setTimeout(resolve, 1500))
    }
    await route.fulfill({ json: searchResponse(route.request().url()) })
  })
  await page.goto('/')
  if (mode === 'replace') {
    await page.getByRole('button', { name: 'CPUを選択', exact: true }).click()
    await page.getByRole('button', { name: `${productName}を構成に追加`, exact: true }).click()
  }
  const opener = page.getByRole('button', { name: mode === 'add' ? 'CPUを選択' : `${productName}を変更`, exact: true })
  await opener.click()
  await page.getByRole('dialog').getByRole('textbox').fill('pending')
  await expect.poll(() => pendingStarted).toBe(true)
  await page.getByRole('button', { name: '閉じる', exact: true }).click()
  await expect.poll(() => aborted.some((url) => url.includes('q=pending'))).toBe(true)
  await expect(opener).toBeFocused()
  await opener.click()
  await expect(page.getByRole('dialog').getByRole('textbox')).toHaveValue('')
  await expect(page.getByRole('dialog').getByText(productName, { exact: true })).toBeVisible()
})
}

test('invalid persisted data gives a visible recovery message', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('pc-build-sheet:build', '{invalid'))
  await page.goto('/')
  await expect(page.getByRole('alert')).toContainText('保存済みの構成を読み込めませんでした')
  await expect(page.locator('.summary-count strong')).toHaveText('0')
  await page.getByRole('button', { name: 'CPUを選択', exact: true }).click()
  await page.getByRole('button', { name: `${productName}を構成に追加`, exact: true }).click()
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('estimate: inline editing, zero prices, persistence, saved custom items and deletion', async ({ page }, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/')
  await page.getByRole('button', { name: 'CPUを選択', exact: true }).click()
  await page.getByRole('textbox', { name: '製品名・型番で検索' }).fill('9800x3d')
  await page.getByRole('button', { name: `${productName}を構成に追加`, exact: true }).click()
  const cpu = page.locator('.build-item').filter({ has: page.getByText(productName, { exact: true }) })
  const total = page.locator('.summary-total dd')
  const price = cpu.getByRole('textbox', { name: `価格：${productName}（円）`, exact: true })
  await expect(page.getByText(/区分|流用|購入合計/)).toHaveCount(0)
  await expect(page.getByRole('button', { name: '購入', exact: true })).toHaveCount(0)
  await expect(page.getByText('見積もり合計', { exact: true })).toBeVisible()
  await expect(price).toHaveValue('')
  await expect(page.locator('.summary-incomplete')).toContainText('価格未入力 1点')
  await expect(page.getByText(/単価|数量|小計/)).toHaveCount(0)
  await price.fill('32,800')
  await expect(cpu.locator('.price-display')).toHaveCount(0)
  await expect(total).toHaveText('￥0') // Drafts are not persisted on every keystroke.
  await price.press('Tab')
  await expect(total).toHaveText('￥32,800')
  await expect(cpu.locator('.price-display')).toHaveText('￥32,800')
  await expect(page.locator('.summary-count strong')).toHaveText('1')
  await expect(page.locator('.summary-incomplete')).toHaveCount(0)

  await price.fill('0')
  await price.press('Enter')
  await expect(total).toHaveText('￥0')
  await expect(page.locator('.summary-unpriced dd')).toHaveText('0点')
  await expect(cpu.locator('.price-display')).toHaveText('￥0')
  await expect(page.locator('.summary-incomplete')).toHaveCount(0)
  await page.reload()
  await expect(price).toHaveValue('0')
  await expect(total).toHaveText('￥0')
  await price.fill('32800')
  await price.press('Enter')
  await expect(total).toHaveText('￥32,800')
  await page.reload()
  await expect(price).toHaveValue('32800')
  await expect(page.locator('.summary-count strong')).toHaveText('1')
  await expect(total).toHaveText('￥32,800')

  // Older saved custom items remain visible/editable even though new entry is removed.
  await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('pc-build-sheet:build')!) as { state: { items: unknown[] } }
    saved.state.items.push({ id: 'saved-custom', kind: 'custom', name: 'Windows 11 Pro', price: null })
    localStorage.setItem('pc-build-sheet:build', JSON.stringify(saved))
  })
  await page.reload()
  await expect(page.locator('textarea')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '任意項目を追加', exact: true })).toHaveCount(0)
  const custom = page.getByRole('region', { name: '保存済みの任意項目', exact: true }).locator('.build-item')
  await custom.getByRole('textbox').fill('22000')
  await custom.getByRole('textbox').press('Enter')
  await expect(total).toHaveText('￥54,800')
  await custom.getByRole('textbox').fill('0')
  await custom.getByRole('textbox').press('Enter')
  await expect(total).toHaveText('￥32,800')
  await expect(custom.locator('.price-display')).toHaveText('￥0')
  await custom.getByRole('textbox').fill('22000')
  await custom.getByRole('textbox').press('Enter')
  await custom.getByRole('button', { name: 'Windows 11 Proの名前を編集', exact: true }).click()
  await page.getByRole('textbox', { name: '名前（必須）', exact: true }).fill('Windows 11 Pro 日本語版')
  await page.getByRole('button', { name: '保存する', exact: true }).click()
  await page.reload()
  await expect(custom.getByText('Windows 11 Pro 日本語版', { exact: true })).toBeVisible()
  await expect(total).toHaveText('￥54,800')
  await expect(page.locator('.summary-count strong')).toHaveText('2')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await expect(page.getByText(/メモを|メモ$/)).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('compact-estimate.png'), fullPage: true })
  await cpu.getByRole('button', { name: `${productName}を構成から削除` }).click()
  await expect(total).toHaveText('￥22,000')
  await expect(page.locator('.summary-count strong')).toHaveText('1')
  await custom.getByRole('button', { name: 'Windows 11 Pro 日本語版を構成から削除', exact: true }).click()
  await expect(page.getByRole('button', { name: 'CPUを選択', exact: true })).toBeFocused()
  await expect(page.getByRole('region', { name: '保存済みの任意項目', exact: true })).toHaveCount(0)
  await expect(total).toHaveText('￥0')
  await expect(page.locator('.summary-count strong')).toHaveText('0')
  await page.reload()
  await expect(page.locator('.build-item')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('price drafts, zero versus null, invalid values and small-screen long content', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 568 })
  const name = 'LongCustomName'.repeat(14)
  await page.addInitScript((name) => {
    if (!localStorage.getItem('pc-build-sheet:build')) localStorage.setItem('pc-build-sheet:build', JSON.stringify({ version: 5, state: { items: [
      { id: 'saved-custom', kind: 'custom', name, price: null },
    ] } }))
  }, name)
  await page.goto('/')
  await page.getByRole('button', { name: `${name}の名前を編集`, exact: true }).click()
  await expect(page.locator('textarea')).toHaveCount(0)
  const dialog = page.getByRole('dialog')
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  await page.getByRole('button', { name: '保存する', exact: true }).click()
  const row = page.locator('.build-item')
  const price = row.getByRole('textbox')
  await price.fill('100')
  await price.press('Enter')
  for (const invalid of ['-', '-1', '1.5', '100000001', '1e3']) {
    await price.fill(invalid)
    await price.press('Tab')
    await expect(price).toHaveAttribute('aria-invalid', 'true')
    await expect(row.getByRole('alert')).toContainText('変更は未保存')
    await expect(page.locator('.summary-total dd')).toHaveText('￥100')
    await price.press('Escape')
    await expect(price).toHaveValue('100')
    await expect(row.getByRole('alert')).toHaveCount(0)
  }
  await price.fill('0')
  await price.press('Enter')
  await expect(page.locator('.summary-unpriced dd')).toHaveText('0点')
  await expect(row.locator('.price-display')).toHaveText('￥0')
  await price.fill('')
  await expect(page.locator('.summary-unpriced dd')).toHaveText('0点')
  await price.press('Tab')
  await expect(page.locator('.summary-unpriced dd')).toHaveText('1点')
  await expect(page.locator('.summary-incomplete')).toContainText('構成全体の総額ではありません')
  await page.reload()
  await expect(price).toHaveValue('')
  await expect(page.locator('.summary-unpriced dd')).toHaveText('1点')
  await price.fill('0')
  await price.press('Enter')
  await expect(page.locator('.summary-unpriced dd')).toHaveText('0点')
  await expect(page.locator('.summary-incomplete')).toHaveCount(0)
  await page.reload()
  await expect(price).toHaveValue('0')
  await price.fill('100000000')
  await price.press('Enter')
  await expect(page.locator('.summary-total dd')).toHaveText('￥100,000,000')
  for (const width of [320, 700, 740, 900, 1024, 1280]) {
    await page.setViewportSize({ width, height: 720 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    expect(await row.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  }
  await page.setViewportSize({ width: 320, height: 568 })
  await page.screenshot({ path: testInfo.outputPath('phase2-small-long-content.png'), fullPage: true })
  const edit = row.getByRole('button', { name: `${name}の名前を編集`, exact: true })
  await edit.click()
  await page.getByRole('textbox', { name: '名前（必須）', exact: true }).fill('未保存の変更')
  await page.keyboard.press('Escape')
  await expect(edit).toBeFocused()
  await expect(row.getByText(name, { exact: true })).toBeVisible()
})

test('expands legacy quantities in the browser and allows independent deletion', async ({ page }) => {
  await page.addInitScript((product) => {
    if (!localStorage.getItem('pc-build-sheet:build')) localStorage.setItem('pc-build-sheet:build', JSON.stringify({ version: 1, state: { items: [
      { id: 'legacy', category: 'cpu', product, quantity: 99, price: 32800, source: 'buy', memo: 'Phase 1のメモ' },
    ] } }))
  }, fixture.data[0])
  await page.goto('/')
  const rows = page.locator('.build-item')
  await expect(page.getByText(/メモを|メモ$/)).toHaveCount(0)
  await expect(rows).toHaveCount(99)
  await expect(page.getByRole('button', { name: /数量/ })).toHaveCount(0)
  await expect(page.locator('.summary-total dd')).toHaveText('￥3,247,200')
  await rows.last().getByRole('button', { name: `${productName}を構成から削除` }).click()
  await expect(page.locator('.summary-total dd')).toHaveText('￥3,214,400')
  await page.reload()
  await expect(rows).toHaveCount(98)
  await expect(page.locator('.summary-count strong')).toHaveText('98')
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('pc-build-sheet:build')!) as { version: number; state: { items: unknown[] } })
  expect(saved.version).toBe(5)
  expect(saved.state.items).toHaveLength(98)
  expect(saved.state.items[0]).toMatchObject({ id: 'legacy', kind: 'catalog', price: 32800 })
  for (const item of saved.state.items) expect(item).not.toHaveProperty('quantity')
  expect(saved.state.items[0]).not.toHaveProperty('memo')
  expect(saved.state.items[0]).not.toHaveProperty('source')
})

for (const version of [1, 2, 3]) {
test(`migrates v${version} sources to zero prices once while preserving items and the estimate`, async ({ page }) => {
  const product = makeProduct('cpu', 'Migration CPU')
  const base = { kind: 'catalog', category: 'cpu', product }
  const items = [
    { ...base, id: 'priced', price: 10000, quantity: 1, source: 'buy' },
    { ...base, id: 'owned-price', price: 32800, quantity: 2, source: 'owned' },
    { ...base, id: 'owned-null', price: null, quantity: 3, source: 'owned' },
    { ...base, id: 'unpriced', price: null, quantity: 4, source: 'buy' },
    { ...base, id: 'free', price: 0, quantity: 5, source: 'buy' },
    ...(version === 1 ? [] : [{ kind: 'custom', id: 'custom', name: 'OS', price: 22000, quantity: 6, source: 'owned' }]),
  ]
  const legacy = items.map((item) => ({ ...item, kind: version === 1 ? undefined : item.kind, memo: '旧メモ' }))
  await page.addInitScript(({ version, items }) => {
    if (!localStorage.getItem('pc-build-sheet:build')) localStorage.setItem('pc-build-sheet:build', JSON.stringify({ version, state: { items } }))
  }, { version, items: legacy })
  await page.goto('/')
  const rows = page.locator('.build-item')
  await expect(rows).toHaveCount(version === 1 ? 15 : 21)
  await expect(page.locator('.summary-total dd')).toHaveText('￥10,000')
  await expect(page.locator('.summary-count strong')).toHaveText(version === 1 ? '15' : '21')
  await expect(page.locator('.summary-unpriced dd')).toHaveText('4点')
  await expect(page.getByText(/区分|流用|購入合計/)).toHaveCount(0)
  await expect(rows.nth(1).getByRole('textbox')).toHaveValue('0')
  await expect(rows.nth(2).getByRole('textbox')).toHaveValue('0')
  await expect(rows.nth(6).getByRole('textbox')).toHaveValue('')
  await expect(rows.nth(10).getByRole('textbox')).toHaveValue('0')
  const expectedItems = items.flatMap(({ source, quantity, ...item }) => Array.from({ length: quantity }, (_, index) => ({ ...item, id: index === 0 ? item.id : expect.any(String), price: source === 'owned' ? 0 : item.price })))
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('pc-build-sheet:build')!) as unknown)
  expect(saved).toEqual({ version: 5, state: { items: expectedItems } })
  await page.reload()
  await expect(rows.nth(1).getByRole('textbox')).toHaveValue('0')
  await expect(page.locator('.summary-total dd')).toHaveText('￥10,000')
  // After migration a manually entered price is ordinary data and must never be zeroed again.
  await rows.nth(1).getByRole('textbox').fill('500')
  await rows.nth(1).getByRole('textbox').press('Enter')
  await page.reload()
  await expect(rows.nth(1).getByRole('textbox')).toHaveValue('500')
  await expect(page.locator('.summary-total dd')).toHaveText('￥10,500')
  await expect(page.locator('.summary-unpriced dd')).toHaveText('4点')
})
}

test('multiple storage rows remain independently editable and persist', async ({ page }) => {
  const ssd = {
    ...fixture.data[0], category: 'storage', name: 'Test SSD 2TB', upstream_key: 'Storage/test-ssd',
    specs: { storage_type: 'SSD', form_factor: 'M.2', interface: 'PCIe', capacity_gb: 2000, pcie_generation: 4, cache_mb: null, pcie_lanes: 4, nvme: 1 },
  }
  await page.route(`${api}/v1/search?**`, (route) => route.fulfill({ json: searchResponse(route.request().url(), [catalogProductSchema.parse(ssd)]) }))
  await page.goto('/')
  const category = partCategories.find(({ id }) => id === 'storage')!
  await page.getByRole('button', { name: `${category.label}を選択`, exact: true }).click()
  await page.getByRole('button', { name: `${ssd.name}を構成に追加`, exact: true }).click()
  await page.getByRole('button', { name: `${category.label}を追加`, exact: true }).click()
  await page.getByRole('button', { name: `${ssd.name}を構成に追加`, exact: true }).click()
  const rows = page.getByRole('region', { name: category.label, exact: true }).locator('.build-item')
  await expect(rows).toHaveCount(2)
  await rows.first().getByRole('textbox').fill('15000')
  await rows.first().getByRole('textbox').press('Enter')
  await rows.last().getByRole('textbox').fill('0')
  await rows.last().getByRole('textbox').press('Enter')
  await expect(page.locator('.summary-total dd')).toHaveText('￥15,000')
  await expect(page.locator('.summary-count strong')).toHaveText('2')
  await expect(page.locator('.summary-unpriced dd')).toHaveText('0点')
  await page.reload()
  await expect(rows).toHaveCount(2)
  await expect(rows.first().getByRole('textbox')).toHaveValue('15000')
  await expect(rows.last().getByRole('textbox')).toHaveValue('0')
  await rows.first().getByRole('button', { name: `${ssd.name}を構成から削除` }).click()
  await expect(rows).toHaveCount(1)
  await expect(page.locator('.summary-count strong')).toHaveText('1')
  await expect(page.locator('.summary-total dd')).toHaveText('￥0')
})

test('single product name opens replacement, cancellation keeps values, replacement resets price and preserves ID', async ({ page }) => {
  const replacement = makeProduct('cpu', 'AMD Ryzen 9 replacement', 2)
  await page.route(`${api}/v1/search?**`, (route) => route.fulfill({ json: searchResponse(route.request().url(), [catalogProductSchema.parse(fixture.data[0]), replacement]) }))
  await page.goto('/')
  await page.getByRole('button', { name: 'CPUを選択', exact: true }).click()
  await page.getByRole('button', { name: `${productName}を構成に追加`, exact: true }).click()
  const row = page.getByRole('region', { name: 'CPU', exact: true }).locator('.build-item')
  const opener = row.getByRole('button', { name: `${productName}を変更`, exact: true })
  await expect(opener).toBeFocused()
  await expect(page.getByRole('button', { name: 'CPUを追加', exact: true })).toHaveCount(0)
  await row.getByRole('textbox').fill('96800')
  await row.getByRole('textbox').press('Enter')
  const original = await page.evaluate(() => JSON.parse(localStorage.getItem('pc-build-sheet:build')!) as { state: { items: { id: string }[] } })
  await opener.click()
  await expect(page.getByRole('dialog', { name: 'CPUを変更', exact: true })).toBeVisible()
  await expectCenteredSearchDialog(page)
  await page.mouse.click(1, 1)
  await expect(opener).toBeFocused()
  await expect(row.getByRole('textbox')).toHaveValue('96800')
  await expect(row.locator('.price-display')).toHaveText('￥96,800')
  await opener.press('Enter')
  await page.getByRole('textbox', { name: '製品名・型番で検索' }).fill('replacement')
  await page.getByRole('button', { name: `${replacement.name}に置き換える`, exact: true }).click()
  await expect(row).toHaveCount(1)
  await expect(row.getByRole('button', { name: `${replacement.name}を変更`, exact: true })).toBeFocused()
  await expect(row.getByRole('textbox')).toHaveValue('')
  await expect(page.locator('.summary-count strong')).toHaveText('1')
  await expect(page.locator('.summary-total dd')).toHaveText('￥0')
  await expect(page.locator('.summary-unpriced dd')).toHaveText('1点')
  await page.reload()
  await expect(row.getByRole('textbox')).toHaveValue('')
  await expect(page.locator('.summary-unpriced dd')).toHaveText('1点')
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('pc-build-sheet:build')!) as unknown)).toMatchObject({ version: 5, state: { items: [{ id: original.state.items[0].id, price: null, product: replacement }] } })
})

test('multiple category adds distinct products, replaces only the clicked row and clears stale price drafts', async ({ page }) => {
  const products = [makeProduct('storage', 'Samsung 990 PRO 2TB', 1), makeProduct('storage', 'WD Black SN850X 4TB', 2), makeProduct('storage', 'Replacement SSD', 3)]
  await page.route(`${api}/v1/search?**`, (route) => route.fulfill({ json: searchResponse(route.request().url(), products) }))
  await page.goto('/')
  await page.getByRole('button', { name: 'ストレージを選択', exact: true }).click()
  await page.getByRole('button', { name: `${products[0].name}を構成に追加`, exact: true }).click()
  const section = page.getByRole('region', { name: 'ストレージ', exact: true })
  const add = section.getByRole('button', { name: 'ストレージを追加', exact: true })
  await expect(add).toBeFocused()
  await expect(add).toHaveText('追加')
  await add.click()
  await page.getByRole('button', { name: `${products[1].name}を構成に追加`, exact: true }).click()
  const rows = section.locator('.build-item')
  await expect(rows).toHaveCount(2)
  await rows.first().getByRole('textbox').fill('18800')
  await rows.first().getByRole('textbox').press('Enter')
  await rows.last().getByRole('textbox').fill('28000')
  await rows.last().getByRole('textbox').press('Enter')
  await expect(page.locator('.summary-total dd')).toHaveText('￥46,800')
  await rows.first().getByRole('textbox').fill('-')
  await rows.first().getByRole('textbox').press('Tab')
  await expect(rows.first().getByRole('alert')).toBeVisible()
  await rows.first().getByText(products[0].name, { exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'ストレージを変更', exact: true })).toBeVisible()
  await page.getByRole('button', { name: `${products[2].name}に置き換える`, exact: true }).click()
  await expect(rows).toHaveCount(2)
  await expect(rows.first().getByRole('textbox')).toHaveValue('')
  await expect(rows.first().getByRole('alert')).toHaveCount(0)
  await expect(rows.last().getByRole('textbox')).toHaveValue('28000')
  await expect(page.locator('.summary-total dd')).toHaveText('￥28,000')
  await expect(page.locator('.summary-unpriced dd')).toHaveText('1点')
  await rows.last().locator('.product-details').click()
  await expect(page.getByRole('dialog', { name: 'ストレージを変更', exact: true })).toBeVisible()
  await page.getByRole('button', { name: `${products[0].name}に置き換える`, exact: true }).click()
  await expect(rows.last().getByRole('textbox')).toHaveValue('')
  await expect(rows.first().getByText(products[2].name, { exact: true })).toBeVisible()
  await rows.first().getByRole('button', { name: `${products[2].name}を構成から削除` }).click()
  await expect(rows).toHaveCount(1)
  await expect(rows.getByRole('button', { name: `${products[0].name}を変更`, exact: true })).toBeFocused()
  await page.reload()
  await expect(rows).toHaveCount(1)
  await expect(add).toBeVisible()
})

test('filled sheet stays dense, aligns desktop columns and avoids mobile overlap after v2 migration', async ({ page, isMobile }, testInfo) => {
  const names = ['AMD Ryzen 7 9800X3D', 'DeepCool MYSTIQUE 240mm', 'DDR5 32GB Kit', 'MSI B760M MORTAR WIFI', 'GeForce RTX 5070', 'Samsung 990 PRO 2TB', 'Corsair RM850x', 'Fractal Design North', 'Noctua NF-A12x25', 'Windows 11 Home']
  const manufacturers = ['AMD', 'DeepCool', 'G.Skill', 'MSI', 'NVIDIA', 'Samsung', 'Corsair', 'Fractal Design', 'Noctua', 'Microsoft']
  const items = mainCategories.map((category, index) => ({
    id: `item-${category.id}`, kind: 'catalog', category: category.id, product: { ...makeProduct(category.id, names[index]), manufacturer: manufacturers[index] },
    price: 10000, quantity: 1, source: 'buy', memo: '削除対象の旧メモ',
  }))
  await page.addInitScript((items) => {
    if (!localStorage.getItem('pc-build-sheet:build')) localStorage.setItem('pc-build-sheet:build', JSON.stringify({ version: 2, state: { items } }))
  }, items)
  await page.goto('/')
  const sheet = page.getByRole('region', { name: '構成パーツ', exact: true })
  const rows = sheet.locator('.build-item')
  await expect(rows).toHaveCount(10)
  await expect(page.locator('.summary-total dd')).toHaveText('￥100,000')
  await expect(page.getByText(/メモを|旧メモ/)).toHaveCount(0)
  await expect(page.locator('textarea')).toHaveCount(0)
  for (const category of mainCategories) {
    const section = page.getByRole('region', { name: category.label, exact: true })
    await expect(section.getByRole('button', { name: `${category.label}を追加`, exact: true })).toHaveCount(category.cardinality === 'multiple' ? 1 : 0)
    await expect(section.getByRole('button', { name: `${category.label}を選択`, exact: true })).toHaveCount(0)
  }
  await expect(page.getByText(/区分|流用|購入合計/)).toHaveCount(0)
  for (const label of ['単価', '数量', '小計']) await expect(sheet.getByText(label, { exact: true })).toHaveCount(0)
  const metrics = []
  for (const width of isMobile ? [740, 393, 320] : [1440, 1024, 1280]) {
    await page.setViewportSize({ width, height: 960 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    const sheetHeight = (await sheet.boundingBox())!.height
    const rowHeights = await rows.evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().height))
    const categoryHeights = await sheet.locator('.category-row.has-items').evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().height))
    metrics.push({ width, sheetHeight, rowHeights, categoryHeights })
    expect(Math.max(...rowHeights)).toBeLessThanOrEqual(isMobile ? 135 : 60)
    expect(Math.max(...categoryHeights)).toBeLessThanOrEqual(isMobile ? 175 : 82)
    expect(sheetHeight).toBeLessThanOrEqual(isMobile ? 1450 : 850)
    const summary = page.getByRole('complementary', { name: '構成サマリー', exact: true })
    expect(await summary.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
    const total = (await summary.locator('.summary-total dd').boundingBox())!
    const count = (await summary.locator('.summary-count').boundingBox())!
    expect(count.y).toBeGreaterThan(total.y + total.height)
    const summaryBox = (await summary.boundingBox())!
    const sheetBox = (await sheet.boundingBox())!
    if (width > 1100) {
      expect(summaryBox.width).toBeGreaterThanOrEqual(280)
      expect(summaryBox.width).toBeLessThanOrEqual(294)
      expect(summaryBox.x - (sheetBox.x + sheetBox.width)).toBeGreaterThanOrEqual(20)
      expect(summaryBox.x - (sheetBox.x + sheetBox.width)).toBeLessThanOrEqual(24)
    } else {
      expect(summaryBox.y).toBeGreaterThanOrEqual(sheetBox.y + sheetBox.height)
    }
    for (const row of await rows.all()) {
      // Actual clickable rectangles, not just document overflow: no controls may overlap.
      const boxes = await row.locator('button, input').evaluateAll((elements) => elements.map((element) => {
        const { x, y, width, height } = element.getBoundingClientRect()
        return { x, y, width, height }
      }))
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j]
        const overlap = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > 1
          && Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > 1
        expect(overlap, `overlapping controls at ${width}px`).toBe(false)
      }
      if (!isMobile) {
        const headings = await sheet.locator('.sheet-columns > span').evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().x))
        const columns = await row.locator(':scope > button, :scope > .price-field').evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().x))
        for (let i = 0; i < headings.length; i++) expect(Math.abs(headings[i] - columns[i])).toBeLessThan(1)
        const centers = await row.locator(':scope > button, :scope > .price-field').evaluateAll((elements) => elements.map((element) => {
          const rect = element.getBoundingClientRect()
          return rect.y + rect.height / 2
        }))
        expect(Math.max(...centers) - Math.min(...centers)).toBeLessThan(1)
      }
    }
    await page.screenshot({ path: testInfo.outputPath(`filled-sheet-${width}.png`), fullPage: true })
  }
  const metricsPath = testInfo.outputPath('sheet-density.json')
  await writeFile(metricsPath, JSON.stringify(metrics, null, 2))
  await testInfo.attach('sheet-density', { path: metricsPath, contentType: 'application/json' })
  await page.screenshot({ path: testInfo.outputPath('filled-compact-sheet.png'), fullPage: true })
  const before = (await sheet.boundingBox())!.height
  const extra = makeProduct('storage', 'Additional SSD', 99)
  await page.route(`${api}/v1/search?**`, (route) => route.fulfill({ json: searchResponse(route.request().url(), [extra]) }))
  await page.getByRole('button', { name: 'ストレージを追加', exact: true }).click()
  await page.getByRole('button', { name: `${extra.name}を構成に追加`, exact: true }).click()
  await expect(rows).toHaveCount(11)
  expect((await sheet.boundingBox())!.height - before).toBeLessThanOrEqual(isMobile ? 135 : 60)
  await page.screenshot({ path: testInfo.outputPath('multiple-storage-sheet.png'), fullPage: true })
  const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('pc-build-sheet:build')!) as { version: number; state: { items: unknown[] } })
  expect(persisted.version).toBe(5)
  for (const item of persisted.state.items) {
    expect(item).not.toHaveProperty('memo')
    expect(item).not.toHaveProperty('source')
    expect(item).not.toHaveProperty('quantity')
  }
})
