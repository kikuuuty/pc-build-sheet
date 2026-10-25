import { defineConfig } from '@playwright/test'
import base from './playwright.config'

// Production preview against browser mocks; no external Gateway process required.
export default defineConfig({
  ...base,
  testIgnore: [],
  testMatch: '**/pricing.spec.ts',
  outputDir: 'test-results/pricing',
  use: { ...base.use, baseURL: 'http://127.0.0.1:4183' },
  webServer: {
    command: 'npm run build -- --outDir dist-pricing && npm run preview -- --outDir dist-pricing --host 127.0.0.1 --port 4183 --strictPort',
    env: { VITE_PRICING_ENABLED: 'true', VITE_PRICING_API_BASE_URL: 'http://127.0.0.1:8788', VITE_CATALOG_OFFERS_SUMMARY_ENABLED: 'true' },
    url: 'http://127.0.0.1:4183',
    reuseExistingServer: false,
  },
})
