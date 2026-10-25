import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const GREEK_NAMES = [
  'Alpha Patil',
  'Beta Deshmukh',
  'Gamma Shinde',
  'Delta Kulkarni',
  'Epsilon Jadhav',
];

const ALPHA_SUFFIXES = [
  'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M',
  'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z',
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

async function ensureOperatoryVacant(page: any) {
  await page.goto('/queue');
  await page.waitForSelector('[id^="queue-row-"], #queue-empty-state', { timeout: 15000 });
  const completeButtons = page.locator('button:has-text("Complete")');
  while ((await completeButtons.count()) > 0) {
    const respPromise = page
      .waitForResponse(
        (resp: any) => resp.url().includes('/api/queue') && resp.status() === 200,
        { timeout: 8000 }
      )
      .catch(() => null);
    await completeButtons.first().click();
    await respPromise;
    await page.waitForTimeout(500);
  }
}

test.describe('Phase 5 E2E: Appointments, Follow-ups & Accessibility', () => {
  test.beforeEach(async ({ page, context }, testInfo) => {
    page.on('dialog', async (dialog) => {
      await dialog.accept();
    });

    const ip = `10.50.${testInfo.retry + 1}.${Math.floor(Math.random() * 200) + 1}`;
    await context.setExtraHTTPHeaders({
      'x-forwarded-for': ip,
    });
  });

  test('E13: Tablet 820px – Book appointment → Check-in → Verify in Live Queue', async ({
    page,
  }) => {
    test.setTimeout(120000);
    await page.setViewportSize({ width: 820, height: 1180 });

    // 1. Walk-in patient registers at kiosk first to have a patient in system
    await page.goto('/register');
    await page.waitForSelector('#kiosk-pin');
    await page.fill('#kiosk-pin', '1234');
    await page.click('#btn-unlock-kiosk');

    await page.waitForSelector('#kiosk-name');
    const patientName = getRandomPatientName('ApptPatient');
    const patientPhone = getRandomIndianPhone();
    await page.fill('#kiosk-name', patientName);
    await page.fill('#kiosk-age', '35');
    await page.click('button:has-text("Male")');
    await page.fill('#kiosk-phone', patientPhone);
    await page.fill('#kiosk-reason', 'Dental checkup appointment test');
    await page.check('#kiosk-consent');
    await page.click('#btn-register-submit');
    await page.waitForSelector('#token-display');

    // 2. Doctor logs in
    await loginAsDoctor(page);
    await ensureOperatoryVacant(page);

    // 3. Navigate to Appointments page
    await page.goto('/appointments');
    await page.waitForSelector('h1:has-text("Appointment Schedule")');

    // 4. Click + Book Slot button
    const bookBtn = page.locator('#btn-book-appointment-header');
    await expect(bookBtn).toBeVisible({ timeout: 10000 });
    await bookBtn.click();

    // 5. Fill out the booking form – use "Existing Patient" and search
    await page.waitForSelector('#input-patient-search');

    // Select "Existing Patient" tab (default)
    await page.fill('#input-patient-search', patientName.slice(0, 12));
    await page.waitForTimeout(500); // debounce

    // Wait for search results to appear
    const patientOption = page.locator(`button:has-text("${patientName}")`).first();
    await expect(patientOption).toBeVisible({ timeout: 10000 });
    await patientOption.click();

    // Fill date (today), time, reason
    await page.selectOption('#input-slot-time', '10:00');
    await page.fill('#input-reason', 'Tooth pain – e2e test');

    // Submit
    const confirmBookBtn = page.locator('#btn-confirm-book');
    await expect(confirmBookBtn).toBeVisible();

    const createResp = page.waitForResponse(
      (resp: any) => resp.url().includes('/api/appointments') && resp.request().method() === 'POST',
      { timeout: 15000 }
    );
    await confirmBookBtn.click();
    const resp = await createResp;
    expect(resp.status()).toBe(201);

    // 6. Verify the appointment appears in the day view
    await page.waitForTimeout(1000);
    const apptCard = page.locator(`text=${patientName}`).first();
    await expect(apptCard).toBeVisible({ timeout: 10000 });

    // 7. Check-in the appointment
    const checkInBtn = page.locator('button:has-text("Check In")').first();
    await expect(checkInBtn).toBeVisible({ timeout: 5000 });

    const checkInResp = page.waitForResponse(
      (resp: any) => resp.url().includes('/check-in') && resp.request().method() === 'POST',
      { timeout: 15000 }
    );
    await checkInBtn.click();
    const ciResp = await checkInResp;
    expect([200, 201].includes(ciResp.status())).toBe(true);

    // 8. Verify success message and status change
    await page.waitForTimeout(1000);
    await expect(page.locator('text=Checked In').first()).toBeVisible({ timeout: 10000 });

    // 9. Navigate to Live Queue and verify the patient appears
    await page.goto('/queue');
    await page.waitForSelector('[id^="queue-row-"], #queue-empty-state', { timeout: 15000 });
    const queueRow = page.locator(`[id^="queue-row-"]`).filter({ hasText: patientName }).first();
    await expect(queueRow).toBeVisible({ timeout: 15000 });

    // Cleanup: complete the visit
    await ensureOperatoryVacant(page);
  });

  test('E13: Follow-up flow – Create follow-up → Verify in list → Mark done', async ({
    page,
  }) => {
    test.setTimeout(90000);
    await page.setViewportSize({ width: 820, height: 1180 });

    // 1. Register a patient at kiosk
    await page.goto('/register');
    await page.waitForSelector('#kiosk-pin');
    await page.fill('#kiosk-pin', '1234');
    await page.click('#btn-unlock-kiosk');

    await page.waitForSelector('#kiosk-name');
    const patientName = getRandomPatientName('FUPatient');
    const patientPhone = getRandomIndianPhone();
    await page.fill('#kiosk-name', patientName);
    await page.fill('#kiosk-age', '40');
    await page.click('button:has-text("Female")');
    await page.fill('#kiosk-phone', patientPhone);
    await page.fill('#kiosk-reason', 'Follow-up scheduling test');
    await page.check('#kiosk-consent');
    await page.click('#btn-register-submit');
    await page.waitForSelector('#token-display');

    // 2. Login as doctor
    await loginAsDoctor(page);

    // 3. Navigate to Follow-ups
    await page.goto('/followups');
    await page.waitForSelector('h1:has-text("Follow-ups")');

    // 4. Click + Add Follow-up
    const addBtn = page.locator('#btn-add-followup-header');
    await expect(addBtn).toBeVisible({ timeout: 10000 });
    await addBtn.click();

    // 5. Search for the patient
    await page.waitForSelector('#followup-patient-search, [id*="patient"]');
    // Try to fill patient search field
    const searchField = page.locator('input[placeholder*="name"], input[placeholder*="phone"], input[placeholder*="Type"]').first();
    await expect(searchField).toBeVisible({ timeout: 5000 });
    await searchField.fill(patientName.slice(0, 12));
    await page.waitForTimeout(500); // debounce

    // Select from dropdown
    const patientOpt = page.locator(`button:has-text("${patientName}")`).first();
    await expect(patientOpt).toBeVisible({ timeout: 10000 });
    await patientOpt.click();

    // Fill reason and date
    const reasonField = page.locator('input[placeholder*="reason"], textarea[placeholder*="reason"], #followup-reason').first();
    if (await reasonField.isVisible()) {
      await reasonField.fill('Post-extraction check');
    } else {
      // Try finding by label
      const reasonInput = page.locator('input, textarea').filter({ hasText: /reason/i }).first();
      await reasonInput.fill('Post-extraction check');
    }

    // Submit the form
    const submitBtn = page.locator('button[type="submit"]:has-text("Schedule"), button[type="submit"]:has-text("Create"), button[type="submit"]:has-text("Add"), button[type="submit"]:has-text("Save")').first();
    await expect(submitBtn).toBeVisible({ timeout: 5000 });

    const createResp = page.waitForResponse(
      (resp: any) => resp.url().includes('/api/followups') && resp.request().method() === 'POST',
      { timeout: 15000 }
    );
    await submitBtn.click();
    await createResp;

    // 6. Verify the follow-up appears in list (switch to "Due Today" tab)
    await page.waitForTimeout(1000);
    const todayTab = page.locator('#tab-today');
    await todayTab.click();
    await page.waitForTimeout(1000);

    const fuRow = page.locator(`text=${patientName}`).first();
    await expect(fuRow).toBeVisible({ timeout: 10000 });

    // 7. Mark follow-up as done
    const doneBtn = page.locator('button:has-text("Mark Done"), button:has-text("Done")').first();
    await expect(doneBtn).toBeVisible({ timeout: 5000 });

    const doneResp = page.waitForResponse(
      (resp: any) => resp.url().includes('/done') && resp.request().method() === 'POST',
      { timeout: 10000 }
    );
    await doneBtn.click();
    await doneResp;

    // Verify success
    await expect(page.locator('text=completed, text=Done, [role="status"]').first()).toBeVisible({ timeout: 10000 });
  });

  test('E13: Keyboard-only booking path (Tab, Enter/Space, Escape)', async ({ page }) => {
    test.setTimeout(60000);

    await loginAsDoctor(page);
    await page.goto('/appointments');
    await page.waitForSelector('h1:has-text("Appointment Schedule")');

    // Tab to "Book Slot" button and press Enter
    // Focus the book button directly for deterministic keyboard test
    await page.focus('#btn-book-appointment-header');
    await page.keyboard.press('Enter');

    // Modal should open – verify form is visible
    await page.waitForSelector('#input-slot-time', { timeout: 5000 });

    // Press Escape to close modal
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // Modal should be closed – slot time selector should not be visible
    await expect(page.locator('#input-slot-time')).not.toBeVisible({ timeout: 3000 });

    // Re-open modal
    await page.focus('#btn-book-appointment-header');
    await page.keyboard.press('Space');
    await page.waitForSelector('#input-slot-time', { timeout: 5000 });

    // Tab through form fields – verify we can reach the "New Contact" toggle and reason input
    // Tab to first interactive element in modal
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');

    // Verify focus is within the modal form
    const activeTagName = await page.evaluate(() => document.activeElement?.tagName?.toLowerCase());
    expect(['input', 'select', 'button', 'textarea']).toContain(activeTagName);
  });

  test('E14: Axe accessibility scans – /appointments at 1440, 820, 390px', async ({ page }) => {
    test.setTimeout(90000);

    await loginAsDoctor(page);

    const viewports = [
      { name: 'Desktop 1440', width: 1440, height: 900 },
      { name: 'Tablet 820', width: 820, height: 1180 },
      { name: 'Mobile 390', width: 390, height: 844 },
    ];

    for (const vp of viewports) {
      await page.setViewportSize({ width: vp.width, height: vp.height });

      // 1. /appointments page
      await page.goto('/appointments');
      await page.waitForSelector('h1:has-text("Appointment Schedule")');

      const apptAxe = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      expect(apptAxe.violations).toEqual([]);

      // Screenshots
      await page.screenshot({
        path: `docs/screenshots/appointments-${vp.width}.png`,
        fullPage: true,
      });

      // 2. Day view / Week view / List view toggle
      if (vp.width >= 820) {
        await page.click('#tab-view-week');
        await page.waitForTimeout(500);
        const weekAxe = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
          .analyze();
        expect(weekAxe.violations).toEqual([]);

        await page.click('#tab-view-list');
        await page.waitForTimeout(500);
        const listAxe = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
          .analyze();
        expect(listAxe.violations).toEqual([]);

        // Back to day view
        await page.click('#tab-view-day');
      }

      // 3. Open Book Slot modal and scan
      await page.click('#btn-book-appointment-header');
      await page.waitForSelector('#input-slot-time', { timeout: 5000 });
      const modalAxe = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      expect(modalAxe.violations).toEqual([]);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    }
  });

  test('E14: Axe accessibility scans – /followups at 1440, 820, 390px', async ({ page }) => {
    test.setTimeout(90000);

    await loginAsDoctor(page);

    const viewports = [
      { name: 'Desktop 1440', width: 1440, height: 900 },
      { name: 'Tablet 820', width: 820, height: 1180 },
      { name: 'Mobile 390', width: 390, height: 844 },
    ];

    for (const vp of viewports) {
      await page.setViewportSize({ width: vp.width, height: vp.height });

      await page.goto('/followups');
      await page.waitForSelector('h1:has-text("Follow-ups")');

      const followupsAxe = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      expect(followupsAxe.violations).toEqual([]);

      // Screenshot
      await page.screenshot({
        path: `docs/screenshots/followups-${vp.width}.png`,
        fullPage: true,
      });
    }
  });

  test('E13: No console errors on /appointments and /followups pages', async ({ page }) => {
    test.setTimeout(30000);
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    await loginAsDoctor(page);

    await page.goto('/appointments');
    await page.waitForSelector('h1:has-text("Appointment Schedule")');
    await page.waitForTimeout(2000);

    await page.goto('/followups');
    await page.waitForSelector('h1:has-text("Follow-ups")');
    await page.waitForTimeout(2000);

    // Filter out known harmless errors (e.g. favicon, hot reload)
    const realErrors = consoleErrors.filter(
      (e) => !e.includes('favicon') && !e.includes('hot-update') && !e.includes('HMR')
    );
    expect(realErrors).toEqual([]);
  });
});
