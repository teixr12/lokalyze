import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:4173';
const useWebServer = !process.env.PLAYWRIGHT_SKIP_WEBSERVER;

export default defineConfig({
    testDir: './tests',
    timeout: 60_000,
    expect: {
        timeout: 10_000,
    },
    retries: 0,
    use: {
        baseURL,
        headless: true,
        trace: 'on-first-retry',
    },
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
    ],
    webServer: useWebServer
        ? {
            command: 'npm run dev -- --host 127.0.0.1 --port 4173',
            url: baseURL,
            reuseExistingServer: true,
            timeout: 120_000,
        }
        : undefined,
});
