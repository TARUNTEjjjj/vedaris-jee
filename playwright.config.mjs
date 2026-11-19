// Browser release gate (dev-only). See docs/BROWSER-RELEASE-GATES.md.
// Run `npm run test:browser`; it builds dist/ first and serves that exact release.
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/browser',
  testMatch: '**/*.spec.mjs',
  outputDir: 'test-results/browser-gate/artifacts',
  timeout: 90_000,
  expect: {timeout: 15_000},
  // Performance measurements must not compete with parallel workers for CPU.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  globalSetup: './tests/browser/global-setup.mjs',
  reporter: [['list'], ['json', {outputFile: 'test-results/browser-gate/results.json'}]],
  use: {
    browserName: 'chromium',
    // *.localhost is a secure context, so the service worker registers; the app
    // deliberately skips registration on bare localhost/127.0.0.1. Every other
    // host fails to resolve, keeping the gate hermetic.
    launchOptions: {args: ['--host-resolver-rules=MAP vedaris.localhost 127.0.0.1, MAP * ~NOTFOUND']},
    locale: 'en-IN',
    timezoneId: 'Asia/Kolkata',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
