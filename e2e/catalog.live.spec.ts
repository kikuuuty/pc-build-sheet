import { expect, test } from '@playwright/test'
import { categoriesResponseSchema, searchResponseSchema } from '../src/api/catalog/schemas'
import { partCategories } from '../src/domain/categories'
import { CATALOG_BASE_URL } from '../src/api/catalog/client'

test('production API: categories and all nine product contracts', async ({ request }) => {
  // Explicitly opt-in via npm run test:live; ordinary tests do not depend on production.
  const categoriesResponse = await request.get(`${CATALOG_BASE_URL}/v1/categories`)
  expect(categoriesResponse.status()).toBe(200)
  const { categories } = categoriesResponseSchema.parse(await categoriesResponse.json())
  expect(categories.length).toBeGreaterThanOrEqual(30)
  for (const category of partCategories) {
    expect(categories).toContain(category.id)
    const response = await request.get(`${CATALOG_BASE_URL}/v1/search?category=${category.id}&limit=20`)
    expect(response.status(), category.id).toBe(200)
    const result = searchResponseSchema.parse(await response.json())
    expect(result.data.length, category.id).toBeGreaterThan(0)
    expect(result.data.every((product) => product.category === category.id)).toBe(true)
    expect(result.meta).toMatchObject({ offset: 0, next_offset: null, window_limit: null, window_exhausted: false })
  }
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
