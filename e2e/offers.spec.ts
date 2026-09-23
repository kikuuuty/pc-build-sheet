import { expect, test, type Page } from '@playwright/test'
import fixture from '../src/test/fixtures/cpu-search.json' with { type: 'json' }
import { offer, offersResponse } from '../src/test/offer-fixtures'

const api = 'https://pc-parts-catalog.kikuuuty.workers.dev'
const product = fixture.data[0]
const replacement = { ...product, id: 999, name: 'AMD Ryzen 7 9700X', upstream_key: 'CPU/replacement' }
const summaryUrl = `${api}/v1/products/offers/summary`
const offerUrl = `${api}/v1/products/*/offers`
const storageKey = 'pc-build-sheet:build'
const compare = (page: Page) => page.getByRole('button', { name: `${product.name}の販売店を比較`, exact: true })
const price = (page: Page) => page.getByRole('textbox', { name: `価格：${product.name}（円）`, exact: true })

function summary(id = product.id, lowest_price: number | null = 57629) {
  return { id, status: 'complete', lowest_price, offer_count: lowest_price === null ? 0 : 28 }
}

async function seed(page: Page, items: unknown[] = [{ id: 'cpu', kind: 'catalog', category: 'cpu', product, price: 57629 }]) {
  await page.addInitScript(({ key, items }) => {
    localStorage.setItem(key, JSON.stringify({ version: 5, state: { items } }))
  }, { key: storageKey, items })
}

test.beforeEach(async ({ page }) => {
  // All network boundaries, including offers, are mocked. No Yahoo request in these tests.
  await page.route(`${api}/**`, (route) => route.fulfill({ status: 404, json: {} }))
  await page.route(`${api}/v1/categories`, (route) => route.fulfill({ json: { categories: ['cpu'] } }))
  await page.route(`${api}/v1/categories/cpu/filters`, (route) => route.fulfill({ json: { category: 'cpu', filters: [] } }))
  await page.route(`${api}/v1/search?**`, (route) => route.fulfill({ json: fixture }))
  await page.route(summaryUrl, (route) => route.fulfill({ json: { products: route.request().postDataJSON().product_ids.map((id: number) => summary(id)) } }))
  await page.route(offerUrl, (route) => route.fulfill({ json: offersResponse() }))
})

test('bulk prices show yen-from, copy on selection/replace only, and never fan out for 20 results', async ({ page }) => {
  let bulkCalls = 0, offerCalls = 0
  const products = Array.from({ length: 20 }, (_, i) => i === 0 ? product : { ...product, id: 500 + i, name: `CPU ${i}`, upstream_key: `CPU/${i}` })
  await page.route(`${api}/v1/search?**`, (route) => route.fulfill({ json: { ...fixture, data: products, meta: { ...fixture.meta, returned: 20 } } }))
  await page.route(summaryUrl, async (route) => {
    bulkCalls++
    expect(route.request().method()).toBe('POST')
    const ids: number[] = route.request().postDataJSON().product_ids
    await route.fulfill({ json: { products: ids.map((id) => summary(id, id === 999 ? 42800 : 57629)) } })
  })
  await page.route(offerUrl, async (route) => {
    offerCalls++
    await route.fulfill({ json: offersResponse(product.id, [offer({ price: offerCalls === 1 ? 56000 : 55000 })]) })
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'CPUを選択', exact: true }).click()
  await expect(page.locator('.search-result')).toHaveCount(20)
  await expect(page.locator('.search-result').first().getByText('57,629円から', { exact: true })).toBeAttached()
  await expect(page.locator('.search-price [aria-hidden]').first()).toHaveText('￥57,629～')
  expect(bulkCalls).toBe(1)
  expect(offerCalls).toBe(0)
  await page.getByRole('button', { name: `${product.name}を構成に追加`, exact: true }).click()
  await expect(price(page)).toHaveValue('57629')
  await price(page).fill('59980')
  await price(page).press('Enter')
  await compare(page).click()
  await expect(page.locator('.offer-row')).toHaveCount(1)
  await expect(page.locator('.offer-price')).toHaveText('￥56,000')
  await expect(price(page)).toHaveValue('59980')
  await page.getByRole('button', { name: '価格情報を更新', exact: true }).click()
  await expect(page.locator('.offer-price')).toHaveText('￥55,000')
  await expect(price(page)).toHaveValue('59980')
  await page.keyboard.press('Escape')
  await page.route(`${api}/v1/search?**`, (route) => route.fulfill({ json: { ...fixture, data: [replacement] } }))
  await page.getByRole('button', { name: `${product.name}を変更`, exact: true }).click()
  await page.getByRole('textbox', { name: '製品名・型番で検索' }).fill('9700X')
  await expect(page.getByText('42,800円から', { exact: true })).toBeAttached()
  await page.getByRole('button', { name: `${replacement.name}に置き換える`, exact: true }).click()
  await expect(page.getByRole('textbox', { name: `価格：${replacement.name}（円）` })).toHaveValue('42800')
  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), storageKey)
  expect(saved.version).toBe(5)
  expect(saved.state.items[0].price).toBe(42800)
  expect(Object.keys(saved.state.items[0]).sort()).toEqual(['category', 'id', 'kind', 'price', 'product'])
  expect(JSON.stringify(saved)).not.toMatch(/seller|shipping|fetched_at|offers/)
})

test('pending summary does not block products or selection and a late response never sets the build price', async ({ page }) => {
  let release!: () => void
  const held = new Promise<void>((resolve) => { release = resolve })
  await page.route(summaryUrl, async (route) => { await held; await route.fulfill({ json: { products: [summary()] } }) })
  await page.goto('/')
  await page.getByRole('button', { name: 'CPUを選択', exact: true }).click()
  await expect(page.getByText('価格取得中…', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: `${product.name}を構成に追加`, exact: true }).click()
  release()
  await expect(price(page)).toHaveValue('')
  await compare(page).click()
  await expect(page.locator('.offer-row')).toHaveCount(1)
  await expect(price(page)).toHaveValue('')
})

test('summary errors and unsupported/empty summaries allow selecting unpriced products', async ({ page }) => {
  for (const mode of ['error', 'unsupported', 'empty'] as const) {
    await page.route(summaryUrl, (route) => mode === 'error'
      ? route.fulfill({ status: 503, headers: { 'Retry-After': '61' }, json: {} })
      : route.fulfill({ json: { products: [{ ...summary(product.id, null), status: mode === 'unsupported' ? 'unsupported' : 'complete' }] } }))
    await page.goto('/')
    await page.getByRole('button', { name: 'CPUを選択', exact: true }).click()
    await expect(page.getByText(mode === 'error' ? '価格取得失敗' : '価格情報なし', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: `${product.name}を構成に追加`, exact: true }).click()
    await expect(price(page)).toHaveValue('')
    await page.getByRole('button', { name: `${product.name}を構成から削除`, exact: true }).click()
  }
})

test('new page and keyword never show the preceding product price while their summaries load', async ({ page }) => {
  await page.route(`${api}/v1/search?**`, (route) => {
    const params = new URL(route.request().url()).searchParams
    const next = params.has('cursor') || params.has('q')
    return route.fulfill({ json: { ...fixture, data: [next ? replacement : product], meta: { ...fixture.meta, next_cursor: next ? null : 'next' } } })
  })
  let release!: () => void
  const held = new Promise<void>((resolve) => { release = resolve })
  await page.route(summaryUrl, async (route) => {
    const next = route.request().postDataJSON().product_ids[0] === replacement.id
    if (next) await held
    await route.fulfill({ json: { products: [next ? summary(999, 42800) : summary()] } })
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'CPUを選択', exact: true }).click()
  await expect(page.getByText('57,629円から', { exact: true })).toBeAttached()
  await page.getByRole('button', { name: '次へ', exact: true }).click()
  await expect(page.getByText(replacement.name, { exact: true })).toBeVisible()
  await expect(page.getByText('57,629円から', { exact: true })).toHaveCount(0)
  await expect(page.getByText('価格取得中…')).toBeVisible()
  release()
  await expect(page.getByText('42,800円から', { exact: true })).toBeAttached()
  await page.getByRole('button', { name: '前へ', exact: true }).click()
  await expect(page.getByText('57,629円から', { exact: true })).toBeAttached()
  await page.getByRole('textbox', { name: '製品名・型番で検索' }).fill('9700X')
  await expect(page.getByText(replacement.name, { exact: true })).toBeVisible()
  await expect(page.getByText('42,800円から', { exact: true })).toBeAttached()
  await expect(page.getByText('57,629円から', { exact: true })).toHaveCount(0)
})

test('comparison sorts all sellers, shows shipping/tied lowest/link semantics and fits a scrollable viewport', async ({ page }, testInfo) => {
  await seed(page)
  const offers = Array.from({ length: 28 }, (_, i) => offer({ provider_item_id: `item-${i}`, price: i < 2 ? 57629 : 57629 + i,
    seller: { ...offer().seller, id: `shop-${i}`, name: `ショップ ${i}` }, shipping: i === 2 ? null : { code: 2, name: '送料無料' },
    url: `https://store.shopping.yahoo.co.jp/shop/item-${i}.html` })).reverse()
  await page.route(offerUrl, (route) => route.fulfill({ json: offersResponse(product.id, offers) }))
  await page.goto('/')
  const row = page.locator('.build-item')
  expect(await row.evaluate((el) => Array.from(el.children).map((child) => child.className))).toEqual(['product-selector', 'price-field', 'icon-button offer-button', 'icon-button remove-button'])
  await compare(page).click()
  const panel = page.getByRole('dialog', { name: product.name, exact: true })
  await expect(panel).toBeFocused()
  await expect(panel.getByText('価格比較 28件', { exact: true })).toBeVisible()
  await expect(panel.locator('.offer-row')).toHaveCount(28)
  await expect(panel.locator('.offer-price').first()).toHaveText('￥57,629')
  await expect(panel.getByText('最安', { exact: true })).toHaveCount(2)
  await expect(panel.getByText('送料情報なし', { exact: true })).toBeVisible()
  await expect(panel.getByText('送料無料', { exact: true })).toHaveCount(27)
  const link = panel.getByRole('link', { name: 'ショップ 0の商品ページを新しいタブで開く', exact: true })
  await expect(link).toHaveAttribute('href', 'https://store.shopping.yahoo.co.jp/shop/item-0.html')
  await expect(link).toHaveAttribute('target', '_blank')
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  await expect(row.getByRole('link')).toHaveCount(0)
  await expect(panel.locator('img')).toHaveCount(0)
  expect(await panel.locator('.offer-content').evaluate((el) => el.scrollHeight > el.clientHeight && getComputedStyle(el).overscrollBehaviorY === 'contain')).toBe(true)
  for (const width of testInfo.project.name === 'mobile' ? [393, 320] : [1280]) {
    await page.setViewportSize({ width, height: 700 })
    await expect(async () => {
      const box = (await panel.boundingBox())!
      expect(box.x).toBeGreaterThanOrEqual(11)
      expect(box.x + box.width).toBeLessThanOrEqual(width - 11)
      expect(box.y).toBeGreaterThanOrEqual(11)
      expect(box.y + box.height).toBeLessThanOrEqual(689)
      expect(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
      const selection = (await panel.locator('.offer-select').first().boundingBox())!
      const externalLink = (await panel.getByRole('link').first().boundingBox())!
      expect(selection.height).toBeGreaterThanOrEqual(44)
      expect(selection.x + selection.width).toBeLessThanOrEqual(externalLink.x)
    }).toPass()
    if (width <= 800) {
      for (const control of [compare(page), row.locator('.remove-button')]) {
        const box = (await control.boundingBox())!
        expect(box.width).toBeGreaterThanOrEqual(44)
        expect(box.height).toBeGreaterThanOrEqual(44)
      }
    }
  }
  await page.screenshot({ path: testInfo.outputPath('price-comparison.png') })
  await page.keyboard.press('Escape')
  await expect(panel).toHaveCount(0)
  await expect(compare(page)).toBeFocused()
  await compare(page).click()
  await compare(page).click()
  await expect(panel).toHaveCount(0)
  await compare(page).click()
  await page.mouse.click(4, 4)
  await expect(panel).toHaveCount(0)
  await compare(page).click()
  await page.getByRole('button', { name: '価格比較を閉じる' }).click()
  await expect(compare(page)).toBeFocused()
  await compare(page).press('Enter')
  await page.keyboard.press('Shift+Tab')
  await expect(panel).toHaveCount(0)
  await expect(compare(page)).toBeFocused()
  await compare(page).press('Enter')
  await panel.getByRole('button', { name: '価格情報を更新', exact: true }).focus()
  await page.keyboard.press('Tab')
  await expect(panel).toHaveCount(0)
  await expect(row.locator('.remove-button')).toBeFocused()
  await page.getByRole('button', { name: `${product.name}を変更`, exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'CPUを変更', exact: true })).toBeVisible()
  await expect(page.locator('.offer-popover')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: `${product.name}を構成から削除`, exact: true }).click()
  await expect(page.locator('.offer-popover')).toHaveCount(0)
})

test('offers are lazy and share one cache across duplicate build rows and panels; custom rows never fetch', async ({ page }) => {
  let calls = 0
  await seed(page, [
    { id: 'a', kind: 'catalog', category: 'cpu', product, price: null },
    { id: 'b', kind: 'catalog', category: 'cpu', product, price: 59980 },
    { id: 'c', kind: 'custom', name: '手入力ケーブル', price: 1000 },
  ])
  await page.route(offerUrl, async (route) => { calls++; await route.fulfill({ json: offersResponse() }) })
  await page.goto('/')
  await expect(page.locator('.build-item')).toHaveCount(3)
  expect(calls).toBe(0)
  await expect(page.locator('.build-item').last().locator('.offer-button')).toHaveCount(0)
  await compare(page).first().click()
  await expect(page.locator('.offer-row')).toHaveCount(1)
  await page.keyboard.press('Escape')
  await compare(page).nth(1).click()
  await expect(page.locator('.offer-row')).toHaveCount(1)
  expect(calls).toBe(1)
  await page.keyboard.press('Escape')
  await expect(price(page).first()).toHaveValue('')
  await expect(price(page).nth(1)).toHaveValue('59980')
  await expect(page.locator('.build-item').last().getByRole('textbox')).toHaveValue('1000')
})

test('using an offer fills only the chosen row, clears invalid drafts, persists and remains manually editable', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(({ key, product }) => localStorage.setItem(key, JSON.stringify({ version: 5, state: { items: [
    { id: 'a', kind: 'catalog', category: 'cpu', product, price: 70000 },
    { id: 'b', kind: 'catalog', category: 'cpu', product, price: null },
    { id: 'c', kind: 'custom', name: 'ケーブル', price: 1000 },
  ] } })), { key: storageKey, product })
  await page.reload()
  const selectedPrice = price(page).nth(1)
  await expect(selectedPrice).toHaveValue('')
  await compare(page).nth(1).click()
  await expect(page.getByText('この価格を使用', { exact: true })).toHaveCount(0)
  await page.locator('.offer-select').getByText('ツクモ パソコン Yahoo!店', { exact: true }).click()
  await expect(page.locator('.offer-popover')).toHaveCount(0)
  await expect(compare(page).nth(1)).toBeFocused()
  await expect(selectedPrice).toHaveValue('59980')
  await expect(price(page).first()).toHaveValue('70000')
  await expect(page.getByRole('textbox', { name: '価格：ケーブル（円）' })).toHaveValue('1000')
  await expect(page.getByRole('status').filter({ hasText: `${product.name}の価格を￥59,980に変更しました` })).toHaveCount(1)
  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), storageKey)
  expect(saved.version).toBe(5)
  expect(saved.state.items[1].price).toBe(59980)
  expect(Object.keys(saved.state.items[1]).sort()).toEqual(['category', 'id', 'kind', 'price', 'product'])
  expect(JSON.stringify(saved)).not.toMatch(/seller|shipping|fetched_at|offers/)
  await page.reload()
  await expect(selectedPrice).toHaveValue('59980')

  // Even selecting the same committed value must replace an invalid editor draft.
  await selectedPrice.fill('invalid price')
  await selectedPrice.press('Enter')
  await expect(selectedPrice).toHaveAttribute('aria-invalid', 'true')
  await compare(page).nth(1).click()
  const usePrice = page.getByRole('button', { name: 'ツクモ パソコン Yahoo!店の59,980円を構成価格に使用', exact: true })
  await usePrice.focus()
  await page.keyboard.press('Enter')
  await expect(selectedPrice).toHaveValue('59980')
  await expect(selectedPrice).toHaveAttribute('aria-invalid', 'false')
  await expect(page.locator('.field-error')).toHaveCount(0)
  await expect(compare(page).nth(1)).toBeFocused()

  await selectedPrice.fill('61000')
  await selectedPrice.press('Enter')
  await page.route(offerUrl, (route) => route.fulfill({ json: offersResponse(product.id, [offer({ price: 55000 })]) }))
  await compare(page).nth(1).click()
  await page.getByRole('button', { name: '価格情報を更新', exact: true }).click()
  await expect(page.locator('.offer-price')).toHaveText('￥55,000')
  await expect(selectedPrice).toHaveValue('61000')
  await page.keyboard.press('Escape')
  await page.reload()
  await expect(selectedPrice).toHaveValue('61000')
})

test('external purchase links do not apply prices, and offers beyond the editor limit cannot be applied', async ({ page, context }) => {
  await seed(page)
  await page.route(offerUrl, (route) => route.fulfill({ json: offersResponse(product.id, [offer(), offer({ provider_item_id: 'over-limit', price: 100_000_001 })]) }))
  await context.route('https://store.shopping.yahoo.co.jp/**', (route) => route.fulfill({ contentType: 'text/html', body: '<title>Shop</title>' }))
  await page.goto('/')
  await compare(page).click()
  await expect(page.getByRole('button', { name: 'ツクモ パソコン Yahoo!店の100,000,001円を構成価格に使用', exact: true })).toBeDisabled()
  const popupPromise = page.waitForEvent('popup')
  await page.getByRole('link', { name: 'ツクモ パソコン Yahoo!店の商品ページを新しいタブで開く', exact: true }).first().click()
  const popup = await popupPromise
  await popup.waitForLoadState()
  await popup.close()
  await expect(price(page)).toHaveValue('57629')
  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), storageKey)
  expect(saved.state.items[0].price).toBe(57629)
})

test('429/502/503 errors stay in the popover and can be retried; empty and unsupported states are readable', async ({ page }) => {
  await seed(page)
  for (const status of [429, 502, 503]) {
    await page.route(offerUrl, (route) => route.fulfill({ status, headers: { 'Retry-After': '61' }, json: {} }))
    await page.goto('/')
    await compare(page).click()
    await expect(page.getByText('価格情報を取得できませんでした。', { exact: true })).toBeVisible()
    await expect(page.locator('.remove-button')).toBeEnabled()
    await expect(price(page)).toHaveValue('57629')
    await page.route(offerUrl, (route) => route.fulfill({ json: offersResponse(product.id, []) }))
    await page.getByRole('button', { name: '再試行', exact: true }).click()
    await expect(page.getByText('販売店情報がありません', { exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(compare(page)).toHaveAttribute('title', '販売店情報がありません')
  }
  await page.route(offerUrl, (route) => route.fulfill({ json: { ...offersResponse(product.id, []), lookup: { status: 'unsupported', strategy: null, reason: 'no_supported_identifier' } } }))
  await page.goto('/')
  await compare(page).click()
  await expect(page.getByText('販売店情報がありません', { exact: true })).toBeVisible()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: '価格比較を閉じる', exact: true })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(compare(page)).toBeFocused()
})
