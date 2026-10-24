import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.describe('A18: Accessibility (Axe) & Keyboard Navigation', () => {
  test('/login passes automated Axe accessibility scan with 0 violations', async ({ page }) => {
    await page.goto('/login');
    await page.waitForSelector('h1');

    const accessibilityScanResults = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    expect(accessibilityScanResults.violations).toEqual([]);
  });

  test('/login/2fa passes automated Axe accessibility scan with 0 violations', async ({ page }) => {
    await page.goto('/login/2fa?email=test%40clinic.com');
    await page.waitForSelector('h1');

    const accessibilityScanResults = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    expect(accessibilityScanResults.violations).toEqual([]);
  });

  test('/settings/security passes automated Axe accessibility scan with 0 violations', async ({ page }) => {
    await page.goto('/settings/security');
    await page.waitForSelector('h1');

    const accessibilityScanResults = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    expect(accessibilityScanResults.violations).toEqual([]);
  });

  test('Keyboard-only login flow works without mouse pointer interaction', async ({ page }) => {
    await page.goto('/login');

    // Press Tab to focus into first interactive element (email input)
    await page.keyboard.press('Tab');
    const focusedInput = await page.evaluate(() => document.activeElement?.id);
    expect(focusedInput).toBe('email');

    // Type email
    await page.keyboard.type('dr.susheel@example.com');

    // Tab to password
    await page.keyboard.press('Tab');
    const passwordInput = await page.evaluate(() => document.activeElement?.id);
    expect(passwordInput).toBe('password');

    // Type password
    await page.keyboard.type('TestPassword1234!');

    // Tab to Submit button
    await page.keyboard.press('Tab');
    const submitBtnType = await page.evaluate(() => (document.activeElement as HTMLButtonElement)?.type);
    expect(submitBtnType).toBe('submit');

    // Press Enter to submit
    await page.keyboard.press('Enter');

    // Form submitted, error or redirect rendered
    await page.waitForSelector('[role="alert"], #code', { timeout: 5000 });
  });
});
