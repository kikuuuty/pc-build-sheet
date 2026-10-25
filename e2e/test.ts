import { test as base, expect } from '@playwright/test'
export { expect }
export type { Page } from '@playwright/test'

// Every normal test is offline. Unhandled external traffic is aborted and fails the
// test; legacy Catalog price traffic fails even if another route happened to mock it.
export const test = base.extend<{ networkGuard: void }>({
  networkGuard: [async ({ page, context }, use) => {
    const forbidden: string[] = []
    page.on('request', (request) => {
      const url = new URL(request.url())
      if (/\/v1\/products\/(?:offers\/summary|[^/]+\/offers)(?:$|\?)/.test(url.pathname)) forbidden.push(request.url())
    })
    await context.route('**/*', (route) => {
      const url = new URL(route.request().url())
      if (['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) && url.port !== '8788') return route.continue()
      forbidden.push(url.href)
      return route.abort('blockedbyclient')
    })
    await use()
    expect(forbidden, 'No old price API or unmocked external network is allowed').toEqual([])
  }, { auto: true }],
})
