import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  testIgnore: ['**/*.live.spec.ts', '**/pricing.spec.ts'],
  fullyParallel: true,
  workers: 4,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4173', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 960 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'npm run build && npm run preview -- --host 127.0.0.1 --port 4173 --strictPort',
    env: { VITE_PRICING_ENABLED: 'false', VITE_PRICING_API_BASE_URL: '', VITE_CATALOG_OFFERS_SUMMARY_ENABLED: 'true' },
    url: 'http://127.0.0.1:4173', reuseExistingServer: false,
  },
})
