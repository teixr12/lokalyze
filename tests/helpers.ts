import type { Page } from '@playwright/test';

export const gotoApp = async (page: Page) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
};

export type AppSurface = 'auth' | 'workspace' | 'unknown';

export const detectAppSurface = async (page: Page, timeoutMs = 12000): Promise<AppSurface> => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const authButton = page.getByRole('button', { name: /sign in with google/i });
        if ((await authButton.count()) > 0 && await authButton.first().isVisible().catch(() => false)) {
            return 'auth';
        }

        const workspaceTab = page.getByRole('button', { name: /live monitor/i });
        if ((await workspaceTab.count()) > 0 && await workspaceTab.first().isVisible().catch(() => false)) {
            return 'workspace';
        }

        await page.waitForTimeout(200);
    }

    return 'unknown';
};

export const hasAuthGate = async (page: Page) => {
    const surface = await detectAppSurface(page);
    return surface === 'auth';
};
