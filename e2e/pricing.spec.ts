import { expect, test, type Page } from './test'
import fixture from '../src/test/fixtures/cpu-search.json' with { type: 'json' }
import { pricingResponse } from '../src/test/pricing-fixtures'
import type { ProductRef } from '../src/api/pricing/schemas'

const catalog = 'https://pc-parts-catalog.kikuuuty.workers.dev'
const summaryUrl = 'http://127.0.0.1:8788/v1/prices/summary'
const product = fixture.data[0]
const replacement = { ...product, id: product.id, name: 'Replacement CPU', upstream_key: 'CPU/replacement' }
const storageKey = 'pc-build-sheet:build'
const check = (page: Page) => page.getByRole('button', { name: `${product.name}の参考価格を確認`, exact: true })
const price = (page: Page) => page.getByRole('textbox', { name: `価格：${product.name}（円）`, exact: true })
const panel = (page: Page) => page.getByRole('dialog', { name: product.name, exact: true })
async function search(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'CPUを選択', exact: true }).click()
}
async function seed(page: Page, items: unknown[] = [{ id: 'cpu', kind: 'catalog', category: 'cpu', product, price: 0 }]) {
  await page.addInitScript(({ key, items }) => {
    if (sessionStorage.getItem('pricing-test:seeded')) return
    localStorage.setItem(key, JSON.stringify({ version: 5, state: { items } }))
    sessionStorage.setItem('pricing-test:seeded', 'true')
  }, { key: storageKey, items })
}

test.beforeEach(async ({ page }) => {
  await page.route(`${catalog}/**`, (route) => route.fulfill({ status: 404, json: {} }))
  await page.route(`${catalog}/v1/categories`, (route) => route.fulfill({ json: { categories: ['cpu'] } }))
  await page.route(`${catalog}/v1/categories/cpu/filters`, (route) => route.fulfill({ json: { category: 'cpu', filters: [] } }))
  await page.route(`${catalog}/v1/search?**`, (route) => route.fulfill({ json: fixture }))
  await page.route(summaryUrl, (route) => route.fulfill({ json: pricingResponse(route.request().postDataJSON().products) }))
  page.on('request', (request) => {
    if (request.url() !== summaryUrl) return
    expect(request.method()).toBe('POST')
    expect(Object.keys(request.postDataJSON())).toEqual(['products'])
    for (const ref of request.postDataJSON().products) expect(Object.keys(ref).sort()).toEqual(['source', 'upstream_key'])
  })
})

test('one bulk for 20 visible products, durable refs rather than numeric IDs, and copy only at add/replace', async ({ page }) => {
  const products = Array.from({ length: 20 }, (_, i) => i ? { ...product, id: product.id, name: `CPU ${i}`, upstream_key: `CPU/${i}` } : product)
  await page.route(`${catalog}/v1/search?**`, (route) => route.fulfill({ json: { ...fixture, data: products, meta: { ...fixture.meta, returned: 20 } } }))
  let calls = 0
  await page.route(summaryUrl, (route) => { calls++; return route.fulfill({ json: pricingResponse(route.request().postDataJSON().products) }) })
  await search(page)
  await expect(page.locator('.search-result')).toHaveCount(20)
  await expect(page.locator('.search-result').first().getByText('57,800円から', { exact: true })).toBeAttached()
  expect(calls).toBe(1)
  await page.getByRole('button', { name: `${product.name}を構成に追加`, exact: true }).click()
  await expect(price(page)).toHaveValue('57800')
  await price(page).fill('61000'); await price(page).press('Enter')
  await check(page).click()
  await expect(panel(page).getByText('この価格を適用')).toBeVisible()
  expect(calls).toBe(1) // list singleton cache reused by the lazy panel
  await expect(price(page)).toHaveValue('61000')
  await page.keyboard.press('Escape')
  await page.route(`${catalog}/v1/search?**`, (route) => route.fulfill({ json: { ...fixture, data: [replacement] } }))
  await page.route(summaryUrl, (route) => route.fulfill({ json: pricingResponse(route.request().postDataJSON().products, 'complete', { lowest_price: 42800 }) }))
  await page.getByRole('button', { name: `${product.name}を変更`, exact: true }).click()
  await page.getByRole('textbox', { name: '製品名・型番で検索' }).fill('replacement')
  await expect(page.getByText('42,800円から', { exact: true })).toBeAttached()
  await page.getByRole('button', { name: `${replacement.name}に置き換える`, exact: true }).click()
  await expect(page.getByRole('textbox', { name: `価格：${replacement.name}（円）` })).toHaveValue('42800')
})

test('search and selection do not wait for pricing; late results never fill or overwrite 0 yen', async ({ page }) => {
  await page.clock.install()
  let release!: () => void
  const held = new Promise<void>((resolve) => { release = resolve })
  await page.route(summaryUrl, async (route) => { await held; await route.fulfill({ json: pricingResponse(route.request().postDataJSON().products) }).catch(() => {}) })
  await search(page)
  await expect(page.getByText('価格を確認中', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: `${product.name}を構成に追加`, exact: true }).click()
  await expect(price(page)).toHaveValue('')
  await price(page).fill('0'); await price(page).press('Enter')
  release()
  await expect(price(page)).toHaveValue('0')
  await check(page).click()
  // The cancelled list request consumes an attempt; reopening must not bypass
  // the cancellation backoff for the same ref set.
  await page.clock.runFor(10_050)
  await expect(panel(page).getByRole('button', { name: 'この価格を適用' })).toBeEnabled()
  await expect(price(page)).toHaveValue('0')
})

test('mixed statuses follow durable refs despite duplicate numeric IDs and sorted request order', async ({ page }) => {
  const states = ['pending', 'complete', 'empty', 'unsupported', 'missing'] as const
  const products = states.map((status) => ({ ...product, name: `CPU ${status}`, upstream_key: `CPU/${status}` }))
  await page.route(`${catalog}/v1/search?**`, (route) => route.fulfill({ json: { ...fixture, data: products, meta: { ...fixture.meta, returned: products.length } } }))
  await page.route(summaryUrl, (route) => {
    const refs: ProductRef[] = route.request().postDataJSON().products
    return route.fulfill({ json: { ok: true, data: refs.map((ref) => pricingResponse([ref], states.find((s) => ref.upstream_key.endsWith(s))!).data[0]) } })
  })
  await search(page)
  for (const [i, text] of ['更新待ち', '57,800円から', '販売情報なし', '価格取得非対応', '製品情報を確認できません'].entries()) {
    await expect(page.locator('.search-result').nth(i).getByText(text, { exact: true })).toBeAttached()
  }
})

test('stale complete is labelled with its fetched time and can be copied, but refreshed values never change the saved price', async ({ page }) => {
  await page.clock.install()
  let calls = 0
  await page.route(summaryUrl, (route) => route.fulfill({ json: pricingResponse(route.request().postDataJSON().products, 'complete',
    ++calls === 1 ? { stale: true } : { stale: false, lowest_price: 55000 }) }))
  await search(page)
  await expect(page.locator('.search-price small')).toContainText('参考・古い結果')
  await expect(page.locator('.search-price time')).toHaveAttribute('dateTime', '2026-09-26T00:00:00.000Z')
  await page.getByRole('button', { name: `${product.name}を構成に追加`, exact: true }).click()
  await expect(price(page)).toHaveValue('57800')
  await price(page).fill('0'); await price(page).press('Enter')
  await check(page).click()
  await page.clock.runFor(10_050)
  await expect(panel(page).getByText('55,000円から', { exact: true })).toBeAttached()
  await expect(price(page)).toHaveValue('0')
  await panel(page).getByRole('button', { name: 'この価格を適用' }).click()
  await expect(price(page)).toHaveValue('55000')
})

test('stale empty remains a previous no-information result until a fresh empty stops polling', async ({ page }) => {
  await page.clock.install()
  let calls = 0
  await page.route(summaryUrl, (route) => route.fulfill({ json: pricingResponse(route.request().postDataJSON().products, 'empty', { stale: ++calls === 1 }) }))
  await search(page)
  await expect(page.locator('.search-price')).toContainText('前回は販売情報なし')
  await expect(page.locator('.search-price small')).toHaveText('再確認待ち')
  await page.clock.runFor(10_050)
  await expect(page.getByText('販売情報なし', { exact: true })).toBeVisible()
  await page.clock.runFor(60_000)
  expect(calls).toBe(2)
})

test('pending polls finitely, stops on dialog close, and remount does not reset the budget', async ({ page }) => {
  await page.clock.install()
  let calls = 0
  await page.route(summaryUrl, (route) => { calls++; return route.fulfill({ json: pricingResponse(route.request().postDataJSON().products, 'pending') }) })
  await search(page)
  await expect(page.getByText('更新待ち', { exact: true })).toBeVisible()
  await page.clock.runFor(10_010)
  await expect.poll(() => calls).toBe(2)
  await page.keyboard.press('Escape')
  await page.clock.runFor(20_000)
  expect(calls).toBe(2)
  await page.getByRole('button', { name: 'CPUを選択', exact: true }).click()
  await expect(page.getByText('更新待ち', { exact: true })).toBeVisible()
  await page.clock.runFor(330_000)
  await expect(page.getByText(/自動確認は停止しました/)).toBeVisible()
  const count = calls
  expect(count).toBeGreaterThan(2); expect(count).toBeLessThanOrEqual(12)
  await page.clock.runFor(60_000)
  expect(calls).toBe(count)
})

for (const status of ['complete', 'empty', 'unsupported', 'missing'] as const) {
  test(`pending → ${status} ends polling (stale unsupported/missing included)`, async ({ page }) => {
    await page.clock.install()
    let calls = 0
    await page.route(summaryUrl, (route) => route.fulfill({ json: pricingResponse(route.request().postDataJSON().products, ++calls === 1 ? 'pending' : status,
      { stale: status === 'unsupported' || status === 'missing' }) }))
    await search(page)
    await expect(page.getByText('更新待ち', { exact: true })).toBeVisible()
    await page.clock.runFor(10_010)
    const label = { complete: '57,800円から', empty: '販売情報なし', unsupported: '価格取得非対応', missing: '製品情報を確認できません' }[status]
    await expect(page.getByText(label, { exact: true })).toBeAttached()
    await page.clock.runFor(90_000)
    expect(calls).toBe(2)
  })
}

test('429 cooldown is shared across list and panel and cannot be bypassed by reopening', async ({ page }) => {
  await page.clock.install()
  let calls = 0
  await page.route(summaryUrl, (route) => ++calls === 1
    ? route.fulfill({ status: 429, headers: { 'Retry-After': '60' }, json: { ok: false, error: { code: 'RATE_LIMITED' } } })
    : route.fulfill({ json: pricingResponse(route.request().postDataJSON().products) }))
  await search(page)
  await expect(page.getByText('価格を取得できませんでした', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: `${product.name}を構成に追加`, exact: true }).click()
  await check(page).click()
  await expect(panel(page).getByRole('button', { name: '参考価格を再確認' })).toBeDisabled()
  await page.keyboard.press('Escape'); await check(page).click()
  await page.clock.runFor(59_000)
  expect(calls).toBe(1)
  await page.clock.runFor(2000)
  await expect(panel(page).getByRole('button', { name: 'この価格を適用' })).toBeEnabled()
  expect(calls).toBe(2)
  await expect(price(page)).toHaveValue('')
})

test('page change detaches old refs and a delayed old response cannot contaminate the new product', async ({ page }) => {
  await page.route(`${catalog}/v1/search?**`, (route) => {
    const next = new URL(route.request().url()).searchParams.has('cursor')
    return route.fulfill({ json: { ...fixture, data: [next ? replacement : product], meta: { ...fixture.meta, next_cursor: next ? null : 'next' } } })
  })
  let release!: () => void
  const held = new Promise<void>((resolve) => { release = resolve })
  await page.route(summaryUrl, async (route) => {
    const refs: ProductRef[] = route.request().postDataJSON().products
    if (refs[0].upstream_key === product.upstream_key) await held
    await route.fulfill({ json: pricingResponse(refs, 'complete', { lowest_price: refs[0].upstream_key === product.upstream_key ? 57800 : 42800 }) }).catch(() => {})
  })
  await search(page)
  await expect(page.getByText('価格を確認中', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '次へ', exact: true }).click()
  await expect(page.getByText('42,800円から', { exact: true })).toBeAttached()
  release()
  await expect(page.getByText('57,800円から', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: `${replacement.name}を構成に追加`, exact: true }).click()
  await expect(page.getByRole('textbox', { name: `価格：${replacement.name}（円）` })).toHaveValue('42800')
})

test('lazy panels share cache; explicit apply updates only the chosen row, resets invalid draft and persists v5', async ({ page }) => {
  let calls = 0
  await page.route(summaryUrl, (route) => { calls++; return route.fulfill({ json: pricingResponse(route.request().postDataJSON().products) }) })
  await seed(page, [
    { id: 'a', kind: 'catalog', category: 'cpu', product, price: 70000 },
    { id: 'b', kind: 'catalog', category: 'cpu', product, price: 0 },
    { id: 'c', kind: 'custom', name: 'ケーブル', price: null },
  ])
  await page.goto('/')
  await expect(price(page).nth(1)).toHaveValue('0')
  expect(calls).toBe(0)
  await expect(page.locator('.build-item').last().locator('.reference-price-button')).toHaveCount(0)
  await price(page).nth(1).fill('invalid'); await price(page).nth(1).press('Enter')
  await check(page).nth(1).click()
  await expect(panel(page).getByRole('button', { name: 'この価格を適用' })).toBeEnabled()
  await expect(price(page).nth(1)).toHaveValue('invalid')
  await panel(page).getByRole('button', { name: 'この価格を適用' }).click()
  await expect(check(page).nth(1)).toBeFocused()
  await expect(price(page).nth(1)).toHaveValue('57800')
  await expect(price(page).nth(1)).toHaveAttribute('aria-invalid', 'false')
  await expect(price(page).first()).toHaveValue('70000')
  await expect(page.getByRole('textbox', { name: '価格：ケーブル（円）' })).toHaveValue('')
  await expect(page.getByRole('status').filter({ hasText: `${product.name}の価格を￥57,800に変更しました` })).toHaveCount(1)
  await check(page).first().click()
  await expect(panel(page).getByRole('button', { name: 'この価格を適用' })).toBeEnabled()
  expect(calls).toBe(1)
  await expect(price(page).first()).toHaveValue('70000')
  await page.keyboard.press('Escape')
  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), storageKey)
  expect(saved.version).toBe(5)
  expect(saved.state.items.map((i: { price: number | null }) => i.price)).toEqual([70000, 57800, null])
  expect(Object.keys(saved.state.items[1]).sort()).toEqual(['category', 'id', 'kind', 'price', 'product'])
  expect(JSON.stringify(saved)).not.toMatch(/fetchedAt|expiresAt|providers|polling|summary/)
  await page.reload()
  await expect(price(page).nth(1)).toHaveValue('57800')
})

test('panel is compact and accessible: Escape, outside click, Tab, close and focus return; no purchase links', async ({ page }, info) => {
  await seed(page); await page.goto('/'); await check(page).click()
  await expect(panel(page)).toBeFocused()
  await expect(panel(page).getByText(/取得先：Yahoo/)).toBeVisible()
  await expect(panel(page).getByText(/取得日時：/)).toBeVisible()
  await expect(panel(page).getByRole('link')).toHaveCount(0)
  for (const width of info.project.name === 'mobile' ? [393, 320] : [1280]) {
    await page.setViewportSize({ width, height: 700 })
    await expect(async () => {
      const box = (await panel(page).boundingBox())!
      expect(box.x).toBeGreaterThanOrEqual(11)
      expect(box.x + box.width).toBeLessThanOrEqual(width - 11)
      expect(box.y).toBeGreaterThanOrEqual(11)
      expect(box.y + box.height).toBeLessThanOrEqual(689)
      expect(await panel(page).evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
    }).toPass()
  }
  await page.keyboard.press('Escape'); await expect(check(page)).toBeFocused()
  await check(page).click(); await page.mouse.click(4, 4); await expect(panel(page)).toHaveCount(0)
  await check(page).click(); await page.getByRole('button', { name: '参考価格を閉じる' }).click(); await expect(check(page)).toBeFocused()
  await check(page).press('Enter'); await page.keyboard.press('Shift+Tab'); await expect(panel(page)).toHaveCount(0); await expect(check(page)).toBeFocused()
  await check(page).press('Enter')
  await expect(panel(page).getByRole('button', { name: '参考価格を再確認' })).toBeEnabled()
  await panel(page).getByRole('button', { name: '参考価格を再確認' }).focus(); await page.keyboard.press('Tab')
  await expect(panel(page)).toHaveCount(0); await expect(page.locator('.remove-button')).toBeFocused()
})

test('manual recheck replaces summaries, never committed prices or drafts', async ({ page }) => {
  await seed(page); await page.goto('/'); await check(page).click()
  await expect(panel(page).getByRole('button', { name: 'この価格を適用' })).toBeEnabled()
  await page.route(summaryUrl, (route) => route.fulfill({ json: pricingResponse(route.request().postDataJSON().products, 'pending') }))
  await panel(page).getByRole('button', { name: '参考価格を再確認' }).click()
  await expect(panel(page).getByText('更新待ち', { exact: true })).toBeVisible()
  await expect(panel(page).getByRole('button', { name: 'この価格を適用' })).toHaveCount(0)
  await expect(price(page)).toHaveValue('0')
  await page.keyboard.press('Escape')
  await price(page).fill('invalid'); await price(page).press('Enter')
  await check(page).click()
  await expect(price(page)).toHaveValue('invalid')
})

test('failed recheck labels retained data as previous, and cannot apply it as a successful new lookup', async ({ page }) => {
  await seed(page); await page.goto('/'); await check(page).click()
  await expect(panel(page).getByRole('button', { name: 'この価格を適用' })).toBeEnabled()
  await page.route(summaryUrl, (route) => route.fulfill({ status: 503, headers: { 'Retry-After': '600' }, json: { ok: false, error: { code: 'PRICING_UNAVAILABLE' } } }))
  await panel(page).getByRole('button', { name: '参考価格を再確認' }).click()
  await expect(panel(page).getByRole('alert')).toHaveText('再確認に失敗しました。表示は前回の結果です。')
  await expect(panel(page).locator('.search-price small')).toContainText('前回値・再確認失敗')
  await expect(panel(page).getByRole('button', { name: 'この価格を適用' })).toBeDisabled()
  await expect(price(page)).toHaveValue('0')
})

test('panel polling stops on close; hidden/offline sessions emit no requests and resume without catch-up', async ({ page }) => {
  await page.clock.install()
  let calls = 0
  await page.route(summaryUrl, (route) => { calls++; return route.fulfill({ json: pricingResponse(route.request().postDataJSON().products, 'pending') }) })
  await seed(page); await page.goto('/'); await check(page).click()
  await expect(panel(page).getByText('更新待ち', { exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.clock.runFor(15_000)
  expect(calls).toBe(1)
  await check(page).click(); await page.clock.runFor(10)
  await expect.poll(() => calls).toBe(2)
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await page.clock.runFor(40_000)
  expect(calls).toBe(2)
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
    document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('offline'))
  })
  await page.clock.runFor(40_000)
  expect(calls).toBe(2)
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
    window.dispatchEvent(new Event('online'))
  })
  await page.clock.runFor(10)
  await expect.poll(() => calls).toBe(3)
  await expect(price(page)).toHaveValue('0')
})

test('over-limit summary does not prevent product selection and cannot be explicitly applied', async ({ page }) => {
  await page.route(summaryUrl, (route) => route.fulfill({ json: pricingResponse(route.request().postDataJSON().products, 'complete', { lowest_price: 100_000_001 }) }))
  await search(page)
  await expect(page.getByText('100,000,001円から', { exact: true })).toBeAttached()
  await page.getByRole('button', { name: `${product.name}を構成に追加`, exact: true }).click()
  await expect(price(page)).toHaveValue('')
  await check(page).click()
  await expect(panel(page).getByRole('button', { name: 'この価格を適用' })).toBeDisabled()
})

test('503 errors do not block selection or manual editing', async ({ page }) => {
  await page.route(summaryUrl, (route) => route.fulfill({ status: 503, headers: { 'Retry-After': '600' }, json: { ok: false, error: { code: 'PRICING_UNAVAILABLE' } } }))
  await search(page)
  await expect(page.getByText('価格を取得できませんでした', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: `${product.name}を構成に追加`, exact: true }).click()
  await price(page).fill('59980'); await price(page).press('Enter')
  await expect(price(page)).toHaveValue('59980')
  await check(page).click(); await expect(price(page)).toHaveValue('59980')
  await expect(panel(page).getByRole('button', { name: '参考価格を再確認' })).toBeDisabled()
})
