import { expect, test, type Page } from '@playwright/test'
import fixture from '../src/test/fixtures/cpu-search.json' with { type: 'json' }
import { partCategories } from '../src/domain/categories'

const api = 'https://pc-parts-catalog.kikuuuty.workers.dev'
const productName = fixture.data[0].name

async function mockCatalog(page: Page) {
  await page.route(`${api}/v1/categories`, (route) => route.fulfill({ json: { categories: partCategories.map(({ id }) => id) } }))
  await page.route(`${api}/v1/search?**`, (route) => {
    const query = new URL(route.request().url()).searchParams.get('q')
    return route.fulfill({ json: query === 'missing' ? { ...fixture, data: [], meta: { ...fixture.meta, returned: 0 } } : fixture })
  })
}

test.beforeEach(async ({ page }) => { await mockCatalog(page) })

test('9 categories, real build actions, persistence, reset and responsive layout', async ({ page }, testInfo) => {
  const issues: string[] = []
  page.on('pageerror', (error) => issues.push(error.message))
  page.on('console', (message) => { if (['warning', 'error'].includes(message.type())) issues.push(message.text()) })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '自作PC構成シート', exact: true })).toBeVisible()
  const sheet = page.getByRole('region', { name: '構成パーツ' })
  for (const category of partCategories) await expect(sheet.getByRole('heading', { name: category.label, exact: true })).toBeVisible()
  await expect(page.locator('.search-result')).toHaveCount(0)
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', await page.evaluate(() => window.innerWidth))
  await page.screenshot({ path: testInfo.outputPath('sheet-empty.png'), fullPage: true })

  await page.getByRole('button', { name: 'CPUを選択', exact: true }).click()
  const input = page.getByRole('textbox', { name: '製品名・型番で検索' })
  await expect(input).toBeFocused()
  await input.fill('9800x3d')
  await expect(page.getByRole('dialog').getByText(productName, { exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('search.png'), fullPage: true })
  await page.getByRole('button', { name: `${productName}を構成に追加`, exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(sheet.getByText(productName, { exact: true })).toBeVisible()
  await expect(page.locator('.summary-count strong')).toHaveText('1')
  await page.reload()
  await expect(sheet.getByText(productName, { exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'CPUを追加', exact: true }).click()
  await page.getByRole('button', { name: `${productName}を構成に追加`, exact: true }).click()
  await expect(sheet.getByText(productName, { exact: true })).toHaveCount(2)
  await sheet.getByRole('button', { name: `${productName}を構成から削除` }).first().click()
  await expect(sheet.getByText(productName, { exact: true })).toHaveCount(1)
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

test('all category drawers use the same search interaction and Escape restores focus', async ({ page }) => {
  await page.goto('/')
  for (const category of partCategories) {
    const opener = page.getByRole('button', { name: `${category.label}を選択`, exact: true })
    await opener.click()
    await expect(page.getByRole('dialog', { name: `${category.label}を選択`, exact: true })).toBeVisible()
    await expect(page.getByRole('textbox', { name: '製品名・型番で検索' })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(opener).toBeFocused()
  }
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
      : route.fulfill({ json: fixture })
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

test('closing a pending search aborts it and reopening starts with a clean search', async ({ page }) => {
  let pendingStarted = false
  const aborted: string[] = []
  page.on('requestfailed', (request) => aborted.push(request.url()))
  await page.route(`${api}/v1/search?**`, async (route) => {
    if (new URL(route.request().url()).searchParams.get('q') === 'pending') {
      pendingStarted = true
      await new Promise((resolve) => setTimeout(resolve, 1500))
    }
    await route.fulfill({ json: fixture })
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'CPUを選択', exact: true }).click()
  await page.getByRole('textbox').fill('pending')
  await expect.poll(() => pendingStarted).toBe(true)
  await page.getByRole('button', { name: '閉じる', exact: true }).click()
  await expect.poll(() => aborted.some((url) => url.includes('q=pending'))).toBe(true)
  await page.getByRole('button', { name: 'CPUを選択', exact: true }).click()
  await expect(page.getByRole('textbox')).toHaveValue('')
  await expect(page.getByRole('dialog').getByText(productName, { exact: true })).toBeVisible()
})

test('invalid persisted data gives a visible recovery message', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('pc-build-sheet:build', '{invalid'))
  await page.goto('/')
  await expect(page.getByRole('alert')).toContainText('保存済みの構成を読み込めませんでした')
  await expect(page.locator('.summary-count strong')).toHaveText('0')
  await page.getByRole('button', { name: 'CPUを選択', exact: true }).click()
  await page.getByRole('button', { name: `${productName}を構成に追加`, exact: true }).click()
  await expect(page.getByRole('alert')).toHaveCount(0)
})
