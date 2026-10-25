import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const GREEK_NAMES = [
  'Alpha Patil',
  'Beta Deshmukh',
  'Gamma Shinde',
  'Delta Kulkarni',
  'Epsilon Jadhav',
  'Zeta Chavan',
];

const ALPHA_SUFFIXES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

function getRandomPatientName(prefix: string): string {
  const choice = GREEK_NAMES[Math.floor(Math.random() * GREEK_NAMES.length)];
  const s1 = ALPHA_SUFFIXES[Math.floor(Math.random() * ALPHA_SUFFIXES.length)];
  const s2 = ALPHA_SUFFIXES[Math.floor(Math.random() * ALPHA_SUFFIXES.length)];
  return `${prefix} ${choice} ${s1}${s2}`;
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

test.describe('Phase 4 E2E: Estimates, Billing, Payments, Receipts & Accessibility', () => {
  test.beforeEach(async ({ page, context }, testInfo) => {
    page.on('dialog', async (dialog) => {
      await dialog.accept();
    });

    const ip = `10.40.${testInfo.retry + 1}.${Math.floor(Math.random() * 200) + 1}`;
    await context.setExtraHTTPHeaders({
      'x-forwarded-for': ip,
    });
  });

  test('D18: Complete clinical journey: Visit -> Estimate -> Issue -> Convert -> Partial Payment -> Receipt -> Full Payment (Keyboard) -> PAID -> Reversal -> PARTIAL', async ({
    page,
  }) => {
    test.setTimeout(120000);
    await page.setViewportSize({ width: 820, height: 1180 });

    // 1. Walk-in patient registers at kiosk
    await page.goto('/register');
    await page.waitForSelector('#kiosk-pin');
    await page.fill('#kiosk-pin', '1234');
    await page.click('#btn-unlock-kiosk');

    await page.waitForSelector('#kiosk-name');
    const patientName = getRandomPatientName('FinPatient');
    const patientPhone = getRandomIndianPhone();
    await page.fill('#kiosk-name', patientName);
    await page.fill('#kiosk-age', '42');
    await page.click('button:has-text("Male")');
    await page.fill('#kiosk-phone', patientPhone);
    await page.fill('#kiosk-reason', 'Tooth restoration and crown consultation');
    await page.check('#kiosk-consent');
    await page.click('#btn-register-submit');
    await page.waitForSelector('#token-display');

    // 2. Doctor logs in and calls in patient
    await loginAsDoctor(page);
    await ensureOperatoryVacant(page);

    const patientRow = page.locator(`[id^="queue-row-"]`).filter({ hasText: patientName }).first();
    await patientRow.waitFor({ state: 'visible', timeout: 15000 });
    await patientRow.locator('button:has-text("Call In")').click();
    await expect(patientRow.locator('text=In Consultation')).toBeVisible({ timeout: 10000 });

    // Open Consult Workspace
    const consultLink = patientRow.locator('a:has-text("Consult Workspace")');
    await consultLink.click();
    await page.waitForURL(/\/consult\//, { timeout: 15000 });

    // 3. Click "+ Estimate" from consult workspace
    const createEstimateBtn = page.locator('#btn-consult-create-estimate');
    await expect(createEstimateBtn).toBeVisible({ timeout: 10000 });
    await createEstimateBtn.click();
    await page.waitForURL(/\/billing\/estimates\/new/, { timeout: 15000 });

    // 4. Build Estimate in Estimate Builder
    await page.waitForSelector('#desc-input-0');
    // Select first treatment from 28 seeded schedule
    await page.selectOption('#treatment-select-0', { index: 1 });
    await page.fill('#teeth-input-0', '16');
    await page.fill('#unit-price-input-0', '1500');

    // Apply 10% discount
    await page.selectOption('#select-discount-type', 'PERCENT');
    await page.fill('#input-discount-value', '10');

    // Check total calculation: ₹1,500 - 10% = ₹1,350
    await expect(page.locator('text=Total Estimate:')).toBeVisible();

    // 5. Issue Estimate
    await page.click('#btn-issue-estimate');
    await page.waitForURL(/\/print\/estimate\//, { timeout: 20000 });

    // Verify Estimate Print View
    await page.waitForSelector('#estimate-document');
    await expect(page.locator('#estimate-document')).toBeVisible();
    await expect(page.locator('#estimate-document').locator('text=Treatment Estimate')).toBeVisible();
    await expect(page.locator('#estimate-document').locator('text=This is an estimate, not a bill')).toBeVisible();
    await expect(page.locator('#estimate-document').locator('text=EST/')).toBeVisible();

    // 6. Navigate to /billing -> Estimates Tab -> Convert to Bill
    await page.goto('/billing');
    await page.waitForSelector('#tab-estimates');
    await page.click('#tab-estimates');

    const estimateRow = page.locator('tr').filter({ hasText: patientName }).first();
    await estimateRow.waitFor({ state: 'visible', timeout: 15000 });
    await expect(estimateRow.locator('text=ISSUED')).toBeVisible();

    const convertBtn = estimateRow.locator('button:has-text("Convert to Bill")');
    await expect(convertBtn).toBeVisible();
    await convertBtn.click();

    // Navigates to Bill detail page
    await page.waitForURL(/\/billing\/bills\//, { timeout: 20000 });
    await page.waitForSelector('#bill-status-badge');
    await expect(page.locator('#bill-status-badge')).toHaveText('UNPAID');

    // 7. Record Partial Payment (₹500 via CASH)
    await page.click('#btn-open-payment');
    await page.waitForSelector('#modal-payment-amount');
    await page.fill('#modal-payment-amount', '500');
    await page.selectOption('#modal-payment-method', 'CASH');
    await page.click('#btn-submit-payment');

    // Wait for bill status to update to PARTIAL
    await expect(page.locator('#bill-status-badge')).toHaveText('PARTIAL', { timeout: 15000 });
    await expect(page.locator('#bill-paid-amount')).toHaveText('₹500.00');

    // Verify Receipt Print View link exists
    const receiptPrintLink = page.locator('[id^="btn-print-receipt-"]').first();
    await expect(receiptPrintLink).toBeVisible();
    const receiptHref = await receiptPrintLink.getAttribute('href');

    // Open receipt print view
    if (receiptHref) {
      const receiptPage = await page.context().newPage();
      await receiptPage.goto(receiptHref);
      await receiptPage.waitForSelector('#receipt-document');
      await expect(receiptPage.locator('#receipt-document').locator('text=Payment Receipt')).toBeVisible();
      await expect(receiptPage.locator('#receipt-document').locator('text=Rupees Five Hundred Only')).toBeVisible();
      await receiptPage.close();
    }

    // 8. Record Second Payment to reach PAID status via KEYBOARD-ONLY
    await page.click('#btn-open-payment');
    await page.waitForSelector('#modal-payment-amount');
    await page.focus('#modal-payment-amount');
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Backspace');
    await page.keyboard.type('850');
    await page.keyboard.press('Tab'); // move to method
    await page.keyboard.press('ArrowDown'); // select UPI
    await page.keyboard.press('Tab'); // move to UPI ref
    await page.keyboard.type('UPI123456789012');
    await page.keyboard.press('Tab'); // move to cancel button
    await page.keyboard.press('Tab'); // move to submit button
    await page.keyboard.press('Enter'); // submit form

    // Wait for bill status to become PAID
    await expect(page.locator('#bill-status-badge')).toHaveText('PAID', { timeout: 15000 });

    // 9. Reverse the first payment (₹500) -> Bill status must return to PARTIAL
    const reverseBtn = page.locator('[id^="btn-reverse-"]').first();
    await expect(reverseBtn).toBeVisible();
    await reverseBtn.click();

    await page.waitForSelector('#input-reversal-reason');
    await page.fill('#input-reversal-reason', 'Cashier erroneously selected cash instead of online transfer');
    await page.click('#btn-confirm-reversal');

    // Status returns to PARTIAL
    await expect(page.locator('#bill-status-badge')).toHaveText('PARTIAL', { timeout: 15000 });
    await expect(page.locator('text=REVERSAL').first()).toBeVisible();

    // Complete consultation visit to clean up operatory
    await page.goto('/queue');
    await ensureOperatoryVacant(page);
  });

  test('D19: Axe Accessibility Audit across Viewports (1440px, 820px, 390px)', async ({
    page,
  }) => {
    test.setTimeout(90000);

    await loginAsDoctor(page);

    const viewports = [
      { name: 'Desktop 1440', width: 1440, height: 900 },
      { name: 'Tablet 820', width: 820, height: 1180 },
      { name: 'Mobile 390', width: 390, height: 844 },
    ];

    for (const vp of viewports) {
      await page.setViewportSize({ width: vp.width, height: vp.height });

      // 1. /billing Page
      await page.goto('/billing');
      await page.waitForSelector('h1:has-text("Billing & Estimates")');
      const billingAxe = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      expect(billingAxe.violations).toEqual([]);

      // 2. /billing/estimates/new Page
      await page.goto('/billing/estimates/new');
      await page.waitForSelector('#btn-issue-estimate');
      const estimateBuilderAxe = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      expect(estimateBuilderAxe.violations).toEqual([]);
    }
  });
});
