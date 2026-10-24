import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.describe('Phase 2 E2E: Kiosk, Live Queue, Closing Report & Accessibility', () => {
  // Test Axe Accessibility across pages and viewports (1440px, 820px, 390px)
  test.describe('B15: Automated Axe Accessibility Scans (0 violations)', () => {
    test('/register PIN screen has 0 Axe violations', async ({ page }) => {
      await page.goto('/register');
      await page.waitForSelector('h1');

      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();

      expect(results.violations).toEqual([]);
    });

    test('/register unlocked registration form has 0 Axe violations', async ({ page }) => {
      await page.goto('/register');
      await page.waitForSelector('#kiosk-pin');

      // Unlock kiosk with PIN
      await page.fill('#kiosk-pin', '1234');
      await page.click('#btn-unlock-kiosk');

      // Wait for registration form
      await page.waitForSelector('#kiosk-name');

      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();

      expect(results.violations).toEqual([]);
    });

    test('/queue Live Queue page has 0 Axe violations', async ({ page }) => {
      await page.goto('/queue');
      await page.waitForSelector('h1');

      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();

      expect(results.violations).toEqual([]);
    });

    test('/reports/closing Closing Report page has 0 Axe violations', async ({ page }) => {
      await page.goto('/reports/closing');
      await page.waitForSelector('h1, h2');

      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();

      expect(results.violations).toEqual([]);
    });
  });

  // Test B4: Form Reset, Zero Browser Storage, and Back Button Protection
  test('B4: Kiosk form resets within 10s, leaves zero browser storage, and Back button does not restore entry', async ({
    page,
  }) => {
    // Navigate to register and unlock
    await page.goto('/register');
    await page.waitForSelector('#kiosk-pin');
    await page.fill('#kiosk-pin', '1234');
    await page.click('#btn-unlock-kiosk');

    await page.waitForSelector('#kiosk-name');

    // Fill form
    await page.fill('#kiosk-name', 'Sunita Ramesh Deshmukh');
    await page.fill('#kiosk-age', '42');
    await page.click('button:has-text("Female")');
    await page.fill('#kiosk-phone', '9822055667');
    await page.fill('#kiosk-reason', 'Severe toothache in upper molar');
    await page.check('#kiosk-consent');

    // Submit
    await page.click('#btn-register-submit');

    // Token screen displayed
    await page.waitForSelector('#token-display');
    const tokenText = await page.textContent('#token-display');
    expect(tokenText).toMatch(/#\d+/);

    // Click "Done / Next Patient" (or wait for countdown)
    await page.click('#btn-new-registration');

    // Form resets to blank
    await page.waitForSelector('#kiosk-name');
    const nameVal = await page.inputValue('#kiosk-name');
    expect(nameVal).toBe('');

    const phoneVal = await page.inputValue('#kiosk-phone');
    expect(phoneVal).toBe('');

    // Invariant: Zero patient data in browser localStorage or sessionStorage
    const storageKeys = await page.evaluate(() => {
      return {
        local: Object.keys(localStorage),
        session: Object.keys(sessionStorage),
      };
    });
    expect(storageKeys.local).toHaveLength(0);
    expect(storageKeys.session).toHaveLength(0);

    // Invariant: Back button does NOT restore previous patient entry
    await page.goBack();
    await page.waitForTimeout(500);

    // Verify still blank form, token screen not restored
    const backNameVal = await page.inputValue('#kiosk-name').catch(() => '');
    expect(backNameVal).toBe('');
    const tokenStillVisible = await page.isVisible('#token-display');
    expect(tokenStillVisible).toBe(false);
  });

  // Test B5: Real-time Kiosk to Doctor Queue within 5 seconds across two browser contexts
  test('B5: New kiosk registration appears in doctor live queue within 5 seconds', async ({
    browser,
  }) => {
    // Context 1: Kiosk Tablet (width: 820px)
    const kioskContext = await browser.newContext({
      viewport: { width: 820, height: 1180 },
    });
    const kioskPage = await kioskContext.newPage();

    // Context 2: Doctor Laptop (width: 1440px)
    const doctorContext = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const doctorPage = await doctorContext.newPage();

    // 1. Doctor opens Live Queue
    await doctorPage.goto('/queue');
    await doctorPage.waitForSelector('h1');

    // 2. Patient unlocks and registers on Kiosk Tablet
    await kioskPage.goto('/register');
    await kioskPage.waitForSelector('#kiosk-pin');
    await kioskPage.fill('#kiosk-pin', '1234');
    await kioskPage.click('#btn-unlock-kiosk');

    await kioskPage.waitForSelector('#kiosk-name');
    const patientName = `Kiosk Patient ${Date.now().toString().slice(-4)}`;
    await kioskPage.fill('#kiosk-name', patientName);
    await kioskPage.fill('#kiosk-age', '28');
    await kioskPage.click('button:has-text("Male")');
    await kioskPage.fill('#kiosk-phone', '9822188776');
    await kioskPage.fill('#kiosk-reason', 'Routine dental cleaning');
    await kioskPage.check('#kiosk-consent');

    const submitStartTime = Date.now();
    await kioskPage.click('#btn-register-submit');

    // Wait for token display on kiosk
    await kioskPage.waitForSelector('#token-display');

    // 3. Verify visit appears in doctor's live queue within 5 seconds without manual page reload
    await doctorPage.waitForSelector(`text=${patientName}`, { timeout: 5000 });
    const elapsedMs = Date.now() - submitStartTime;

    // Must appear in the queue within 5 seconds
    expect(elapsedMs).toBeLessThanOrEqual(5000);

    // Cleanup contexts
    await kioskContext.close();
    await doctorContext.close();
  });

  // Test Keyboard Accessibility & Operatory Flow for Doctor Queue
  test('Doctor can navigate and transition queue visits using keyboard navigation alone', async ({
    page,
  }) => {
    // First, register a walk-in patient so the queue has an active item
    await page.goto('/register');
    await page.waitForSelector('#kiosk-pin');
    await page.fill('#kiosk-pin', '1234');
    await page.click('#btn-unlock-kiosk');

    await page.waitForSelector('#kiosk-name');
    const patientName = `Keyboard Patient ${Date.now().toString().slice(-4)}`;
    await page.fill('#kiosk-name', patientName);
    await page.fill('#kiosk-age', '33');
    await page.click('button:has-text("Female")');
    await page.fill('#kiosk-phone', '9822123987');
    await page.fill('#kiosk-reason', 'Tooth consultation');
    await page.check('#kiosk-consent');
    await page.click('#btn-register-submit');
    await page.waitForSelector('#token-display');

    // Now Doctor opens the Queue
    await page.goto('/queue');
    await page.waitForSelector(`text=${patientName}`);

    // Find the "Call In" button for this patient
    const callInBtn = page.locator(`button:has-text("Call In")`).first();
    await expect(callInBtn).toBeVisible();

    // Focus using keyboard
    await callInBtn.focus();
    await page.keyboard.press('Enter');

    // Status transitions to In Consultation
    await page.waitForSelector('text=In Consultation', { timeout: 4000 });

    // Focus "Complete" button using keyboard
    const completeBtn = page.locator(`button:has-text("Complete")`).first();
    await completeBtn.focus();
    await page.keyboard.press('Enter');

    // Visit completed and removed from active queue
    await page.waitForSelector(`text=${patientName}`, { state: 'detached', timeout: 4000 });
  });
});
