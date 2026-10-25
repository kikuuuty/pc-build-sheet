import { expect, test, type Page, type TestInfo } from '@playwright/test'
import process from 'node:process'
import { mkdir, writeFile } from 'node:fs/promises'
import { captureWithRetry } from './screenshot-retry'

async function stableLayout(page: Page) {
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
  await expect.poll(() => page.evaluate(async () => {
    const dimensions = () => JSON.stringify([
      innerWidth, innerHeight, document.documentElement.clientWidth,
      document.documentElement.scrollWidth, document.documentElement.scrollHeight,
      document.body.getBoundingClientRect().width, document.body.getBoundingClientRect().height,
    ])
    await new Promise(requestAnimationFrame)
    const before = dimensions()
    await new Promise(requestAnimationFrame)
    return before === dimensions()
  }), { timeout: 5000, message: 'layout is stable across painted frames before diagnostic capture' }).toBe(true)
}

export function screenshotDiagnostics(page: Page, info: TestInfo) {
  const browser = page.context().browser()
  const events: { event: string; detail?: string; at: string }[] = []
  const attempts: Record<string, unknown>[] = []
  const record = (event: string, detail?: string) => events.push({ event, detail, at: new Date().toISOString() })
  const pageError = (error: Error) => record('pageerror', error.stack ?? error.message)
  const crash = () => record('crash')
  const close = () => record('page-close')
  const disconnect = () => record('browser-disconnected')
  page.on('pageerror', pageError); page.on('crash', crash); page.on('close', close)
  browser?.on('disconnected', disconnect)

  return {
    capture: async (name: string) => test.step(`diagnostic screenshot: ${name} (${page.viewportSize()?.width}px)`, async () => {
      let attempt = 0
      await captureWithRetry(async () => {
        const entry: Record<string, unknown> = {
          name, attempt: ++attempt, viewport: page.viewportSize(), closed: page.isClosed(), connected: browser?.isConnected(),
          at: new Date().toISOString(),
          metrics: await page.evaluate(() => ({
            inner: { width: innerWidth, height: innerHeight }, dpr: devicePixelRatio,
            document: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight,
              clientWidth: document.documentElement.clientWidth, clientHeight: document.documentElement.clientHeight },
            body: { width: document.body.getBoundingClientRect().width, height: document.body.getBoundingClientRect().height },
            visualViewport: visualViewport && { width: visualViewport.width, height: visualViewport.height, scale: visualViewport.scale },
            readyState: document.readyState, fonts: document.fonts.status,
          })),
        }
        attempts.push(entry)
        try {
          const path = info.outputPath(`${name}.png`)
          await page.screenshot({ path, fullPage: true, animations: 'disabled' })
          entry.outcome = 'success'
          await info.attach(`${name}.png`, { path, contentType: 'image/png' })
        } catch (error) {
          entry.outcome = 'failure'
          entry.error = String(error)
          throw error
        }
      }, () => stableLayout(page), async (error) => {
        info.annotations.push({ type: 'screenshot-retry', description: `${name}: ${error.message}` })
        console.warn(`Diagnostic capture failed; retrying once after layout stabilization: ${name}`)
      })
    }),
    finish: async () => {
      page.off('pageerror', pageError); page.off('crash', crash); page.off('close', close)
      browser?.off('disconnected', disconnect)
      await mkdir(info.outputDir, { recursive: true })
      const path = info.outputPath('screenshot-diagnostics.json')
      await writeFile(path, JSON.stringify({
        platform: process.platform, node: process.version, browser: browser?.version(), project: info.project.name,
        workers: info.config.workers, workerIndex: info.workerIndex, repeatEachIndex: info.repeatEachIndex,
        pricing: 'disabled by standard Playwright webServer build', events, attempts,
      }, null, 2))
      await info.attach('screenshot-diagnostics.json', { contentType: 'application/json', path })
    },
  }
}
