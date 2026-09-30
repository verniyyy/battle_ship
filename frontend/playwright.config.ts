import { defineConfig } from '@playwright/test'

// End-to-end checks against the local stack (`just up`, dev sign-in enabled).
// Run them from the flake's dev shell, which provides the browsers: `just e2e`.
export default defineConfig({
  testDir: 'e2e',
  outputDir: 'e2e/results',
  timeout: 60_000,
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: process.env.E2E_URL ?? 'http://localhost:8080',
    viewport: { width: 1280, height: 720 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
})
