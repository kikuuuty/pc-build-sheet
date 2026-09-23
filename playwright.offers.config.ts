import { defineConfig } from '@playwright/test'
import base from './playwright.config'

// Exercise the provisional bulk path against mocks without enabling it in production builds.
export default defineConfig({
  ...base,
  testIgnore: [],
  testMatch: '**/offers.spec.ts',
  outputDir: 'test-results/offers',
  use: { ...base.use, baseURL: 'http://127.0.0.1:4183' },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4183 --strictPort',
    url: 'http://127.0.0.1:4183',
    env: { VITE_CATALOG_OFFERS_SUMMARY_ENABLED: 'true' },
    reuseExistingServer: false,
  },
})
