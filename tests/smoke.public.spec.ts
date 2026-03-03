import { expect, test } from '@playwright/test';
import type { CiSmokeProfile } from '../src/ciTypes';
import { detectAppSurface, gotoApp } from './helpers';

const profile: CiSmokeProfile = 'public';

test.describe(`Lokalyze smoke (${profile})`, () => {
    test('1) app is reachable and not in fatal fallback', async ({ page }) => {
        await gotoApp(page);
        await expect(page.locator('#root')).toBeVisible();
        await expect(page.getByText(/something went wrong/i)).toHaveCount(0);
    });

    test('2) auth gate detected when enabled, otherwise workspace shell is visible', async ({ page }) => {
        await gotoApp(page);
        const surface = await detectAppSurface(page);
        expect(surface).not.toBe('unknown');

        if (surface === 'auth') {
            await expect(page.getByRole('button', { name: /sign in with google/i })).toBeVisible();
            await expect(page.getByText(/welcome to lokalyze/i)).toBeVisible();
            return;
        }

        await expect(page.getByRole('button', { name: /live monitor/i })).toBeVisible();
        await expect(page.getByRole('button', { name: /asset manager/i })).toBeVisible();
        await expect(page.getByRole('button', { name: /^history/i })).toBeVisible();
    });
});
