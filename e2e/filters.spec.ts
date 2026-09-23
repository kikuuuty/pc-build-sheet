import { expect, test, type Page } from '@playwright/test'
import fixture from '../src/test/fixtures/cpu-search.json' with { type: 'json' }
import categories from '../src/test/fixtures/categories.json' with { type: 'json' }
import { catalogProductSchema } from '../src/api/catalog/schemas'
import type { FilterMetadata, SearchConditions } from '../src/api/catalog/filters'
import type { PartCategory } from '../src/domain/categories'
import { cpuFacets, cpuFilters, monitorFilters, range, selection, staticFacets, storageFilters } from '../src/test/filter-fixtures'

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
async function mock(page: Page, extra: FilterMetadata[] = [], dynamicCpu = false) {
  const requests: Input[] = []
  const facetRequests: SearchConditions[] = []
  const metadata = [cpuFilters, storageFilters, monitorFilters, ...extra]
  await page.route(`${api}/v1/categories/*/facets`, (route) => {
    const category = new URL(route.request().url()).pathname.split('/')[3]
    const conditions = route.request().postDataJSON() as SearchConditions
    facetRequests.push(conditions)
    return route.fulfill({ json: dynamicCpu && category === 'cpu' ? cpuFacets(conditions)
      : staticFacets(metadata.findLast((item) => item.category === category) ?? { category, filters: [selection('manufacturer', 'メーカー', ['Test'])] }) })
  })
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
  return Object.assign(requests, { facetRequests })
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

test('300ms keyword and shared filter debounce, IME, range errors and numeric zero', async ({ page }) => {
  const requests = await mock(page)
  // Install before mounting hooks so cleanup never mixes native and fake timer IDs.
  await page.clock.install()
  await page.goto('/')
  await page.getByRole('button', { name: 'CPUを選択', exact: true }).click()
  await expect(page.getByText('Test cpu page 1', { exact: true })).toBeVisible()
  await openFilters(page)
  await expect(page.getByText('候補を更新しています…', { exact: true })).toHaveCount(0)
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000))
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
  await page.clock.runFor(300)
  // React Query batches HTTP completion notifications on a timer, also paused by the fake clock.
  await expect.poll(async () => { await page.clock.runFor(50); return page.getByText('候補を更新しています…', { exact: true }).count() }).toBe(0)
  await page.getByLabel('クーラー付属', { exact: true }).selectOption({ label: 'なし' })
  await page.clock.runFor(300)
  await expect.poll(() => requests.length).toBe(start + 3)
  expect(requests.at(-1)).toMatchObject({ filters: { manufacturer: ['AMD'], includes_cooler: [0] }, ranges: { core_count: { min: 8, max: 12 } } })

  await keyword.dispatchEvent('compositionstart')
  await keyword.fill('Ryzen 7')
  await page.clock.runFor(600)
  expect(requests).toHaveLength(start + 3)
  await keyword.dispatchEvent('compositionend')
  await page.clock.runFor(299)
  expect(requests).toHaveLength(start + 3)
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
    return attempts <= 2 ? route.fulfill({ status: 429, headers: { 'Retry-After': '1' }, json: {} })
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
  expect(attempts).toBe(3)
})

test('changing a filter and closing the dialog abort pending POST searches', async ({ page }) => {
  await mock(page)
  const started: Input[] = []
  const aborted: Input[] = []
  page.on('requestfailed', (request) => { if (request.method() === 'POST' && new URL(request.url()).pathname === '/v1/search') aborted.push(request.postDataJSON()) })
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
  expect(urls.some((url) => url.endsWith('/os/facets'))).toBe(false)
})

async function expandCandidates(page: Page, label: string) {
  const trigger = page.locator(`summary[aria-label="${label}を選択"]`)
  if (await trigger.locator('..').getAttribute('open') === null) await trigger.click()
  return page.getByRole('group', { name: label, exact: true })
}

test('zero conditions and keyword-only edits use static metadata; clearing restores it without facets', async ({ page }) => {
  const requests = await mock(page, [], true)
  await page.clock.install()
  await page.goto('/')
  await page.getByRole('button', { name: 'CPUを選択', exact: true }).click()
  await openFilters(page)
  const sockets = await expandCandidates(page, 'ソケット')
  await expect(sockets.getByRole('checkbox')).toHaveCount(4)
  await expect(page.getByText('Test cpu page 1', { exact: true })).toBeVisible()
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000))
  expect(requests.facetRequests).toHaveLength(0)
  const keyword = page.getByRole('textbox', { name: '製品名・型番で検索' })
  await keyword.fill('ryzen')
  await page.clock.runFor(299)
  expect(requests).toHaveLength(1)
  await page.clock.runFor(1)
  await expect.poll(() => requests.length).toBe(2)
  expect(requests.facetRequests).toHaveLength(0)

  await selectCheck(page, 'メーカー', 'Intel')
  await page.clock.runFor(299)
  expect(requests.facetRequests).toHaveLength(0)
  await page.clock.runFor(1)
  await expect.poll(() => requests.facetRequests.length).toBe(1)
  expect(requests.facetRequests[0]).toEqual({ filters: { manufacturer: ['Intel'] } })
  await expect.poll(async () => { await page.clock.runFor(50); return sockets.getByRole('checkbox').count() }).toBe(2)
  await page.getByRole('button', { name: 'フィルターをすべて解除' }).click()
  await expect(sockets.getByRole('checkbox')).toHaveCount(4)
  await expect(page.getByText('候補を更新しています…', { exact: true })).toHaveCount(0)
  await page.clock.runFor(1000)
  await expect(page.getByRole('dialog').getByRole('status')).toContainText('「ryzen」の検索結果')
  expect(requests.facetRequests).toHaveLength(1)
  // The zero-condition keyword query is still fresh in React Query's cache.
  expect(requests).toHaveLength(3)
})

test('rapid filter edits send only final conditions once to both facets and search', async ({ page }) => {
  const requests = await mock(page, [], true)
  await page.clock.install()
  await page.goto('/')
  await page.getByRole('button', { name: 'CPUを選択', exact: true }).click()
  await openFilters(page)
  await expect(page.getByText('Test cpu page 1', { exact: true })).toBeVisible()
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000))
  await selectCheck(page, 'メーカー', 'AMD')
  await page.clock.runFor(200)
  await selectCheck(page, 'ソケット', 'AM5')
  await page.clock.runFor(299)
  expect(requests.facetRequests).toHaveLength(0)
  expect(requests).toHaveLength(1)
  await page.clock.runFor(1)
  await expect.poll(() => requests.facetRequests.length).toBe(1)
  await expect.poll(() => requests.length).toBe(2)
  const conditions = { filters: { manufacturer: ['AMD'], socket: ['AM5'] } }
  expect(requests.facetRequests).toEqual([conditions])
  expect(requests[1]).toEqual({ category: 'cpu', limit: 20, ...conditions })
  await page.clock.runFor(1000)
  expect(requests.facetRequests).toHaveLength(1)
  expect(requests).toHaveLength(2)
})

test('dynamic CPU candidates follow manufacturer, preserve self-exclusion, and ignore keyword', async ({ page }) => {
  const requests = await mock(page, [], true)
  await page.goto('/')
  await page.getByRole('button', { name: 'CPUを選択', exact: true }).click()
  await openFilters(page)
  const manufacturers = await expandCandidates(page, 'メーカー')
  await expect(manufacturers.getByRole('checkbox')).toHaveCount(2)
  await selectCheck(page, 'メーカー', 'Intel')
  const sockets = await expandCandidates(page, 'ソケット')
  const families = await expandCandidates(page, 'ファミリー')
  await expect(sockets.getByRole('checkbox', { name: 'AM5', exact: true })).toHaveCount(0)
  await expect(families.getByRole('checkbox', { name: 'Ryzen 7', exact: true })).toHaveCount(0)
  await expect(families.getByRole('checkbox', { name: 'Core i7', exact: true })).toBeEnabled()
  await selectCheck(page, 'ソケット', 'LGA1700')
  await expect(sockets.getByRole('checkbox', { name: 'LGA1851', exact: true })).toBeEnabled()
  await expect.poll(() => requests.facetRequests.at(-1)).toEqual({ filters: { manufacturer: ['Intel'], socket: ['LGA1700'] } })
  const count = requests.facetRequests.length
  await page.getByRole('textbox', { name: '製品名・型番で検索' }).fill('9800X3D')
  await expect.poll(() => requests.at(-1)?.keyword).toBe('9800X3D')
  expect(requests.facetRequests).toHaveLength(count)
  await sockets.getByRole('checkbox', { name: 'LGA1700', exact: true }).uncheck()
  await manufacturers.getByRole('checkbox', { name: 'Intel', exact: true }).uncheck()
  await selectCheck(page, 'メーカー', 'AMD')
  await expect(sockets.getByRole('checkbox', { name: 'LGA1700', exact: true })).toHaveCount(0)
  await expect(sockets.getByRole('checkbox', { name: 'AM5', exact: true })).toBeEnabled()
  await expect(families.getByRole('checkbox', { name: 'Ryzen 7', exact: true })).toBeEnabled()
  await expect(families.getByRole('checkbox', { name: 'Core i7', exact: true })).toHaveCount(0)
})

test('contradictory selection survives fallback recovery, remains in search and is removable', async ({ page }) => {
  const requests = await mock(page, [], true)
  // A saved/fallback selection can be contradictory even though fresh dynamic choices prevent it.
  await page.route(`${api}/v1/categories/cpu/facets`, (route) => {
    const conditions = route.request().postDataJSON() as SearchConditions
    return conditions.filters?.manufacturer ? route.fallback() : route.fulfill({ status: 500, json: {} })
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'CPUを選択', exact: true }).click()
  await openFilters(page)
  await selectCheck(page, 'ソケット', 'AM5')
  await selectCheck(page, 'メーカー', 'Intel')
  const sockets = await expandCandidates(page, 'ソケット')
  const conflict = sockets.getByRole('checkbox', { name: 'AM5（現在利用できません）', exact: true })
  await expect(conflict).toBeChecked()
  await expect(conflict).toBeEnabled()
  await expect(sockets.getByRole('checkbox', { name: 'AM4', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'ソケット: AM5を解除' })).toBeVisible()
  expect(requests.at(-1)?.filters).toEqual({ socket: ['AM5'], manufacturer: ['Intel'] })
  await expect(page.getByText('この条件は現在の他条件と両立しません。解除して選び直してください。').first()).toBeVisible()
  await conflict.uncheck()
  await expect.poll(() => requests.at(-1)?.filters).toEqual({ manufacturer: ['Intel'] })
  await expect(conflict).toHaveCount(0)
  await expect(sockets.getByRole('checkbox', { name: 'LGA1851', exact: true })).toBeEnabled()
})

test('facet debounce allows additions, aborts Intel, and never applies its late response to AMD', async ({ page }) => {
  const requests = await mock(page, [], true)
  await page.clock.install()
  let release!: () => void
  const held = new Promise<void>((resolve) => { release = resolve })
  let started = false
  let aborted = false
  let delivered = false
  page.on('requestfailed', (request) => {
    if (request.url().endsWith('/cpu/facets') && request.postDataJSON()?.filters?.manufacturer?.includes('Intel')) aborted = true
  })
  await page.route(`${api}/v1/categories/cpu/facets`, async (route) => {
    const input = route.request().postDataJSON() as SearchConditions
    if (!input.filters?.manufacturer?.includes('Intel')) return route.fallback()
    started = true
    await held
    await route.fulfill({ json: cpuFacets(input) })
    delivered = true
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'CPUを選択', exact: true }).click()
  await openFilters(page)
  await expect(page.getByText('候補を更新しています…', { exact: true })).toHaveCount(0)
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000))
  const before = requests.facetRequests.length
  await selectCheck(page, 'メーカー', 'Intel')
  const sockets = await expandCandidates(page, 'ソケット')
  await expect(sockets.getByRole('checkbox', { name: 'AM5', exact: true })).toBeEnabled()
  await page.clock.runFor(299)
  expect(started).toBe(false)
  expect(requests.facetRequests).toHaveLength(before)
  await page.clock.runFor(1)
  await expect.poll(() => started).toBe(true)
  // New selections, including single-select controls, remain available during the held request.
  await page.locator('.advanced-filters > summary').click()
  await expect(page.getByLabel('クーラー付属', { exact: true }).getByRole('option', { name: 'なし', exact: true })).toBeEnabled()
  await sockets.getByRole('checkbox', { name: 'LGA1700', exact: true }).check()
  await expect.poll(() => aborted).toBe(true)
  await page.getByRole('button', { name: 'フィルターをすべて解除' }).click()
  await page.clock.runFor(300)
  expect(requests.facetRequests).toHaveLength(before)
  await selectCheck(page, 'メーカー', 'AMD')
  await page.clock.runFor(300)
  await expect.poll(async () => { await page.clock.runFor(50); return page.getByText('候補を更新しています…', { exact: true }).count() }).toBe(0)
  await expect(sockets.getByRole('checkbox', { name: 'AM5', exact: true })).toBeEnabled()
  release()
  await expect.poll(() => delivered).toBe(true)
  await page.clock.runFor(500)
  await expect(sockets.getByRole('checkbox', { name: 'LGA1700', exact: true })).toHaveCount(0)
  await expect(page.getByRole('checkbox', { name: 'AMD', exact: true })).toBeChecked()
})

test('dynamic 429 fallback keeps static choices and search, respects Retry-After and can retry', async ({ page }) => {
  await mock(page, [], true)
  let attempts = 0
  await page.route(`${api}/v1/categories/cpu/facets`, (route) => {
    attempts++
    return attempts <= 2 ? route.fulfill({ status: 429, headers: { 'Retry-After': '1', 'Access-Control-Expose-Headers': 'Retry-After' }, json: {} }) : route.fallback()
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'CPUを選択', exact: true }).click()
  await openFilters(page)
  await selectCheck(page, 'メーカー', 'Intel')
  const fallback = page.getByText('絞り込み候補を更新できませんでした。カテゴリ全体の候補を表示しています。')
  await expect(fallback).toBeVisible()
  expect(attempts).toBe(2)
  await expect(page.getByRole('button', { name: /秒後に候補を再試行できます/ })).toBeDisabled()
  const sockets = await expandCandidates(page, 'ソケット')
  await expect(sockets.getByRole('checkbox', { name: 'AM5', exact: true })).toBeEnabled()
  await expect(page.getByText('Test cpu page 1', { exact: true })).toBeVisible()
  await expect(page.getByText('フィルターを取得できませんでした', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '候補を再試行', exact: true }).click()
  await expect(fallback).toHaveCount(0)
  await expect(sockets.getByRole('checkbox', { name: 'AM5', exact: true })).toHaveCount(0)
  await expect(sockets.getByRole('checkbox', { name: 'LGA1700', exact: true })).toBeEnabled()
  expect(attempts).toBe(3)
})

for (const failure of ['network', 'invalid-response', '503'] as const) {
  test(`dynamic ${failure} failure uses static fallback without breaking product search`, async ({ page }) => {
    await mock(page)
    let attempts = 0
    await page.route(`${api}/v1/categories/cpu/facets`, (route) => {
      attempts++
      if (failure === 'network') return route.abort('failed')
      return route.fulfill({ status: failure === '503' ? 503 : 200, json: { category: 'cpu', facets: { socket: { options: [{ value: 'AM5', label: 'AM5', count: 0 }] } } } })
    })
    await page.goto('/')
    await page.getByRole('button', { name: 'CPUを選択', exact: true }).click()
    await openFilters(page)
    await selectCheck(page, 'メーカー', 'Intel')
    await expect(page.getByText('絞り込み候補を更新できませんでした。カテゴリ全体の候補を表示しています。')).toBeVisible()
    const sockets = await expandCandidates(page, 'ソケット')
    await expect(sockets.getByRole('checkbox', { name: 'AM5', exact: true })).toBeEnabled()
    await expect(sockets.getByRole('checkbox', { name: 'LGA1700', exact: true })).toBeEnabled()
    await expect(page.getByText('Test cpu page 1', { exact: true })).toBeVisible()
    expect(attempts).toBe(failure === 'invalid-response' ? 1 : 2)
    await expect(page.getByRole('button', { name: '候補を再試行', exact: true })).toBeEnabled()
  })
}

test('an incompatible boolean stays selected and can be cleared to unspecified', async ({ page }) => {
  const requests = await mock(page)
  await page.route(`${api}/v1/categories/cpu/facets`, (route) => {
    const input = route.request().postDataJSON() as SearchConditions
    const response = cpuFacets()
    if (input.filters?.manufacturer) response.facets.includes_cooler.options = [{ value: 1, label: 'あり', count: 2 }]
    return route.fulfill({ json: response })
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'CPUを選択', exact: true }).click()
  await openFilters(page)
  await page.locator('.advanced-filters > summary').click()
  const cooler = page.getByLabel('クーラー付属', { exact: true })
  await cooler.selectOption({ label: 'なし' })
  await selectCheck(page, 'メーカー', 'Intel')
  await expect(cooler).toHaveAttribute('aria-invalid', 'true')
  await expect(cooler.locator('option:checked')).toHaveText('なし（現在利用できません）')
  expect(requests.at(-1)?.filters).toEqual({ includes_cooler: [0], manufacturer: ['Intel'] })
  await cooler.selectOption('')
  await expect.poll(() => requests.at(-1)?.filters).toEqual({ manufacturer: ['Intel'] })
  await expect(cooler).toHaveValue('')
})

function deferredResponse() {
  let release!: () => void
  const ready = new Promise<void>((resolve) => { release = resolve })
  return { ready, release }
}

const retryTargets = [
  { id: 'search', path: '/v1/search**', subject: '製品検索', loading: '製品を検索しています…' },
  { id: 'facets', path: '/v1/categories/cpu/facets', subject: '絞り込み候補の更新', loading: '候補を更新しています…' },
  { id: 'metadata', path: '/v1/categories/cpu/filters', subject: 'フィルター取得', loading: 'フィルターを読み込んでいます…' },
  { id: 'categories', path: '/v1/categories', subject: 'カテゴリ取得', loading: 'カテゴリを読み込んでいます…' },
] as const
const rateLimitHeaders = { 'Retry-After': '30', 'Access-Control-Expose-Headers': 'Retry-After' }

for (const target of retryTargets) {
  test(`${target.id}: distinguishes loading, rate-limit countdown and actual retry, then clears on success`, async ({ page }) => {
    await mock(page, [], true)
    await page.clock.install()
    const first = deferredResponse()
    const retry = deferredResponse()
    let attempts = 0
    await page.route(`${api}${target.path}`, async (route) => {
      if (route.request().method() === 'OPTIONS') return route.fallback()
      attempts++
      if (attempts === 1) {
        await first.ready
        return route.fulfill({ status: 429, headers: rateLimitHeaders, json: {} })
      }
      await retry.ready
      return route.fallback()
    })
    await page.goto('/')
    await page.getByRole('button', { name: 'CPUを選択', exact: true }).click()
    await openFilters(page)
    if (target.id === 'facets') await selectCheck(page, 'メーカー', 'Intel')
    await expect.poll(() => attempts).toBe(1)
    await expect(page.getByText(target.loading, { exact: true })).toBeVisible()
    const status = page.getByRole('status', { name: `${target.subject}の再試行状況` })
    await expect(status).toHaveCount(0)
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000))

    first.release()
    // Flush React Query's batched notifications as well as the countdown's timer.
    await expect.poll(async () => { await page.clock.runFor(50); return status.count() }).toBe(1)
    await expect(status).toContainText('APIの利用制限に達しています。あと30秒で自動再試行します。')
    await expect(status.locator('.spinner')).toHaveCount(0)
    await expect(page.getByText(target.loading, { exact: true })).toHaveCount(0)
    if (target.id === 'facets' || target.id === 'metadata') {
      await expect(page.getByText('Test cpu page 1', { exact: true })).toBeVisible()
      await expect(page.getByRole('status', { name: '製品検索の再試行状況' })).toHaveCount(0)
    }
    if (target.id === 'facets') {
      const sockets = await expandCandidates(page, 'ソケット')
      await expect(sockets.getByRole('checkbox', { name: 'LGA1700', exact: true })).toBeEnabled()
    }
    await page.clock.runFor(1000)
    await expect(status).toContainText('あと29秒で自動再試行します。')
    await page.clock.runFor(28_000)
    expect(attempts).toBe(1)
    await expect(status).not.toContainText('自動再試行しています…')
    await page.clock.runFor(1000)
    await expect.poll(() => attempts).toBe(2)
    await expect(status).toContainText('自動再試行しています…')
    await expect(status).not.toContainText('あと')
    await expect(status.locator('.spinner')).toHaveCount(1)
    await page.clock.runFor(1000)
    await expect(status).toContainText('自動再試行しています…')

    retry.release()
    await expect.poll(async () => { await page.clock.runFor(50); return status.count() }).toBe(0)
    await expect.poll(async () => { await page.clock.runFor(50); return page.getByText('Test cpu page 1', { exact: true }).count() }).toBe(1)
    expect(attempts).toBe(2)
    await expect(page.getByText(target.loading, { exact: true })).toHaveCount(0)
  })
}

for (const target of retryTargets.filter(({ id }) => id === 'search' || id === 'facets')) {
  for (const longWait of [false, true]) {
    test(`${target.id}: ${longWait ? 'over-60s wait' : 'exhausted retry'} shows the final error without automatic retry status`, async ({ page }) => {
      await mock(page)
      await page.clock.install()
      const first = deferredResponse()
      let attempts = 0
      await page.route(`${api}${target.path}`, async (route) => {
        if (route.request().method() === 'OPTIONS') return route.fallback()
        attempts++
        await first.ready
        return route.fulfill({ status: 429, headers: { ...rateLimitHeaders, 'Retry-After': longWait ? '61' : '30' }, json: {} })
      })
      await page.goto('/')
      await page.getByRole('button', { name: 'CPUを選択', exact: true }).click()
      await openFilters(page)
      if (target.id === 'facets') await selectCheck(page, 'メーカー', 'Intel')
      await expect.poll(() => attempts).toBe(1)
      await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000))
      first.release()
      const status = page.getByRole('status', { name: `${target.subject}の再試行状況` })
      if (!longWait) {
        await expect.poll(async () => { await page.clock.runFor(50); return status.count() }).toBe(1)
        await page.clock.runFor(30_000)
      }
      const error = page.getByRole('alert').filter({ hasText: target.id === 'search' ? '検索が混み合っています' : '絞り込み候補を更新できませんでした' })
      await expect.poll(async () => { await page.clock.runFor(50); return error.count() }).toBe(1)
      await expect(status).toHaveCount(0)
      await expect(page.getByText(target.loading, { exact: true })).toHaveCount(0)
      await expect(error.getByRole('button', { name: /秒後に.*再試行できます/ })).toBeDisabled()
      await page.clock.runFor(120_000)
      expect(attempts).toBe(longWait ? 1 : 2)
      await expect(status).toHaveCount(0)
      await expect(error.getByRole('button')).toBeEnabled()
    })
  }
}

for (const cancel of ['clear filters', 'close dialog'] as const) {
  test(`${cancel} cancels both rate-limit waits, removes notices and does not reuse stale retry state`, async ({ page }) => {
    await mock(page, [], true)
    await page.clock.install()
    const attempts = { search: 0, facets: 0 }
    for (const endpoint of ['search', 'facets'] as const) {
      await page.route(`${api}${endpoint === 'search' ? '/v1/search' : '/v1/categories/cpu/facets'}`, (route) => {
        if (route.request().method() !== 'POST') return route.fallback()
        attempts[endpoint]++
        return attempts[endpoint] === 1 ? route.fulfill({ status: 429, headers: rateLimitHeaders, json: {} }) : route.fallback()
      })
    }
    await page.goto('/')
    await page.getByRole('button', { name: 'CPUを選択', exact: true }).click()
    await openFilters(page)
    await expect(page.getByText('Test cpu page 1', { exact: true })).toBeVisible()
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000))
    await selectCheck(page, 'メーカー', 'Intel')
    await page.clock.runFor(300)
    const statuses = page.getByRole('status', { name: /の再試行状況$/ })
    await expect.poll(async () => { await page.clock.runFor(50); return statuses.count() }).toBe(2)
    if (cancel === 'clear filters') await page.getByRole('button', { name: 'フィルターをすべて解除' }).click()
    else await page.getByRole('button', { name: '閉じる', exact: true }).click()
    await expect(statuses).toHaveCount(0)
    await page.clock.runFor(31_000)
    expect(attempts).toEqual({ search: 1, facets: 1 })
    if (cancel === 'clear filters') {
      await expect(page.getByText('Test cpu page 1', { exact: true })).toBeVisible()
      await selectCheck(page, 'メーカー', 'Intel')
      await page.clock.runFor(300)
    } else {
      await page.getByRole('button', { name: 'CPUを選択', exact: true }).click()
      await openFilters(page)
    }
    await expect.poll(() => attempts).toEqual({ search: 2, facets: 2 })
    await expect.poll(async () => { await page.clock.runFor(50); return page.getByText('Test cpu page 1', { exact: true }).count() }).toBe(1)
    await expect(statuses).toHaveCount(0)
  })
}
