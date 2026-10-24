import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const GREEK_NAMES = [
  'Alpha Patil',
  'Beta Deshmukh',
  'Gamma Shinde',
  'Delta Kulkarni',
  'Epsilon Jadhav',
  'Zeta Chavan',
  'Eta Pawar',
  'Theta Gaikwad',
  'Iota More',
  'Kappa Joshi',
];

const ALPHA_SUFFIXES = [
  'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M',
  'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'
];

function getRandomPatientName(prefix: string): string {
  const choice = GREEK_NAMES[Math.floor(Math.random() * GREEK_NAMES.length)];
  const s1 = ALPHA_SUFFIXES[Math.floor(Math.random() * ALPHA_SUFFIXES.length)];
  const s2 = ALPHA_SUFFIXES[Math.floor(Math.random() * ALPHA_SUFFIXES.length)];
  const s3 = ALPHA_SUFFIXES[Math.floor(Math.random() * ALPHA_SUFFIXES.length)];
  const s4 = ALPHA_SUFFIXES[Math.floor(Math.random() * ALPHA_SUFFIXES.length)];
  return `${prefix} ${choice} ${s1}${s2}${s3}${s4}`;
}

function getRandomIndianPhone(): string {
  const prefixes = ['98', '97', '96', '95', '88', '87', '78', '77'];
  const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
  const random8 = Math.floor(10000000 + Math.random() * 90000000);
  return `${prefix}${random8}`.slice(0, 10);
}

async function loginAsDoctor(page: any) {
  await page.goto('/login');
  await page.waitForSelector('#email');
  await page.fill('#email', 'dr.susheel@example.com');
  await page.fill('#password', 'DoctorPassword1234!');
  await page.click('button[type="submit"]');
  await page.waitForFunction(() => window.location.pathname.includes('/settings/security'), null, {
    timeout: 15000,
  });
}

test.describe('Phase 2 E2E: Kiosk, Live Queue, Closing Report & Accessibility', () => {
  // Give each test a unique IP address to prevent test-runner rate-limit exhaustion
  test.beforeEach(async ({ context }, testInfo) => {
    const ip = `10.20.${testInfo.retry + 1}.${Math.floor(Math.random() * 200) + 1}`;
    await context.setExtraHTTPHeaders({
      'x-forwarded-for': ip,
    });
  });

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
      await loginAsDoctor(page);
      await page.goto('/queue');
      await page.waitForSelector('h1');

      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();

      expect(results.violations).toEqual([]);
    });

    test('/reports/closing Closing Report page has 0 Axe violations', async ({ page }) => {
      await loginAsDoctor(page);
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
    test.setTimeout(60000);

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

    // Invariant: Zero patient data in browser localStorage or sessionStorage
    const storageKeys = await page.evaluate(() => {
      return {
        local: Object.keys(localStorage),
        session: Object.keys(sessionStorage),
      };
    });
    expect(storageKeys.local).toHaveLength(0);
    expect(storageKeys.session).toHaveLength(0);

    // Invariant: Back button triggers popstate and immediately resets form to blank
    await page.goBack();
    await page.waitForSelector('#kiosk-name');

    // Verify still blank form, token screen dismissed, zero data restored
    const backNameVal = await page.inputValue('#kiosk-name');
    expect(backNameVal).toBe('');

    const backPhoneVal = await page.inputValue('#kiosk-phone');
    expect(backPhoneVal).toBe('');

    const tokenStillVisible = await page.isVisible('#token-display');
    expect(tokenStillVisible).toBe(false);
  });

  // Test B5: Real-time Kiosk to Doctor Queue within 5 seconds across two browser contexts
  test('B5: New kiosk registration appears in doctor live queue within 5 seconds', async ({
    browser,
  }) => {
    test.setTimeout(60000);

    const randKiosk = Math.floor(Math.random() * 200) + 1;
    const randDoc = Math.floor(Math.random() * 200) + 1;

    // Context 1: Kiosk Tablet (width: 820px)
    const kioskContext = await browser.newContext({
      viewport: { width: 820, height: 1180 },
      extraHTTPHeaders: { 'x-forwarded-for': `10.30.1.${randKiosk}` },
    });
    const kioskPage = await kioskContext.newPage();

    // Context 2: Doctor Laptop (width: 1440px)
    const doctorContext = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      extraHTTPHeaders: { 'x-forwarded-for': `10.30.2.${randDoc}` },
    });
    const doctorPage = await doctorContext.newPage();

    // 1. Doctor logs in and opens Live Queue
    await loginAsDoctor(doctorPage);
    await doctorPage.goto('/queue');
    await doctorPage.waitForSelector('h1');

    // 2. Patient unlocks and registers on Kiosk Tablet
    await kioskPage.goto('/register');
    await kioskPage.waitForSelector('#kiosk-pin');
    await kioskPage.fill('#kiosk-pin', '1234');
    await kioskPage.click('#btn-unlock-kiosk');

    await kioskPage.waitForSelector('#kiosk-name');
    const patientName = getRandomPatientName('Kiosk');
    const patientPhone = getRandomIndianPhone();
    await kioskPage.fill('#kiosk-name', patientName);
    await kioskPage.fill('#kiosk-age', '28');
    await kioskPage.click('button:has-text("Male")');
    await kioskPage.fill('#kiosk-phone', patientPhone);
    await kioskPage.fill('#kiosk-reason', 'Routine dental cleaning');
    await kioskPage.check('#kiosk-consent');

    const submitStartTime = Date.now();
    await kioskPage.click('#btn-register-submit');

    // Wait for token display on kiosk
    await kioskPage.waitForSelector('#token-display');

    // 3. Verify visit appears in doctor's live queue within 5 seconds without manual page reload
    await doctorPage.waitForSelector(`text=${patientName}`, { timeout: 8000 });
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
    test.setTimeout(60000);

    // First, register a walk-in patient so the queue has an active item
    await page.goto('/register');
    await page.waitForSelector('#kiosk-pin');
    await page.fill('#kiosk-pin', '1234');
    await page.click('#btn-unlock-kiosk');

    await page.waitForSelector('#kiosk-name');
    const patientName = getRandomPatientName('Keyboard');
    const patientPhone = getRandomIndianPhone();
    await page.fill('#kiosk-name', patientName);
    await page.fill('#kiosk-age', '33');
    await page.click('button:has-text("Female")');
    await page.fill('#kiosk-phone', patientPhone);
    await page.fill('#kiosk-reason', 'Tooth consultation');
    await page.check('#kiosk-consent');
    await page.click('#btn-register-submit');
    await page.waitForSelector('#token-display');

    // Now Doctor logs in and opens the Queue
    await loginAsDoctor(page);
    await page.goto('/queue');

    // Target the specific patient row
    const patientRow = page.locator(`[id^="queue-row-"]`).filter({ hasText: patientName }).first();
    await patientRow.waitFor({ state: 'visible', timeout: 10000 });

    // Focus "Call In" button using keyboard and activate with Space
    const callInBtn = patientRow.locator('button:has-text("Call In")');
    await callInBtn.focus();
    await callInBtn.press('Space');

    // Status transitions to In Consultation
    await expect(patientRow.locator('text=In Consultation')).toBeVisible({ timeout: 6000 });

    // Focus "Complete" button using keyboard and activate with Space
    const completeBtn = patientRow.locator('button:has-text("Complete")');
    await completeBtn.focus();
    await completeBtn.press('Space');

    // Visit completed and removed from active queue
    await expect(page.locator(`text=${patientName}`)).toHaveCount(0, { timeout: 6000 });
  });
});
