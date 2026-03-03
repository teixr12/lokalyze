import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:4173';
const useWebServer = !process.env.PLAYWRIGHT_SKIP_WEBSERVER;
const smokeProfile = process.env.PLAYWRIGHT_PROFILE || 'public';

const webServerCommand = smokeProfile === 'workspace'
    ? 'VITE_DISABLE_FIREBASE_AUTH=true npm run dev -- --host 127.0.0.1 --port 4173'
    : 'npm run dev -- --host 127.0.0.1 --port 4173';

export default defineConfig({
    testDir: './tests',
    timeout: 60_000,
    reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
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
            command: webServerCommand,
            url: baseURL,
            reuseExistingServer: true,
            timeout: 120_000,
        }
        : undefined,
});
