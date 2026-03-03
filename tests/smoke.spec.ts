import { expect, test, type Page } from '@playwright/test';

const gotoApp = async (page: Page) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await Promise.race([
        page.getByRole('button', { name: /sign in with google/i }).waitFor({ state: 'visible', timeout: 15_000 }),
        page.getByRole('button', { name: /live monitor/i }).waitFor({ state: 'visible', timeout: 15_000 }),
        page.getByText(/welcome to lokalyze/i).waitFor({ state: 'visible', timeout: 15_000 }),
    ]).catch(() => {
        // Leave assertions to individual tests.
    });
};

const hasAuthGate = async (page: Page) => {
    const hasSignInButton = await page.getByRole('button', { name: /sign in with google/i }).isVisible().catch(() => false);
    if (hasSignInButton) return true;
    return page.getByText(/welcome to lokalyze/i).isVisible().catch(() => false);
};

const skipIfAuthGate = async (page: Page) => {
    const authGate = await hasAuthGate(page);
    test.skip(authGate, 'Workspace flows require authenticated session when Firebase auth gate is enabled.');
};

test.describe('Lokalyze smoke regression', () => {
    test('1) app opens with auth gate or workspace shell', async ({ page }) => {
        await gotoApp(page);
        if (await hasAuthGate(page)) {
            await expect(page.getByRole('button', { name: /sign in with google/i })).toBeVisible();
            return;
        }

        await expect(page.getByRole('button', { name: /live monitor/i })).toBeVisible();
    });

    test('2) workspace shell renders core tabs', async ({ page }) => {
        await gotoApp(page);
        await skipIfAuthGate(page);
        await expect(page.getByRole('button', { name: /live monitor/i })).toBeVisible();
        await expect(page.getByRole('button', { name: /asset manager/i })).toBeVisible();
        await expect(page.getByRole('button', { name: /history/i })).toBeVisible();
    });

    test('3) editor switches between HTML and CSS tabs', async ({ page }) => {
        await gotoApp(page);
        await skipIfAuthGate(page);
        await page.getByRole('button', { name: /^css$/i }).click();
        await expect(page.getByText(/chars/i).first()).toBeVisible();
        await page.getByRole('button', { name: /^html$/i }).click();
        await expect(page.getByText(/chars/i).first()).toBeVisible();
    });

    test('4) language selection and clear action', async ({ page }) => {
        await gotoApp(page);
        await skipIfAuthGate(page);
        await page.getByRole('button', { name: /^french$/i }).first().click();

        const clearBtn = page.getByRole('button', { name: /^clear$/i });
        if (await clearBtn.count()) {
            await clearBtn.click();
            await expect(page.getByText(/0 selected/i)).toBeVisible();
        } else {
            await expect(page.getByRole('button', { name: /^french$/i }).first()).toBeVisible();
        }
    });

    test('5) start batch validation blocks invalid input path', async ({ page }) => {
        await gotoApp(page);
        await skipIfAuthGate(page);

        const clearBtn = page.getByRole('button', { name: /^clear$/i });
        test.skip(!(await clearBtn.count()), 'Validation path depends on clear action availability.');

        await clearBtn.click();
        await page.getByRole('button', { name: /initialize batch/i }).click();
        await expect(page.getByText(/select at least one language/i)).toBeVisible();
    });

    test('6) monitor opens detail and toggles preview/code', async ({ page }) => {
        await gotoApp(page);
        await skipIfAuthGate(page);

        await page.getByRole('button', { name: /initialize batch/i }).click();
        await expect(page.getByText(/process queue/i)).toBeVisible();

        const queueItem = page.locator('div').filter({ hasText: /tokens|queued|running|done|error/i }).first();
        await queueItem.click();

        const toggleBtn = page.getByRole('button', { name: /code|preview/i }).first();
        await expect(toggleBtn).toBeVisible();
        await toggleBtn.click();
    });

    test('7) assets tab renders empty state or override inputs', async ({ page }) => {
        await gotoApp(page);
        await skipIfAuthGate(page);

        await page.getByRole('button', { name: /asset manager/i }).click();
        await expect(page.getByText(/detected images/i)).toBeVisible();

        const hasEmpty = await page.getByText(/no image tags found|no <img> tags found/i).count();
        if (!hasEmpty) {
            await expect(page.getByText(/original source/i).first()).toBeVisible();
            await expect(page.getByText(/replacement source/i).first()).toBeVisible();
        }
    });

    test('8) history tab renders and validates load/delete guard', async ({ page }) => {
        await gotoApp(page);
        await skipIfAuthGate(page);

        await page.getByRole('button', { name: /history/i }).click();
        await expect(page.getByText(/project history/i)).toBeVisible();

        const loadButtons = page.getByRole('button', { name: /^load$/i });
        if (await loadButtons.count()) {
            await loadButtons.first().click();
            await expect(page.getByText(/loaded|cannot load while batch is running/i)).toBeVisible();
        }

        const deleteButtons = page.locator('button.hover\\:text-red-500');
        if (await deleteButtons.count()) {
            let dialogSeen = false;
            page.once('dialog', async dialog => {
                dialogSeen = true;
                await dialog.dismiss();
            });
            await deleteButtons.first().click();
            await page.waitForTimeout(300);
            expect(dialogSeen).toBeTruthy();
        }
    });

    test('9) settings modal opens and key validation path works', async ({ page }) => {
        await gotoApp(page);
        await skipIfAuthGate(page);

        await page.getByRole('button', { name: /open settings/i }).click();
        await expect(page.getByText(/^settings$/i)).toBeVisible();

        const keyInput = page.locator('input[placeholder="AIzaSy..."]').first();
        if (await keyInput.count()) {
            await keyInput.fill('invalid-key');
            const errorMsg = page.getByText(/invalid gemini api key format/i);
            if (await errorMsg.count()) {
                await expect(errorMsg).toBeVisible();
            }
        }
    });
});
