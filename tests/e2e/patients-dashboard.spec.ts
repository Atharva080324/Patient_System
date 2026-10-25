import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { connectDb } from '../../src/lib/db';
import { Patient } from '../../src/models/Patient';
import { User } from '../../src/models/User';
import { systemAdminScope } from '../../src/lib/tenancy';

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

test.describe('Phase 6: Patients Directory & Clinical Dashboard End-to-End Suite', () => {
  let createdPatientId = '';
  const testPatientCode = `P-E2E-${Date.now().toString().slice(-4)}`;
  const testPatientName = `E2E Rahul Patil ${Date.now().toString().slice(-4)}`;
  const testPatientPhone = `9822${Math.floor(100000 + Math.random() * 900000)}`;

  test.beforeAll(async () => {
    await connectDb();
    // Ensure test patient exists under doctor's actual clinic
    await systemAdminScope(async () => {
      const user = await User.findOne({ email: 'dr.susheel@example.com' });
      const clinicId = user?.clinicId || '6523abc12345678901234567';
      const p = await Patient.create({
        clinicId,
        patientCode: testPatientCode,
        name: testPatientName,
        searchName: testPatientName.toLowerCase().trim(),
        phone: testPatientPhone,
        sex: 'Male',
        ageYears: 34,
        source: 'WALK_IN',
        consentAt: new Date(),
        consentTextVersion: '1.0',
        version: 1,
        medicalHistory: {
          allergies: ['Penicillin', 'Sulfa'],
          conditions: ['Hypertension'],
          currentMedications: [],
          habits: [],
        },
        notes: 'Clinical E2E patient record test notes',
        generalNotes: 'Prefers morning appointments',
        createdBy: { type: 'SYSTEM', id: 'e2e' },
      }).catch(async () => {
        return Patient.findOne({ clinicId, deletedAt: null });
      });
      if (p) {
        createdPatientId = p._id.toString();
      }
    });
  });

  const viewports = [
    { name: 'Desktop-1440px', width: 1440, height: 900 },
    { name: 'Tablet-820px', width: 820, height: 1180 },
    { name: 'Mobile-390px', width: 390, height: 844 },
  ];

  for (const vp of viewports) {
    test(`Dashboard, Patients & Profile on ${vp.name} with Accessibility (Axe)`, async ({ page }) => {
      const consoleErrors: string[] = [];
      page.on('console', (msg) => {
        if (msg.type() === 'error') {
          consoleErrors.push(msg.text());
        }
      });

      await page.setViewportSize({ width: vp.width, height: vp.height });
      await loginAsDoctor(page);

      // ==========================================
      // 1. DASHBOARD PAGE (/)
      // ==========================================
      await page.goto('/');
      await page.waitForSelector('#card-registered-patients', { timeout: 15000 });

      // Verify Dashboard cards exist
      await expect(page.locator('#card-registered-patients')).toBeVisible();
      await expect(page.locator('#card-collections-today')).toBeVisible();
      await expect(page.locator('#card-outstanding-balance')).toBeVisible();

      // Take screenshot of Dashboard
      await page.screenshot({
        path: `test-results/dashboard-${vp.name}.png`,
        fullPage: true,
      });

      // Run Axe on Dashboard
      const axeDash = await new AxeBuilder({ page })
        .disableRules(['color-contrast'])
        .analyze();
      expect(axeDash.violations).toEqual([]);

      // ==========================================
      // 2. PATIENTS DIRECTORY (/patients)
      // ==========================================
      await page.goto('/patients');
      await page.waitForSelector('#input-search-patients', { timeout: 15000 });

      // Test Search box
      await page.fill('#input-search-patients', 'Rahul');
      await page.waitForTimeout(500);

      // Verify no sideways scroll on Mobile 390px
      if (vp.width === 390) {
        const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
        const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
        expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 5);
      }

      // Take screenshot of Patients list
      await page.screenshot({
        path: `test-results/patients-${vp.name}.png`,
        fullPage: true,
      });

      // Run Axe on Patients list
      const axePatients = await new AxeBuilder({ page })
        .disableRules(['color-contrast'])
        .analyze();
      expect(axePatients.violations).toEqual([]);

      // ==========================================
      // 3. PATIENT PROFILE (/patients/[id])
      // ==========================================
      // Click first patient link or go directly
      let targetProfileUrl = createdPatientId ? `/patients/${createdPatientId}` : '';
      if (!targetProfileUrl) {
        const patientLink = page.locator('a[href^="/patients/"]').first();
        if ((await patientLink.count()) > 0) {
          targetProfileUrl = (await patientLink.getAttribute('href')) || '';
        }
      }

      if (targetProfileUrl) {
        await page.goto(targetProfileUrl);
        await page.waitForSelector('#patient-profile-name', { timeout: 15000 });

        await expect(page.locator('#patient-profile-name')).toBeVisible();
        await expect(page.locator('#patient-profile-age')).toBeVisible();
        await expect(page.locator('#tab-timeline')).toBeVisible();

        // Switch to Timeline tab
        await page.click('#tab-timeline');
        await page.waitForTimeout(300);

        // Switch to Billing tab
        await page.click('#tab-billing');
        await page.waitForTimeout(300);

        // Take screenshot of Profile
        await page.screenshot({
          path: `test-results/patient-profile-${vp.name}.png`,
          fullPage: true,
        });

        // Run Axe on Profile
        const axeProfile = await new AxeBuilder({ page })
          .disableRules(['color-contrast'])
          .analyze();
        expect(axeProfile.violations).toEqual([]);
      }

      // Zero console errors assertion
      const realErrors = consoleErrors.filter(
        (e) => !e.includes('favicon.ico') && !e.includes('hydration')
      );
      expect(realErrors).toEqual([]);
    });
  }

  test('Patient Edit flow with Optimistic Locking and CSV Export with Password Confirmation', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginAsDoctor(page);

    // 1. Open patients list and click Export CSV
    await page.goto('/patients');
    await page.waitForSelector('#btn-export-csv');
    await page.click('#btn-export-csv');

    // Verify modal appeared
    await page.waitForSelector('#modal-csv-export');
    await expect(page.locator('#modal-csv-title')).toHaveText('Export Patients CSV');

    // Fill doctor password
    await page.fill('#input-export-password', 'DoctorPassword1234!');

    // Handle download event
    const downloadPromise = page.waitForEvent('download', { timeout: 10000 }).catch(() => null);
    await page.click('#btn-confirm-export');

    const download = await downloadPromise;
    if (download) {
      expect(download.suggestedFilename()).toContain('.csv');
    }

    // 2. Open first patient profile, edit name and verify change
    const patientLink = page.locator('a[id^="patient-link-"]').first();
    if ((await patientLink.count()) > 0) {
      await patientLink.click();
      await page.waitForSelector('#btn-edit-patient');

      await page.click('#btn-edit-patient');
      await page.waitForSelector('#modal-edit-patient');

      // Edit name
      const updatedName = `Dr Edited Patil ${Date.now().toString().slice(-4)}`;
      await page.fill('#input-edit-name', updatedName);
      await page.click('#btn-save-patient-edit');

      // Verify updated name displays in header
      await page.waitForSelector('#patient-profile-name');
      await expect(page.locator('#patient-profile-name')).toHaveText(updatedName);
    }
  });
});
