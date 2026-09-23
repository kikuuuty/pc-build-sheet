import { expect, test, type Page } from '@playwright/test'
import fixture from '../src/test/fixtures/cpu-search.json' with { type: 'json' }
import categories from '../src/test/fixtures/categories.json' with { type: 'json' }
import { powerItem, powerProduct } from '../src/test/power-products'
import type { CatalogProduct } from '../src/api/catalog/types'
import type { BuildItem } from '../src/features/build/schemas'

const api = 'https://pc-parts-catalog.kikuuuty.workers.dev'
const missingMessage = '一部のパーツは消費電力情報を取得できないため、実際の消費電力は表示値より高くなる可能性があります。'

async function seedBuild(page: Page, items: BuildItem[]) {
  await page.addInitScript((items) => {
    if (!localStorage.getItem('pc-build-sheet:build')) localStorage.setItem('pc-build-sheet:build', JSON.stringify({ version: 5, state: { items } }))
  }, items)
}

test.beforeEach(async ({ page }) => {
  await page.route(`${api}/v1/categories`, (route) => route.fulfill({ json: categories }))
  await page.route(`${api}/v1/categories/*/filters`, (route) => route.fulfill({ json: { category: new URL(route.request().url()).pathname.split('/')[3], filters: [] } }))
})

test('power updates with selections, PSU replacement, duplicate drives, price edits, reload and reset', async ({ page }, testInfo) => {
  const cpu = powerProduct('cpu', { tdp_w: 170, ppt_w: 280 })
  const gpu = powerProduct('gpu', { tdp_w: 360 })
  const psu = powerProduct('psu', { wattage: 750 })
  const largerPsu = { ...powerProduct('psu', { wattage: 800 }), name: '800W PSU', upstream_key: 'psu/larger' }
  const storage = powerProduct('storage', { storage_type: 'SSD', nvme: 1 })
  const products: CatalogProduct[] = [cpu, gpu, psu, largerPsu, storage]
  await page.route(`${api}/v1/search?**`, (route) => {
    const category = new URL(route.request().url()).searchParams.get('category')
    const data = products.filter((product) => product.category === category)
    return route.fulfill({ json: { data, meta: { ...fixture.meta, returned: data.length, limit: 20, offset: 0, has_more: false, next_offset: null, next_cursor: null, window_limit: null } } })
  })
  await page.goto('/')
  const estimated = page.locator('.summary-estimated-power')
  const recommended = page.locator('.summary-recommended-psu')
  await expect(estimated).toHaveText('―')
  await expect(recommended).toHaveCount(0)
  for (const [label, product] of [['CPU', cpu], ['GPU', gpu], ['電源', psu]] as const) {
    await page.getByRole('button', { name: `${label}を選択`, exact: true }).click()
    await page.getByRole('button', { name: `${product.name}を構成に追加`, exact: true }).click()
  }
  await expect(estimated).toHaveText('約640W')
  await expect(recommended).toHaveText('（800W以上推奨）')
  await expect(page.locator('.summary-power')).toHaveText('推定消費電力 約640W （800W以上推奨） 詳細')
  await expect(page.getByText(/選択電源容量|推奨容量を下回っています/)).toHaveCount(0)
  const labelBox = (await page.locator('.summary-power-label').boundingBox())!
  const detailBox = (await page.getByRole('button', { name: '消費電力の詳細' }).boundingBox())!
  expect(Math.abs(labelBox.y + labelBox.height / 2 - detailBox.y - detailBox.height / 2)).toBeLessThan(4)
  const price = page.getByRole('region', { name: 'CPU', exact: true }).getByRole('textbox')
  await price.fill('32800')
  await price.press('Enter')
  await expect(page.locator('.summary-total dd')).toHaveText('￥32,800')
  await expect(estimated).toHaveText('約640W')
  await page.getByRole('button', { name: `${psu.name}を変更`, exact: true }).click()
  await page.getByRole('button', { name: `${largerPsu.name}に置き換える`, exact: true }).click()
  await expect(estimated).toHaveText('約640W')
  await expect(recommended).toHaveText('（800W以上推奨）')

  for (const action of ['選択', '追加']) {
    await page.getByRole('button', { name: `ストレージを${action}`, exact: true }).click()
    await page.getByRole('button', { name: `${storage.name}を構成に追加`, exact: true }).click()
  }
  await expect(estimated).toHaveText('約656W')
  await expect(recommended).toHaveText('（850W以上推奨）')
  await page.reload()
  await expect(estimated).toHaveText('約656W')
  await expect(recommended).toHaveText('（850W以上推奨）')
  await expect(page.locator('.summary-total dd')).toHaveText('￥32,800')
  await expect(price).toHaveValue('32800')
  const summary = page.getByRole('complementary', { name: '構成サマリー' })
  await summary.screenshot({ path: testInfo.outputPath('power-summary.png') })
  await page.getByRole('button', { name: '消費電力の詳細' }).click()
  const dialog = page.getByRole('dialog', { name: '消費電力の計算について' })
  await expect(dialog.getByRole('row', { name: 'CPU PPTを優先し、なければTDPを使用 280W', exact: true })).toBeVisible()
  await expect(dialog.getByRole('row', { name: 'GPU TDPを使用 360W', exact: true })).toBeVisible()
  await expect(dialog.getByRole('row', { name: /ストレージ.*16W$/ })).toBeVisible()
  await expect(dialog.getByRole('row', { name: '推定消費電力の合計 約656W', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: `${gpu.name}を構成から削除`, exact: true }).click()
  await expect(estimated).toHaveText('約296W')
  await expect(recommended).toHaveText('（450W以上推奨）')
  await page.getByRole('button', { name: '構成をリセット', exact: true }).click()
  await page.getByRole('button', { name: 'リセットする', exact: true }).click()
  await expect(estimated).toHaveText('―')
  await expect(recommended).toHaveCount(0)
})

test('missing information is marked inline and explained only in details', async ({ page }) => {
  const cpu = powerProduct('cpu', { tdp_w: 170 })
  const gpu = powerProduct('gpu')
  const psu = { ...powerProduct('psu'), name: 'PSU named 1200W with unknown specs' }
  await seedBuild(page, [powerItem(cpu), powerItem(gpu), powerItem(psu), powerItem(powerProduct('motherboard'))])
  await page.goto('/')
  await expect(page.locator('.summary-estimated-power')).toHaveText('約220W※')
  await expect(page.locator('.summary-recommended-psu')).toHaveText('（450W以上推奨）')
  await expect(page.getByText(missingMessage, { exact: false })).toHaveCount(0)
  await page.setViewportSize({ width: 320, height: 900 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect(await page.locator('.summary-power').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  await page.getByRole('button', { name: '消費電力の詳細' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText(missingMessage, { exact: false })).toHaveCount(1)
  await expect(dialog.getByRole('list', { name: '電力情報が不足しているパーツ' })).toHaveText('GPU：Power test gpu')
  await dialog.getByRole('list').scrollIntoViewIfNeeded()
  await expect(dialog.getByText(missingMessage, { exact: false })).toBeVisible()
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  expect(await dialog.getByRole('region').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: `${cpu.name}を構成から削除`, exact: true }).click()
  await expect(page.locator('.summary-estimated-power')).toHaveText('約50W※')
  await expect(page.locator('.summary-recommended-psu')).toHaveCount(0)
  await page.getByRole('button', { name: `${gpu.name}を構成から削除`, exact: true }).click()
  await expect(page.locator('.summary-estimated-power')).toHaveText('約50W')
})

test('display rounds watts but recommendations use the unrounded value, even above 2000W', async ({ page }) => {
  await seedBuild(page, [powerItem(powerProduct('cpu', { ppt_w: 1600.1 })), powerItem(powerProduct('psu', { wattage: 2000 }))])
  await page.goto('/')
  await expect(page.locator('.summary-estimated-power')).toHaveText('約1600W')
  await expect(page.locator('.summary-recommended-psu')).toHaveText('（2001W以上推奨）')
  await expect(page.getByText(/推奨容量を下回っています/)).toHaveCount(0)
  await page.setViewportSize({ width: 320, height: 900 })
  expect(await page.locator('.summary-power').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  const powerBox = (await page.locator('.summary-power > [role="status"]').boundingBox())!
  const buttonBox = (await page.getByRole('button', { name: '消費電力の詳細' }).boundingBox())!
  expect(buttonBox.x).toBeGreaterThanOrEqual(powerBox.x + powerBox.width)
  expect(Math.abs(buttonBox.y + buttonBox.height / 2 - powerBox.y - powerBox.height / 2)).toBeLessThan(1)
})

test('legacy PSU rows have no summary capacity or warning and peripherals alone have no estimate', async ({ page }) => {
  await seedBuild(page, [
    powerItem(powerProduct('cpu', { tdp_w: 640 })), powerItem(powerProduct('psu', { wattage: 450 }), 'psu-a'),
    powerItem({ ...powerProduct('psu', { wattage: 850 }), name: 'Larger PSU' }, 'psu-b'), powerItem(powerProduct('monitor')),
  ])
  await page.goto('/')
  await expect(page.locator('.summary-power')).toHaveText('推定消費電力 約640W （800W以上推奨） 詳細')
  await expect(page.getByText(/選択電源容量|推奨容量を下回っています/)).toHaveCount(0)
  await page.getByRole('button', { name: 'Power test cpuを構成から削除', exact: true }).click()
  await expect(page.locator('.summary-estimated-power')).toHaveText('―')
  await expect(page.locator('.summary-recommended-psu')).toHaveCount(0)
})

test('details explain the formula, scroll within the viewport, and restore keyboard focus on every close path', async ({ page }, testInfo) => {
  await page.goto('/')
  const opener = page.getByRole('button', { name: '消費電力の詳細' })
  await opener.focus()
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog', { name: '消費電力の計算について' })
  const content = dialog.getByRole('region', { name: '計算方法と内訳' })
  const close = dialog.getByRole('button', { name: '閉じる' })
  await expect(dialog).toBeVisible()
  await expect(close).toBeFocused()
  await expect(dialog.getByText('推定消費電力の合計 × 1.25（25%の余裕）', { exact: false })).toHaveCount(1)
  await expect(dialog.getByText('2000Wを超える場合は計算値を整数Wへ切り上げます。', { exact: false })).toHaveCount(1)
  await expect(dialog.getByRole('row', { name: '推定消費電力の合計 ―', exact: true })).toHaveCount(1)
  await page.keyboard.press('Tab')
  await expect(content).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(close).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(content).toBeFocused()
  for (const viewport of [{ width: 1280, height: 960 }, { width: 320, height: 568 }, { width: 740, height: 360 }]) {
    await page.setViewportSize(viewport)
    const box = (await dialog.boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(16)
    expect(box.y).toBeGreaterThanOrEqual(16)
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width - 16)
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height - 16)
    expect(await content.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
    await content.evaluate((element) => { element.scrollTop = element.scrollHeight })
    await expect(dialog.getByRole('heading', { name: '電力情報が不足している場合' })).toBeInViewport()
    await expect(close).toBeInViewport()
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await content.evaluate((element) => { element.scrollTop = 0 })
  await dialog.screenshot({ path: testInfo.outputPath('power-details.png') })
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(opener).toBeFocused()
  await opener.click()
  await close.click()
  await expect(opener).toBeFocused()
  await opener.click()
  await page.mouse.click(2, 2)
  await expect(dialog).toHaveCount(0)
  await expect(opener).toBeFocused()
})
