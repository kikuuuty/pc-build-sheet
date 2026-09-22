import { expect, test, type Page } from '@playwright/test'
import fixture from '../src/test/fixtures/cpu-search.json' with { type: 'json' }
import categories from '../src/test/fixtures/categories.json' with { type: 'json' }
import { catalogProductSchema } from '../src/api/catalog/schemas'
import type { FilterMetadata, SearchConditions } from '../src/api/catalog/filters'
import type { PartCategory } from '../src/domain/categories'
import { cpuFilters, monitorFilters, range, selection, storageFilters } from '../src/test/filter-fixtures'

const api = 'https://pc-parts-catalog.kikuuuty.workers.dev'
type Input = SearchConditions & { category: PartCategory; keyword?: string; cursor?: string; offset?: number; limit: number }

function product(category: PartCategory, page = 1) {
  const schema = catalogProductSchema.options.find((option) => option.shape.category.value === category)!
  return { ...fixture.data[0], category, name: `Test ${category} page ${page}`, upstream_key: `${category}/test-${page}`,
    specs: category === 'cpu' ? fixture.data[0].specs : Object.fromEntries(Object.keys(schema.shape.specs.shape).map((key) => [key, null])) }
}
function response(input: Input) {
  const second = !!input.cursor || !!input.offset
  return { data: input.keyword === 'missing' ? [] : [product(input.category, second ? 2 : 1)], meta: {
    ...fixture.meta, offset: input.offset ?? 0, returned: input.keyword === 'missing' ? 0 : 1, limit: 20,
    has_more: !second && input.keyword !== 'missing', window_limit: input.keyword ? 1000 : null,
    next_offset: input.keyword && !second && input.keyword !== 'missing' ? 20 : null,
    next_cursor: !input.keyword && !second ? 'next-page' : null,
  } }
}
async function mock(page: Page, extra: FilterMetadata[] = []) {
  const requests: Input[] = []
  const metadata = [cpuFilters, storageFilters, monitorFilters, ...extra]
  await page.route(`${api}/v1/categories`, (route) => route.fulfill({ json: categories }))
  await page.route(`${api}/v1/categories/*/filters`, (route) => {
    const category = new URL(route.request().url()).pathname.split('/')[3]
    return route.fulfill({ json: metadata.findLast((item) => item.category === category) ?? { category, filters: [selection('manufacturer', 'メーカー', ['Test'])] } })
  })
  await page.route(`${api}/v1/search**`, (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Allow-Headers': 'Content-Type' } })
    const params = new URL(route.request().url()).searchParams
    const input: Input = route.request().method() === 'POST' ? route.request().postDataJSON() : {
      category: params.get('category') as PartCategory, limit: 20,
      ...(params.has('q') ? { keyword: params.get('q')!, offset: Number(params.get('offset')) } : {}),
      ...(params.has('cursor') ? { cursor: params.get('cursor')! } : {}),
    }
    requests.push(input)
    return route.fulfill({ json: response(input), headers: { 'Access-Control-Allow-Origin': '*' } })
  })
  return requests
}
async function openFilters(page: Page) {
  const toggle = page.getByRole('button', { name: /^絞り込み/ })
  if (await toggle.isVisible() && await toggle.getAttribute('aria-expanded') === 'false') await toggle.click()
  await expect(page.getByRole('complementary', { name: '検索フィルター' })).toBeVisible()
}
async function selectCheck(page: Page, label: string, value: string) {
  // Locate the summary by its accessible label, without treating it as a native select.
  const trigger = page.locator(`summary[aria-label="${label}を選択"]`)
  if (await trigger.locator('..').getAttribute('open') === null) await trigger.click()
  await page.getByRole('group', { name: label, exact: true }).getByRole('checkbox', { name: value, exact: true }).check()
}

test('one shared 300ms timer, IME, range errors and numeric zero', async ({ page }) => {
  const requests = await mock(page)
  await page.goto('/')
  await page.getByRole('button', { name: 'CPUを選択', exact: true }).click()
  await expect(page.getByText('Test cpu page 1', { exact: true })).toBeVisible()
  await openFilters(page)
  await page.clock.install()
  await page.clock.pauseAt(new Date())
  const start = requests.length
  const keyword = page.getByRole('textbox', { name: '製品名・型番で検索' })
  await keyword.fill('ryzen')
  await page.clock.runFor(200)
  await selectCheck(page, 'メーカー', 'AMD')
  await page.clock.runFor(299)
  expect(requests).toHaveLength(start)
  await page.clock.runFor(1)
  await expect.poll(() => requests.length).toBe(start + 1)
  expect(requests.at(-1)).toEqual({ category: 'cpu', limit: 20, keyword: 'ryzen', offset: 0, filters: { manufacturer: ['AMD'] } })

  await page.locator('.advanced-filters > summary').click()
  const minimum = page.getByRole('textbox', { name: 'コア数の最小値' })
  await minimum.fill('8')
  await page.getByRole('textbox', { name: 'コア数の最大値' }).fill('4')
  await page.clock.runFor(300)
  await expect(minimum).toHaveAttribute('aria-invalid', 'true')
  expect(requests).toHaveLength(start + 1)
  await page.getByRole('textbox', { name: 'コア数の最大値' }).fill('12')
  await page.getByLabel('クーラー付属', { exact: true }).selectOption({ label: 'なし' })
  await page.clock.runFor(300)
  await expect.poll(() => requests.length).toBe(start + 2)
  expect(requests.at(-1)).toMatchObject({ filters: { manufacturer: ['AMD'], includes_cooler: [0] }, ranges: { core_count: { min: 8, max: 12 } } })

  await keyword.dispatchEvent('compositionstart')
  await keyword.fill('Ryzen 7')
  await page.clock.runFor(600)
  expect(requests).toHaveLength(start + 2)
  await keyword.dispatchEvent('compositionend')
  await page.clock.runFor(299)
  expect(requests).toHaveLength(start + 2)
  await page.clock.runFor(1)
  await expect.poll(() => requests.at(-1)?.keyword).toBe('Ryzen 7')
})

test('filtered cursor/offset pages, tags, keyword-preserving reset and per-category session', async ({ page }) => {
  const requests = await mock(page)
  await page.goto('/')
  await page.getByRole('button', { name: 'CPUを選択', exact: true }).click()
  await openFilters(page)
  await selectCheck(page, 'ソケット', 'AM5')
  await expect.poll(() => requests.at(-1)?.filters?.socket).toEqual(['AM5'])
  await page.getByRole('button', { name: '次へ', exact: true }).click()
  await expect(page.getByText('Test cpu page 2', { exact: true })).toBeVisible()
  expect(requests.at(-1)).toEqual({ category: 'cpu', limit: 20, cursor: 'next-page', filters: { socket: ['AM5'] } })
  await page.getByRole('button', { name: '前へ', exact: true }).click()
  await expect(page.getByText('Test cpu page 1', { exact: true })).toBeVisible()
  await page.getByRole('textbox', { name: '製品名・型番で検索' }).fill('ryzen')
  await expect.poll(() => requests.at(-1)?.keyword).toBe('ryzen')
  expect(requests.at(-1)?.offset).toBe(0)
  await page.getByRole('button', { name: '次へ', exact: true }).click()
  await expect(page.getByText('Test cpu page 2', { exact: true })).toBeVisible()
  expect(requests.at(-1)).toMatchObject({ keyword: 'ryzen', offset: 20, filters: { socket: ['AM5'] } })
  await page.getByRole('button', { name: '閉じる', exact: true }).click()
  await page.getByRole('button', { name: 'メモリを選択', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '製品名・型番で検索' })).toHaveValue('')
  await expect(page.getByLabel('選択中のフィルター')).toHaveCount(0)
  await page.getByRole('button', { name: '閉じる', exact: true }).click()
  await page.getByRole('button', { name: 'CPUを選択', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '製品名・型番で検索' })).toHaveValue('ryzen')
  await expect(page.getByText('Test cpu page 1', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'ソケット: AM5を解除' })).toBeVisible()
  await page.getByRole('button', { name: 'Test cpu page 1を構成に追加' }).click()
  await page.getByRole('button', { name: 'Test cpu page 1を変更', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '製品名・型番で検索' })).toHaveValue('ryzen')
  await page.getByRole('button', { name: 'フィルターをすべて解除' }).click()
  await expect.poll(() => requests.at(-1)).toEqual({ category: 'cpu', keyword: 'ryzen', offset: 0, limit: 20 })
  await page.reload()
  await page.getByRole('button', { name: 'Test cpu page 1を変更', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '製品名・型番で検索' })).toHaveValue('')
})

test('NVMe preset and monitor resolution ranges leave no hidden conditions', async ({ page }) => {
  const requests = await mock(page)
  await page.goto('/')
  await page.getByRole('button', { name: 'ストレージを選択', exact: true }).click()
  await openFilters(page)
  await page.getByLabel('ストレージ種類', { exact: true }).selectOption({ label: 'NVMe SSD' })
  await expect.poll(() => requests.at(-1)?.filters).toEqual({ storage_type: ['SSD'], nvme: [1] })
  await page.getByLabel('ストレージ種類', { exact: true }).selectOption({ label: 'HDD' })
  await expect.poll(() => requests.at(-1)?.filters).toEqual({ storage_type: ['HDD'] })
  await expect(page.getByText('PCIe世代', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'ストレージ種類: HDDを解除' }).click()
  // The unfiltered first page is already cached; clearing must restore it without a POST.
  await expect(page.getByLabel('ストレージ種類', { exact: true })).toHaveValue('')
  await expect(page.getByLabel('選択中のフィルター')).toHaveCount(0)
  await expect(page.getByRole('dialog').getByRole('status')).toContainText('ストレージの製品一覧')
  await page.getByRole('button', { name: '閉じる', exact: true }).click()
  await page.getByRole('button', { name: 'モニターを追加', exact: true }).click()
  await openFilters(page)
  await page.getByLabel('解像度', { exact: true }).selectOption('wuxga')
  await expect.poll(() => requests.at(-1)?.ranges).toEqual({ resolution_width: { min: 1920, max: 1920 }, resolution_height: { min: 1200, max: 1200 } })
  await page.locator('.advanced-filters > summary').click()
  await page.getByRole('textbox', { name: '横解像度の最小値' }).fill('')
  await page.getByRole('textbox', { name: '横解像度の最大値' }).fill('')
  await page.getByRole('textbox', { name: '縦解像度の最小値' }).fill('1080')
  await expect(page.getByLabel('解像度', { exact: true })).toHaveValue('custom')
  await expect.poll(() => requests.at(-1)?.ranges).toEqual({ resolution_height: { min: 1080, max: 1200 } })
  await selectCheck(page, '映像入力端子', 'HDMI 2.1')
  await expect.poll(() => requests.at(-1)?.facets).toEqual({ ports: ['hdmi_2_1'] })
  await page.getByLabel('解像度', { exact: true }).selectOption('')
  await expect.poll(() => requests.at(-1)?.ranges).toBeUndefined()
  expect(requests.at(-1)?.facets).toEqual({ ports: ['hdmi_2_1'] })
})

test('candidate search is local, maximum ten selections, Escape and responsive scrolling', async ({ page }, testInfo) => {
  const manufacturers = Array.from({ length: 12 }, (_, i) => `Brand ${i}`)
  const requests = await mock(page, [{ ...cpuFilters, filters: [selection('manufacturer', 'メーカー', manufacturers), ...cpuFilters.filters.slice(1)] }])
  await page.goto('/')
  await page.getByRole('button', { name: 'CPUを選択', exact: true }).click()
  await openFilters(page)
  await page.locator('summary[aria-label="メーカーを選択"]').click()
  const candidates = page.getByRole('searchbox', { name: 'メーカーの候補を検索' })
  const before = requests.length
  await candidates.fill('Brand 11')
  await expect(page.getByRole('group', { name: 'メーカー', exact: true }).getByRole('checkbox')).toHaveCount(1)
  await page.waitForTimeout(350)
  expect(requests).toHaveLength(before)
  await candidates.fill('')
  for (let i = 0; i < 10; i++) await page.getByRole('checkbox', { name: `Brand ${i}`, exact: true }).check()
  await expect(page.getByRole('checkbox', { name: 'Brand 10', exact: true })).toBeDisabled()
  await page.getByRole('checkbox', { name: 'Brand 0', exact: true }).uncheck()
  await expect(page.getByRole('checkbox', { name: 'Brand 10', exact: true })).toBeEnabled()
  await candidates.focus()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.locator('summary[aria-label="メーカーを選択"]')).toBeFocused()
  await expect(page.getByRole('button', { name: 'ほか6件' })).toBeVisible()
  await page.getByRole('button', { name: 'ほか6件' }).click()
  await expect(page.getByRole('button', { name: 'メーカー: Brand 9を解除' })).toBeVisible()
  for (const width of [1280, 320]) {
    await page.setViewportSize({ width, height: 760 })
    await openFilters(page)
    const dialog = page.getByRole('dialog')
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await expect(page.getByRole('button', { name: '閉じる', exact: true })).toBeInViewport()
    await page.screenshot({ path: testInfo.outputPath(`filters-${width}.png`) })
    if (width === 320) {
      await page.getByRole('button', { name: /^絞り込み/ }).click()
      await expect(page.getByRole('complementary', { name: '検索フィルター' })).toBeHidden()
      await expect(page.getByRole('button', { name: 'メーカー: Brand 1を解除' })).toBeVisible()
    }
  }
})

test('metadata failures do not block keyword search; retry and empty controls are accessible', async ({ page }) => {
  await mock(page)
  let attempts = 0
  await page.route(`${api}/v1/categories/cpu/filters`, (route) => {
    attempts++
    return attempts === 1 ? route.fulfill({ status: 429, headers: { 'Retry-After': '1' }, json: {} })
      : route.fulfill({ json: { category: 'cpu', filters: [selection('manufacturer', 'メーカー', []), { ...range('core_count', 'コア数', true), range: null }] } })
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'CPUを選択', exact: true }).click()
  await expect(page.getByText('Test cpu page 1', { exact: true })).toBeVisible()
  await openFilters(page)
  await expect(page.getByText('フィルターを取得できませんでした')).toBeVisible()
  await page.getByRole('textbox', { name: '製品名・型番で検索' }).fill('ryzen')
  await expect(page.getByRole('dialog').getByRole('status')).toContainText('「ryzen」の検索結果')
  await page.getByRole('button', { name: '再試行', exact: true }).click()
  await expect(page.locator('summary[aria-label="メーカーを選択"]')).toContainText('候補なし')
  await page.locator('.advanced-filters > summary').click()
  await expect(page.getByRole('textbox', { name: 'コア数の最小値' })).toBeDisabled()
  expect(attempts).toBe(2)
})

test('changing a filter and closing the dialog abort pending POST searches', async ({ page }) => {
  await mock(page)
  const started: Input[] = []
  const aborted: Input[] = []
  page.on('requestfailed', (request) => { if (request.method() === 'POST') aborted.push(request.postDataJSON()) })
  await page.route(`${api}/v1/search`, async (route) => {
    if (route.request().method() !== 'POST') return route.fallback()
    const input = route.request().postDataJSON() as Input
    started.push(input)
    await new Promise((resolve) => setTimeout(resolve, 1500))
    await route.fulfill({ json: response(input) })
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'CPUを選択', exact: true }).click()
  await openFilters(page)
  await selectCheck(page, 'メーカー', 'AMD')
  await expect.poll(() => started.length).toBe(1)
  await selectCheck(page, 'ソケット', 'AM5')
  await expect.poll(() => aborted.length).toBe(1)
  await expect.poll(() => started.length).toBe(2)
  await page.getByRole('button', { name: '閉じる', exact: true }).click()
  await expect.poll(() => aborted.length).toBe(2)
  await expect(page.getByRole('button', { name: 'CPUを選択', exact: true })).toBeFocused()
})

test('OS has no filter controls or metadata request', async ({ page }) => {
  await mock(page)
  const urls: string[] = []
  page.on('request', (request) => urls.push(request.url()))
  await page.goto('/')
  await page.getByRole('button', { name: 'OSを選択', exact: true }).click()
  await expect(page.getByText('Test os page 1', { exact: true })).toBeVisible()
  await expect(page.getByRole('complementary', { name: '検索フィルター' })).toHaveCount(0)
  expect(urls.some((url) => url.endsWith('/os/filters'))).toBe(false)
})
