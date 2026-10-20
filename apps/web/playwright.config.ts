import { defineConfig, devices } from '@playwright/test'

/**
 * End-to-end against a stack of its own: `infra/local/e2e.ts` wipes and seeds the `postgres-e2e`
 * database and serves the API on :8290; the panel runs on :5290 pointed at it. Nothing here touches
 * the dev database or a `bun run up` that is already running.
 *
 *     bun run web:e2e
 */
export default defineConfig({
  testDir: 'playwright/e2e',
  fullyParallel: false,
  workers: 1,
  use: { baseURL: 'http://localhost:5290', trace: 'retain-on-failure', locale: 'pt-BR' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'bun run infra/local/e2e.ts',
      cwd: '../..',
      url: 'http://localhost:8290/work/health',
      reuseExistingServer: false,
      timeout: 120_000
    },
    {
      command: 'bun run vite --port 5290 --strictPort',
      url: 'http://localhost:5290',
      reuseExistingServer: false,
      env: { VITE_API_URL: 'http://localhost:8290' }
    }
  ]
})
