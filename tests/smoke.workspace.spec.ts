import { expect, test } from '@playwright/test';
import type { CiSmokeProfile } from '../src/ciTypes';
import { detectAppSurface, gotoApp } from './helpers';

const profile: CiSmokeProfile = 'workspace';

test.describe(`Lokalyze smoke (${profile})`, () => {
    test.beforeEach(async ({ page }) => {
        await gotoApp(page);
        const surface = await detectAppSurface(page);
        test.skip(surface === 'auth', 'Workspace smoke expects auth gate disabled in this profile.');
        expect(surface).toBe('workspace');
    });

    test('1) workspace shell renders core tabs', async ({ page }) => {
        await expect(page.getByRole('button', { name: /live monitor/i })).toBeVisible();
        await expect(page.getByRole('button', { name: /asset manager/i })).toBeVisible();
        await expect(page.getByRole('button', { name: /^history/i })).toBeVisible();
    });

    test('2) editor switches between HTML and CSS tabs', async ({ page }) => {
        await page.getByRole('button', { name: /^css$/i }).click();
        await expect(page.getByText(/chars/i).first()).toBeVisible();
        await page.getByRole('button', { name: /^html$/i }).click();
        await expect(page.getByText(/chars/i).first()).toBeVisible();
    });

    test('3) language selection and clear by toggling defaults', async ({ page }) => {
        await page.getByRole('button', { name: /^spanish$/i }).first().click();
        await page.getByRole('button', { name: /^german$/i }).first().click();
        await expect(page.getByText(/0 selected/i)).toBeVisible();
    });

    test('4) start batch validation blocks invalid input path', async ({ page }) => {
        await page.getByRole('button', { name: /^spanish$/i }).first().click();
        await page.getByRole('button', { name: /^german$/i }).first().click();
        await page.getByRole('button', { name: /initialize batch/i }).click();
        await expect(page.getByText(/select at least one language/i)).toBeVisible();
    });

    test('5) monitor opens detail and toggles preview/code', async ({ page }) => {
        await page.getByRole('button', { name: /initialize batch/i }).click();
        await expect(page.getByText(/process queue/i)).toBeVisible();

        const queueItem = page.locator('div.cursor-pointer.rounded-2xl').first();
        await expect(queueItem).toBeVisible();
        await queueItem.click();

        const toggleBtn = page.getByRole('button', { name: /code|preview/i }).first();
        await expect(toggleBtn).toBeVisible({ timeout: 10000 });
        await toggleBtn.click();
    });

    test('6) assets tab renders and shows override controls', async ({ page }) => {
        await page.getByRole('button', { name: /asset manager/i }).click();
        await expect(page.getByText(/detected images/i)).toBeVisible();

        const hasEmpty = await page.getByText(/no image tags found|no <img> tags found/i).count();
        if (!hasEmpty) {
            await expect(page.getByText(/original source/i).first()).toBeVisible();
            await expect(page.getByText(/replacement source/i).first()).toBeVisible();
        }
    });

    test('7) history tab renders and validates delete guard', async ({ page }) => {
        await page.getByRole('button', { name: /^history/i }).click();
        await expect(page.getByText(/project history/i)).toBeVisible();

        const deleteButtons = page.locator('button.hover\\:text-red-500');
        if (await deleteButtons.count()) {
            await deleteButtons.first().click();
            await expect(page.getByRole('heading', { name: /delete project history/i })).toBeVisible();
            await page.getByRole('button', { name: /keep project/i }).click();
            await expect(page.getByRole('heading', { name: /delete project history/i })).toHaveCount(0);
        }
    });

    test('8) settings modal opens and key validation path works', async ({ page }) => {
        await page.getByRole('button', { name: /open settings/i }).click();
        await expect(page.getByText(/^settings$/i)).toBeVisible();

        const keyInput = page.locator('input[placeholder="AIzaSy..."]').first();
        await keyInput.fill('invalid-key');

        const invalidKeyMessage = page.getByText(/invalid gemini api key format/i);
        if ((await invalidKeyMessage.count()) > 0) {
            await expect(invalidKeyMessage).toBeVisible();
            return;
        }

        const saveButton = page.getByRole('button', { name: /save changes/i });
        await expect(saveButton).toBeVisible();
        await saveButton.click();
        await expect(page.getByText(/settings saved successfully/i)).toBeVisible();
    });
});
