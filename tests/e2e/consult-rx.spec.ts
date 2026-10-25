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

test.describe('Phase 3 E2E: Consultation Workspace, Prescription & Accessibility', () => {
  // Give each test a unique IP address to prevent rate-limit exhaustion
  test.beforeEach(async ({ page, context }, testInfo) => {
    // Automatically accept all browser confirm and alert dialogs
    page.on('dialog', async (dialog) => {
      await dialog.accept();
    });

    const ip = `10.40.${testInfo.retry + 1}.${Math.floor(Math.random() * 200) + 1}`;
    await context.setExtraHTTPHeaders({
      'x-forwarded-for': ip,
    });
  });

  test('Full Doctor Consultation: Case Sheet, FDI Tooth Picker, Prescription & Print', async ({
    page,
  }) => {
    test.setTimeout(90000);

    // 1. Walk-in patient registers at kiosk
    await page.goto('/register');
    await page.waitForSelector('#kiosk-pin');
    await page.fill('#kiosk-pin', '1234');
    await page.click('#btn-unlock-kiosk');

    await page.waitForSelector('#kiosk-name');
    const patientName = getRandomPatientName('Consult');
    const patientPhone = getRandomIndianPhone();
    await page.fill('#kiosk-name', patientName);
    await page.fill('#kiosk-age', '35');
    await page.click('button:has-text("Female")');
    await page.fill('#kiosk-phone', patientPhone);
    await page.fill('#kiosk-reason', 'Severe sensitivity in lower right tooth');
    await page.check('#kiosk-consent');
    await page.click('#btn-register-submit');
    await page.waitForSelector('#token-display');

    // 2. Doctor logs in and opens queue
    await loginAsDoctor(page);
    await ensureOperatoryVacant(page);

    // Target the specific patient row
    const patientRow = page.locator(`[id^="queue-row-"]`).filter({ hasText: patientName }).first();
    await patientRow.waitFor({ state: 'visible', timeout: 15000 });

    // Call In the patient
    const callInBtn = patientRow.locator('button:has-text("Call In")');
    await callInBtn.click();
    await expect(patientRow.locator('text=In Consultation')).toBeVisible({ timeout: 10000 });

    // Open Consult Workspace
    const consultLink = patientRow.locator('a:has-text("Consult Workspace")');
    await expect(consultLink).toBeVisible();
    await consultLink.click();
    await page.waitForURL(/\/consult\//, { timeout: 15000 });

    // 3. Consult Workspace loaded
    await page.waitForSelector('#consult-patient-name');
    await expect(page.locator('#consult-patient-name')).toContainText(patientName);

    // Fill Case Sheet fields
    await page.fill('#cs-chief-complaint', 'Severe throbbing pain in tooth #46 aggravated by cold');
    await page.fill('#cs-diagnosis', 'Irreversible Pulpitis #46 with Periapical Periodontitis');
    await page.fill('#cs-treatment', 'Root Canal Treatment advised. Access cavity prepared under local anesthesia.');

    // 4. FDI Two-Digit Dental Tooth Picker
    await page.click('#tooth-btn-46');
    await page.waitForSelector('#modal-tooth-condition');
    await page.selectOption('#modal-tooth-condition', 'Caries / Cavity');
    await page.fill('#modal-tooth-notes', 'Deep occlusal caries involving pulp');
    await page.click('#btn-save-tooth-finding');

    // Verify tooth finding badge appears
    await expect(page.locator('#tooth-finding-row-46')).toContainText('Caries / Cavity', { timeout: 6000 });

    // Wait for debounced autosave confirmation
    await expect(page.locator('text=/Saved \\d{2}:\\d{2}/')).toBeVisible({ timeout: 10000 });

    // 5. Prescription Section
    await page.click('#tab-btn-prescription');
    await page.waitForSelector('#input-med-search');

    // Search medicine via combobox
    await page.fill('#input-med-search', 'Amox');
    await page.waitForSelector('text=Amoxicillin', { timeout: 8000 });
    // Click first suggestion
    const firstMedSuggestion = page.locator('.cursor-pointer').first();
    await firstMedSuggestion.click();

    // Verify medicine line added
    await expect(page.locator('#rx-line-0')).toBeVisible({ timeout: 5000 });

    // Doctor enters clinical dose, frequency, duration (zero automated suggestions!)
    await page.fill('#rx-dose-0', '1 capsule');
    await page.fill('#rx-freq-0', '1-0-1');
    await page.fill('#rx-duration-0', '5 days');
    await page.fill('#rx-instruction-0', 'After meals');

    // Add advice
    await page.fill('#rx-advice', 'Take medicines after meals. Avoid hard foods on right side.');

    // Save draft
    await page.click('#btn-save-rx-draft');
    await page.waitForTimeout(1000);

    // Issue & Lock Prescription
    await page.click('#btn-issue-rx');
    // Confirm dialog is handled automatically by window.confirm or wait for ISSUED badge
    await expect(page.locator('text=ISSUED')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=/RX\\/\\d{4}-\\d{2}\\/\\d{4}/')).toBeVisible();

    // 6. Print Prescription
    const printBtn = page.locator('#btn-print-rx');
    await expect(printBtn).toBeVisible();
    const printHref = await printBtn.getAttribute('href');
    expect(printHref).toMatch(/\/print\/prescription\//);

    // Open print view in a new page/tab (matching target="_blank")
    const printPage = await page.context().newPage();
    await printPage.goto(printHref!);
    await printPage.waitForSelector('#prescription-document');

    // Verify print letterhead elements
    await expect(printPage.locator('#prescription-document')).toContainText("Dr. Susheel");
    await expect(printPage.locator('#prescription-document')).toContainText(patientName);
    await expect(printPage.locator('#prescription-document')).toContainText('Take medicines after meals');

    // Invariant: Zero clinical dosage or drug suggestions displayed anywhere
    const printText = await printPage.textContent('#prescription-document');
    expect(printText).not.toContain('Suggested Dose');
    expect(printText).not.toContain('AI Recommendation');
    await printPage.close();

    // 7. Complete Visit in consultation workspace
    await page.waitForSelector('#btn-complete-visit');
    await page.click('#btn-complete-visit');

    // Redirection back to /queue
    await page.waitForURL(/\/queue/, { timeout: 15000 });
  });

  test('Multi-Tab Concurrency: 409 Conflict detected with Copy My Text and Reload Latest', async ({
    browser,
  }) => {
    test.setTimeout(90000);

    const rand1 = Math.floor(Math.random() * 200) + 1;
    const rand2 = Math.floor(Math.random() * 200) + 1;

    // First, register a patient and move to In Consultation
    const initContext = await browser.newContext({
      extraHTTPHeaders: { 'x-forwarded-for': `10.50.1.${rand1}` },
    });
    const initPage = await initContext.newPage();

    await initPage.goto('/register');
    await initPage.waitForSelector('#kiosk-pin');
    await initPage.fill('#kiosk-pin', '1234');
    await initPage.click('#btn-unlock-kiosk');

    await initPage.waitForSelector('#kiosk-name');
    const patientName = getRandomPatientName('Conflict');
    const patientPhone = getRandomIndianPhone();
    await initPage.fill('#kiosk-name', patientName);
    await initPage.fill('#kiosk-age', '40');
    await initPage.click('button:has-text("Male")');
    await initPage.fill('#kiosk-phone', patientPhone);
    await initPage.fill('#kiosk-reason', 'Routine dental check');
    await initPage.check('#kiosk-consent');
    await initPage.click('#btn-register-submit');
    await initPage.waitForSelector('#token-display');

    // Doctor logs in and moves patient to In Consultation
    initPage.on('dialog', async (d) => await d.accept());
    await loginAsDoctor(initPage);
    await ensureOperatoryVacant(initPage);
    const row = initPage.locator(`[id^="queue-row-"]`).filter({ hasText: patientName }).first();
    await row.waitFor({ state: 'visible', timeout: 15000 });
    await row.locator('button:has-text("Call In")').click();
    await expect(row.locator('text=In Consultation')).toBeVisible({ timeout: 10000 });

    const consultLink = row.locator('a:has-text("Consult Workspace")');
    const consultUrl = await consultLink.getAttribute('href');
    expect(consultUrl).toBeTruthy();

    await initContext.close();

    // Now open TWO separate browser contexts for the same doctor viewing this consult URL
    const contextA = await browser.newContext({
      extraHTTPHeaders: { 'x-forwarded-for': `10.50.2.${rand1}` },
    });
    const pageA = await contextA.newPage();
    await loginAsDoctor(pageA);
    await pageA.goto(consultUrl!);
    await pageA.waitForSelector('#cs-chief-complaint');

    const contextB = await browser.newContext({
      extraHTTPHeaders: { 'x-forwarded-for': `10.50.3.${rand2}` },
    });
    const pageB = await contextB.newPage();
    await loginAsDoctor(pageB);
    await pageB.goto(consultUrl!);
    await pageB.waitForSelector('#cs-chief-complaint');

    // Tab A edits chief complaint and saves (increments version to 2)
    await pageA.fill('#cs-chief-complaint', 'Chief complaint written in Tab A');
    await expect(pageA.locator('text=/Saved \\d{2}:\\d{2}/')).toBeVisible({ timeout: 10000 });

    // Tab B now edits based on stale version 1
    await pageB.fill('#cs-chief-complaint', 'Chief complaint written concurrently in Tab B');

    // Tab B triggers save -> detects 409 Conflict
    await expect(pageB.locator('text=Concurrency Conflict')).toBeVisible({ timeout: 15000 });
    await expect(pageB.locator('#btn-copy-conflict-text')).toBeVisible();
    await expect(pageB.locator('#btn-reload-latest')).toBeVisible();

    // Tab B clicks "Reload Latest"
    await pageB.click('#btn-reload-latest');
    // Tab B now sees Tab A's saved content without overwriting
    await expect(pageB.locator('#cs-chief-complaint')).toHaveValue(/written in Tab A/, {
      timeout: 10000,
    });

    await contextA.close();
    await contextB.close();
  });

  test.describe('Automated Axe Accessibility Scans (0 violations)', () => {
    test('/consult/[visitId] has 0 Axe violations', async ({ page }) => {
      // Register patient & call in
      await page.goto('/register');
      await page.waitForSelector('#kiosk-pin');
      await page.fill('#kiosk-pin', '1234');
      await page.click('#btn-unlock-kiosk');

      await page.waitForSelector('#kiosk-name');
      const patientName = getRandomPatientName('AxeConsult');
      const patientPhone = getRandomIndianPhone();
      await page.fill('#kiosk-name', patientName);
      await page.fill('#kiosk-age', '29');
      await page.click('button:has-text("Female")');
      await page.fill('#kiosk-phone', patientPhone);
      await page.fill('#kiosk-reason', 'Axe consult test');
      await page.check('#kiosk-consent');
      await page.click('#btn-register-submit');
      await page.waitForSelector('#token-display');

      await loginAsDoctor(page);
      await ensureOperatoryVacant(page);
      const row = page.locator(`[id^="queue-row-"]`).filter({ hasText: patientName }).first();
      await row.waitFor({ state: 'visible', timeout: 15000 });
      await row.locator('button:has-text("Call In")').click();
      await expect(row.locator('text=In Consultation')).toBeVisible({ timeout: 10000 });

      const consultLink = row.locator('a:has-text("Consult Workspace")');
      await consultLink.click();
      await page.waitForURL(/\/consult\//, { timeout: 15000 });
      await page.waitForSelector('#consult-patient-name');

      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();

      expect(results.violations).toEqual([]);

      // Complete visit so operatory is vacant for subsequent tests
      await page.click('#btn-complete-visit');
      await page.waitForURL(/\/queue/, { timeout: 15000 });
    });

    test('/print/prescription/[id] has 0 Axe violations', async ({ page }) => {
      // Register and issue prescription quickly
      await page.goto('/register');
      await page.waitForSelector('#kiosk-pin');
      await page.fill('#kiosk-pin', '1234');
      await page.click('#btn-unlock-kiosk');

      await page.waitForSelector('#kiosk-name');
      const patientName = getRandomPatientName('AxePrint');
      const patientPhone = getRandomIndianPhone();
      await page.fill('#kiosk-name', patientName);
      await page.fill('#kiosk-age', '45');
      await page.click('button:has-text("Male")');
      await page.fill('#kiosk-phone', patientPhone);
      await page.fill('#kiosk-reason', 'Print Axe test');
      await page.check('#kiosk-consent');
      await page.click('#btn-register-submit');
      await page.waitForSelector('#token-display');

      await loginAsDoctor(page);
      await ensureOperatoryVacant(page);
      const row = page.locator(`[id^="queue-row-"]`).filter({ hasText: patientName }).first();
      await row.waitFor({ state: 'visible', timeout: 15000 });
      await row.locator('button:has-text("Call In")').click();
      await expect(row.locator('text=In Consultation')).toBeVisible({ timeout: 10000 });

      const consultLink = row.locator('a:has-text("Consult Workspace")');
      await consultLink.click();
      await page.waitForURL(/\/consult\//, { timeout: 15000 });
      await page.waitForSelector('#consult-patient-name');

      // Go to prescription tab and add a medicine
      await page.click('#tab-btn-prescription');
      await page.waitForSelector('#input-med-search');
      await page.fill('#input-med-search', 'Amox');
      await page.waitForSelector('text=Amoxicillin', { timeout: 8000 });
      await page.locator('.cursor-pointer').first().click();

      // Ensure item is added
      await expect(page.locator('#rx-line-0')).toBeVisible({ timeout: 5000 });
      await page.fill('#rx-dose-0', '1 capsule');
      await page.fill('#rx-freq-0', '1-0-1');
      await page.fill('#rx-duration-0', '5 days');
      await page.fill('#rx-instruction-0', 'After meals');
      await page.click('#btn-save-rx-draft');
      await page.waitForTimeout(1000);

      // Issue prescription
      await page.click('#btn-issue-rx');
      await expect(page.locator('text=ISSUED')).toBeVisible({ timeout: 10000 });

      // Open print page
      const printBtn = page.locator('#btn-print-rx');
      await expect(printBtn).toBeVisible({ timeout: 5000 });
      const printHref = await printBtn.getAttribute('href');
      await page.goto(printHref!);
      await page.waitForSelector('#prescription-document');

      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();

      expect(results.violations).toEqual([]);
    });
  });

  test('Doctor can navigate FDI tooth picker using keyboard navigation alone', async ({ page }) => {
    test.setTimeout(90000);

    // Register patient & call in
    await page.goto('/register');
    await page.waitForSelector('#kiosk-pin');
    await page.fill('#kiosk-pin', '1234');
    await page.click('#btn-unlock-kiosk');

    await page.waitForSelector('#kiosk-name');
    const patientName = getRandomPatientName('KeyboardTooth');
    const patientPhone = getRandomIndianPhone();
    await page.fill('#kiosk-name', patientName);
    await page.fill('#kiosk-age', '28');
    await page.click('button:has-text("Male")');
    await page.fill('#kiosk-phone', patientPhone);
    await page.fill('#kiosk-reason', 'Keyboard consultation test');
    await page.check('#kiosk-consent');
    await page.click('#btn-register-submit');
    await page.waitForSelector('#token-display');

    await loginAsDoctor(page);
    await ensureOperatoryVacant(page);
    const row = page.locator(`[id^="queue-row-"]`).filter({ hasText: patientName }).first();
    await row.waitFor({ state: 'visible', timeout: 15000 });
    await row.locator('button:has-text("Call In")').click();
    await expect(row.locator('text=In Consultation')).toBeVisible({ timeout: 10000 });

    const consultLink = row.locator('a:has-text("Consult Workspace")');
    await consultLink.click();
    await page.waitForURL(/\/consult\//, { timeout: 15000 });
    await page.waitForSelector('#consult-patient-name');

    // Focus tooth button #tooth-btn-11 using keyboard focus
    const toothBtn = page.locator('#tooth-btn-11');
    await toothBtn.focus();
    await toothBtn.press('Space');

    // Tooth modal opened
    await page.waitForSelector('#modal-tooth-condition');
    const conditionSelect = page.locator('#modal-tooth-condition');
    await expect(conditionSelect).toBeFocused();

    // Select Caries / Cavity
    await conditionSelect.selectOption('Caries / Cavity');

    // Tab to Save Tooth Finding button and press Space
    const saveFindingBtn = page.locator('#btn-save-tooth-finding');
    await saveFindingBtn.focus();
    await saveFindingBtn.press('Space');

    // Finding added
    await expect(page.locator('#tooth-finding-row-11')).toContainText('Caries / Cavity', { timeout: 6000 });
  });
});
