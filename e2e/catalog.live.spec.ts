import { expect, test } from '@playwright/test'
import { searchResponseSchema } from '../src/api/catalog/schemas'
import { partCategories } from '../src/domain/categories'

test('production API: all nine category contracts and 9800x3d search/add/reload/remove', async ({ page, request }) => {
  // Explicitly opt-in via npm run test:live; ordinary tests do not depend on production.
  for (const category of partCategories) {
    const response = await request.get(`https://pc-parts-catalog.kikuuuty.workers.dev/v1/search?category=${category.id}&limit=20&offset=0`)
    expect(response.status(), category.id).toBe(200)
    const result = searchResponseSchema.parse(await response.json())
    expect(result.data.length, category.id).toBeGreaterThan(0)
    expect(result.data.every((product) => product.category === category.id)).toBe(true)
  }

  const issues: string[] = []
  page.on('pageerror', (error) => issues.push(error.message))
  page.on('console', (message) => { if (['warning', 'error'].includes(message.type())) issues.push(message.text()) })
  await page.goto('/')
  await page.getByRole('button', { name: 'CPUを選択', exact: true }).click()
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
