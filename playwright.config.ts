import { defineConfig, devices } from '@playwright/test';

// E2E_BASE_URL runs the suite against an already running server (no web server is started).
const external = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  workers: 2,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: external ?? 'http://127.0.0.1:4174',
    // E2E 断言基于英文界面文案；通过初始 localStorage 固定语言，
    // 让界面中文化不影响既有回归套件。中文界面另由 i18n 专项用例覆盖。
    storageState: {
      cookies: [],
      origins: [{
        origin: external ?? 'http://127.0.0.1:4174',
        localStorage: [{ name: 'parametric:lang', value: 'en-US' }],
      }],
    },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: {
      // Software WebGL2 so the suite runs on machines without a GPU.
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } }, testIgnore: /mobile\.spec\.ts/ },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /mobile\.spec\.ts/ },
  ],
  webServer: external
    ? undefined
    : {
        command: 'npm run dev -- --port 4174 --strictPort',
        url: 'http://127.0.0.1:4174',
        reuseExistingServer: !process.env.CI,
      },
});
