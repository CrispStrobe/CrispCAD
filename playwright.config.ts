import { defineConfig, devices } from '@playwright/test';
export default defineConfig({ testDir: './tests/browser', timeout: 45000, expect: { timeout: 15000 }, fullyParallel: false, workers: 1,
  webServer: { command: 'npm run preview', url: 'http://127.0.0.1:4317', reuseExistingServer: !process.env.CI, timeout: 30000 },
  use: { baseURL: 'http://127.0.0.1:4317', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } } },
    { name: 'ipad-webkit', use: { ...devices['iPad Pro 11'], browserName: 'webkit' } },
  ],
});
