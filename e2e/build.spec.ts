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
  await page.screenshot({ path: testInfo.outputPath('search.png') })
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

test('all category dialogs use the same search interaction and Escape restores focus', async ({ page }) => {
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

test('wide search dialog is centered, scrolls only results and supports search, paging and addition', async ({ page }, testInfo) => {
  const pageOneProducts = Array.from({ length: 20 }, (_, index) => ({
    ...fixture.data[0],
    id: index + 1,
    upstream_key: `CPU/test-page-1-${index}`,
    name: `${productName} ${index === 0 ? 'LongProductName'.repeat(12) : `モデル ${index + 1}`}`,
  }))
  const pageTwoProduct = { ...fixture.data[0], upstream_key: 'CPU/test-page-2', name: `${productName} 最終候補` }
  const requests: { query: string | null; offset: string | null; limit: string | null }[] = []
  await page.route(`${api}/v1/search?**`, (route) => {
    const params = new URL(route.request().url()).searchParams
    const offset = Number(params.get('offset'))
    requests.push({ query: params.get('q'), offset: params.get('offset'), limit: params.get('limit') })
    return route.fulfill({ json: {
      ...fixture,
      data: offset === 0 ? pageOneProducts : [pageTwoProduct],
      meta: { ...fixture.meta, offset, returned: offset === 0 ? 20 : 1, has_more: offset === 0, next_offset: offset === 0 ? 20 : null },
    } })
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'CPUを選択', exact: true }).click()
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
  expect(requests).toContainEqual({ query: '9800x3d', offset: '20', limit: '20' })
  await previous.click()
  await expect(dialog.locator('.search-result')).toHaveCount(20)
  await next.click()
  await dialog.getByRole('button', { name: `${pageTwoProduct.name}を構成に追加`, exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('region', { name: '構成パーツ' }).getByText(pageTwoProduct.name, { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'CPUを追加', exact: true })).toBeFocused()
})

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
