import { defineConfig, devices } from '@playwright/test';
const port=Number(process.env.BW_CAD_TEST_PORT||4317);
// One shared Chromium for every project: PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH may point at a
// browser another Playwright version installed, so no per-version download is needed.
const chromium={ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] };
export default defineConfig({ testDir: './tests/browser', timeout: 45000, expect: { timeout: 15000 }, fullyParallel: false, workers: 1,
  webServer: { command: `npm run preview -- --port ${port}`, url: `http://127.0.0.1:${port}`, reuseExistingServer: !process.env.CI, timeout: 30000 },
  use: { baseURL: `http://127.0.0.1:${port}`, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], launchOptions: chromium } },
    // iPad layout, touch and viewport in the same shared Chromium. Real WebKit is opt-in
    // (CAD_WEBKIT=1) so machines and agents keep one browser download, not two.
    { name: 'ipad', use: { ...devices['iPad Pro 11'], browserName: 'chromium', launchOptions: chromium } },
    ...(process.env.CAD_WEBKIT==='1'?[{ name: 'ipad-webkit', use: { ...devices['iPad Pro 11'], browserName: 'webkit' as const } }]:[]),
  ],
});
