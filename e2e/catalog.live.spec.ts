import { expect, test } from '@playwright/test'
import { setTimeout as delay } from 'node:timers/promises'
import { categoriesResponseSchema, searchResponseSchema } from '../src/api/catalog/schemas'
import { partCategories } from '../src/domain/categories'
import { CATALOG_BASE_URL } from '../src/api/catalog/client'
import { productSpecSummary } from '../src/domain/product-summary'
import { filtersResponseSchema } from '../src/api/catalog/filters'
import { getUiFilters } from '../src/features/search/filter-config'

test('production API: categories and all 30 product contracts', async ({ request }) => {
  // Explicitly opt-in via npm run test:live; ordinary tests do not depend on production.
  const categoriesResponse = await request.get(`${CATALOG_BASE_URL}/v1/categories`)
  expect(categoriesResponse.status()).toBe(200)
  const { categories } = categoriesResponseSchema.parse(await categoriesResponse.json())
  expect(categories.length).toBeGreaterThanOrEqual(30)
  for (const category of partCategories) {
    expect(categories).toContain(category.id)
    // Thirty sequential probes must respect Production's admission budget.
    await delay(1000)
    const url = `${CATALOG_BASE_URL}/v1/search?category=${category.id}&limit=20`
    let response = await request.get(url)
    if (response.status() === 429) {
      const retryAfter = Number(response.headers()['retry-after'])
      if (Number.isFinite(retryAfter) && retryAfter > 0 && retryAfter <= 60) {
        await delay(retryAfter * 1000)
        response = await request.get(url)
      }
    }
    expect(response.status(), category.id).toBe(200)
    const result = searchResponseSchema.parse(await response.json())
    expect(result.data.length, category.id).toBeGreaterThan(0)
    expect(result.data.every((product) => product.category === category.id)).toBe(true)
    for (const product of result.data) expect(typeof productSpecSummary(product)).toBe('string')
    expect(result.meta).toMatchObject({ offset: 0, next_offset: null, window_limit: null, window_exhausted: false })
  }
})

test('production filters: all 30 metadata contracts and monitor custom resolution search', async ({ request }) => {
  test.setTimeout(240_000)
  for (const category of partCategories) {
    await delay(3500)
    const url = `${CATALOG_BASE_URL}/v1/categories/${category.id}/filters`
    let response = await request.get(url)
    if (response.status() === 429 || response.status() === 503) {
      const retryAfter = Number(response.headers()['retry-after'])
      if (Number.isFinite(retryAfter) && retryAfter > 0 && retryAfter <= 60) {
        await delay(retryAfter * 1000)
        response = await request.get(url)
      }
    }
    expect(response.status(), category.id).toBe(200)
    const metadata = filtersResponseSchema.parse(await response.json())
    expect(metadata.category).toBe(category.id)
    const definitions = getUiFilters(category.id, metadata)
    expect(definitions.length, category.id).toBeGreaterThanOrEqual(category.id === 'os' ? 0 : 1)
  }
  await delay(3500)
  const response = await request.post(`${CATALOG_BASE_URL}/v1/search`, {
    data: { category: 'monitor', ranges: { resolution_height: { min: 1080, max: 1200 } }, limit: 20 },
  })
  expect(response.status()).toBe(200)
  const result = searchResponseSchema.parse(await response.json())
  expect(result.data.length).toBeGreaterThan(0)
  for (const product of result.data) {
    expect(product.category).toBe('monitor')
    if (product.category === 'monitor') {
      expect(product.specs.resolution_height).toBeGreaterThanOrEqual(1080)
      expect(product.specs.resolution_height).toBeLessThanOrEqual(1200)
    }
  }
})

test('production filters in browser: typed POST, matching products, mobile layout and session restore', async ({ page }, testInfo) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'CPUを選択', exact: true }).click()
  await expect(page.locator('summary[aria-label="ソケットを選択"]')).toBeVisible()
  await delay(3500)
  await page.locator('summary[aria-label="ソケットを選択"]').click()
  const filtered = page.waitForResponse((response) => response.request().method() === 'POST'
    && new URL(response.url()).pathname === '/v1/search')
  await page.getByRole('checkbox', { name: 'AM5', exact: true }).check()
  const response = await filtered
  expect(response.status()).toBe(200)
  expect(response.request().postDataJSON()).toMatchObject({ filters: { socket: ['AM5'] } })
  const result = searchResponseSchema.parse(await response.json())
  expect(result.data.length).toBeGreaterThan(0)
  expect(result.data.every((product) => product.category === 'cpu' && product.specs.socket === 'AM5')).toBe(true)
  await expect(page.locator('.search-result')).toHaveCount(result.meta.returned)
  await page.screenshot({ path: testInfo.outputPath('live-filters-desktop.png') })
  await page.getByRole('button', { name: '閉じる', exact: true }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'CPUを選択', exact: true }).click()
  await expect(page.getByRole('button', { name: 'ソケット: AM5を解除' })).toBeVisible()
  await expect(page.getByRole('complementary', { name: '検索フィルター' })).toBeHidden()
  await expect(page.locator('.search-result')).toHaveCount(result.meta.returned)
  expect(await page.getByRole('dialog').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('live-filters-mobile.png') })
})

test('production browser: CPU listing, cursor/offset next and previous, 9800x3d search/add/reload/remove', async ({ page }) => {
  const issues: string[] = []
  page.on('pageerror', (error) => issues.push(error.message))
  page.on('console', (message) => { if (['warning', 'error'].includes(message.type())) issues.push(message.text()) })
  await page.goto('/')
  await page.getByRole('button', { name: 'CPUを選択', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('status')).toContainText('CPUの製品一覧')
  const listingNames = await dialog.locator('.product-name').allTextContents()
  expect(listingNames.length).toBeGreaterThan(0)
  const listingNext = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return url.pathname === '/v1/search' && url.searchParams.has('cursor')
  })
  await dialog.getByRole('button', { name: '次へ', exact: true }).click()
  const listingResponse = await listingNext
  expect(listingResponse.status()).toBe(200)
  const listingUrl = new URL(listingResponse.url())
  expect(listingUrl.searchParams.has('offset')).toBe(false)
  expect(listingUrl.searchParams.has('q')).toBe(false)
  const listingPage = searchResponseSchema.parse(await listingResponse.json())
  expect(listingPage.meta).toMatchObject({ offset: 0, window_limit: null, next_offset: null })
  await expect(dialog.getByRole('navigation')).toContainText('2ページ')
  expect(await dialog.locator('.product-name').allTextContents()).not.toEqual(listingNames)
  await dialog.getByRole('button', { name: '前へ', exact: true }).click()
  await expect(dialog.locator('.product-name')).toHaveText(listingNames)

  await dialog.getByRole('textbox').fill('ryzen')
  await expect(dialog.getByRole('status')).toContainText('「ryzen」の検索結果')
  const keywordNames = await dialog.locator('.product-name').allTextContents()
  const keywordNext = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return url.pathname === '/v1/search' && url.searchParams.get('q') === 'ryzen' && url.searchParams.get('offset') === '20'
  })
  await dialog.getByRole('button', { name: '次へ', exact: true }).click()
  const keywordResponse = await keywordNext
  expect(keywordResponse.status()).toBe(200)
  expect(new URL(keywordResponse.url()).searchParams.has('cursor')).toBe(false)
  expect(searchResponseSchema.parse(await keywordResponse.json()).meta).toMatchObject({ offset: 20, window_limit: 1000, next_cursor: null })
  await expect(dialog.getByRole('navigation')).toContainText('2ページ')
  expect(await dialog.locator('.product-name').allTextContents()).not.toEqual(keywordNames)
  await dialog.getByRole('button', { name: '前へ', exact: true }).click()
  await expect(dialog.locator('.product-name')).toHaveText(keywordNames)

  await page.getByRole('textbox', { name: '製品名・型番で検索' }).fill('9800x3d')
  const productName = 'AMD Ryzen 7 9800X3D'
  await expect(page.getByRole('dialog').getByText(productName, { exact: true })).toBeVisible()
  await expect(page.getByRole('dialog').getByText('AM5 / 8コア / 16スレッド')).toBeVisible()
  await page.getByRole('button', { name: `${productName}を構成に追加`, exact: true }).click()
  await page.reload()
  await expect(page.getByRole('region', { name: '構成パーツ' }).getByText(productName, { exact: true })).toBeVisible()
  await page.getByRole('button', { name: `${productName}を構成から削除` }).click()
  await page.reload()
  await expect(page.locator('.summary-count strong')).toHaveText('0')
  expect(issues).toEqual([])
})
