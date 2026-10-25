import { chromium } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import mongoose from 'mongoose';
import { connectDb } from '../src/lib/db';
import { runWithTenantContext, systemAdminScope } from '../src/lib/tenancy';
import { Clinic } from '../src/models/Clinic';
import { User } from '../src/models/User';
import { Patient } from '../src/models/Patient';
import { Estimate } from '../src/models/Estimate';
import { Bill } from '../src/models/Bill';
import { Payment } from '../src/models/Payment';
import { createEstimateDraft, issueEstimate } from '../src/lib/estimate-service';
import { createBill } from '../src/lib/bill-service';
import { recordPayment, reversePayment } from '../src/lib/payment-service';
import { asPaise } from '../src/lib/money';

async function main() {
  console.log('Connecting to database...');
  await connectDb();

  const clinic = await systemAdminScope(async () => {
    return await Clinic.findOne({}).lean();
  });
  if (!clinic) throw new Error('No clinic found');
  const clinicId = clinic._id;

  const { user, patient } = await systemAdminScope(async () => {
    const u = await User.findOne({ clinicId, role: 'DOCTOR' }).lean();
    const p = await Patient.findOne({ clinicId }).lean();
    return { user: u, patient: p };
  });

  if (!user) throw new Error('No doctor found');
  if (!patient) throw new Error('No patient found');

  let issuedEstimate: any;
  let bill: any;
  let payment2: any;
  let reversal: any;

  const doctorActor = {
    type: 'USER' as const,
    id: user._id.toString(),
  };

  await runWithTenantContext(
    {
      clinicId,
      actor: doctorActor,
    },
    async () => {
    console.log('Creating sample Estimate, Bill, Payment & Reversal for documentation & PDFs...');
    // 1. Create and Issue Estimate
    const estimate = await createEstimateDraft(
      clinicId,
      {
        patientId: patient._id.toString(),
        items: [
          {
            description: 'Composite Restoration (Anterior)',
            teeth: [11, 21],
            qty: 2,
            listPrice: 150000,
            unitPrice: 150000,
            amount: 300000,
          },
          {
            description: 'Root Canal Treatment (Molar)',
            teeth: [46],
            qty: 1,
            listPrice: 450000,
            unitPrice: 450000,
            amount: 450000,
          },
        ],
        discount: 50000,
        validUntil: '2026-11-30',
        notes: 'Two sittings recommended. Tooth 46 crown to follow in 2 weeks.',
      },
      doctorActor
    );

    issuedEstimate = await issueEstimate(clinicId, estimate._id, doctorActor);

    // 2. Convert Estimate to Bill
    const billResult = await createBill(
      clinicId,
      {
        patientId: patient._id.toString(),
        estimateId: issuedEstimate._id.toString(),
        items: issuedEstimate.items.map((it: any) => ({
          description: it.description,
          teeth: it.teeth,
          qty: it.qty,
          listPrice: it.listPrice,
          unitPrice: it.unitPrice,
          amount: it.amount,
        })),
        discount: issuedEstimate.discount,
      },
      doctorActor
    );
    bill = billResult.bill;

    // 3. Record Partial Payment (₹3,000)
    const pay1Result = await recordPayment(
      clinicId,
      {
        billId: bill._id.toString(),
        amount: 300000,
        method: 'CASH',
        idempotencyKey: `sample-pay-1-${Date.now()}`,
      },
      doctorActor
    );
    const payment1 = pay1Result.payment;

    // 4. Record Second Payment (₹4,000) via UPI
    const pay2Result = await recordPayment(
      clinicId,
      {
        billId: bill._id.toString(),
        amount: 400000,
        method: 'UPI',
        upiRef: 'UPI889977665544',
        idempotencyKey: `sample-pay-2-${Date.now()}`,
      },
      doctorActor
    );
    payment2 = pay2Result.payment;

    // 5. Reverse First Payment
    const revResult = await reversePayment(
      clinicId,
      payment1._id,
      'Payment method corrected to bank transfer upon patient request',
      doctorActor
    );
    reversal = revResult.reversalPayment;
  });

  console.log('Sample data created:', {
    estimateId: issuedEstimate._id.toString(),
    estimateNo: issuedEstimate.estimateNo,
    billId: bill._id.toString(),
    billNo: bill.billNo,
    paymentId: payment2._id.toString(),
    receiptNo: payment2.receiptNo,
    reversalId: reversal._id.toString(),
    reversalReceiptNo: reversal.receiptNo,
  });

  // Ensure output directories exist
  const docsDir = path.resolve(process.cwd(), 'docs', 'screenshots');
  const artifactsDir = path.resolve(process.cwd(), 'reports', 'artifacts');
  fs.mkdirSync(docsDir, { recursive: true });
  fs.mkdirSync(artifactsDir, { recursive: true });

  console.log('Launching browser to capture screenshots & print PDFs...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Login as doctor
  await page.goto('http://localhost:3000/login');
  await page.waitForSelector('#email');
  await page.fill('#email', 'dr.susheel@example.com');
  await page.fill('#password', 'DoctorPassword1234!');
  await page.click('button[type="submit"]');
  await page.waitForFunction(() => window.location.pathname.includes('/settings/security'), null, {
    timeout: 15000,
  });

  // 1. Screenshots across 3 viewports: 1440, 820, 390
  const viewports = [
    { name: '1440', width: 1440, height: 900 },
    { name: '820', width: 820, height: 1180 },
    { name: '390', width: 390, height: 844 },
  ];

  for (const vp of viewports) {
    await page.setViewportSize({ width: vp.width, height: vp.height });

    // Billing list
    await page.goto('http://localhost:3000/billing');
    await page.waitForSelector('h1:has-text("Billing & Estimates")');
    await page.screenshot({ path: path.join(docsDir, `billing-${vp.name}.png`), fullPage: true });

    // Bill detail
    await page.goto(`http://localhost:3000/billing/bills/${bill._id}`);
    await page.waitForSelector('#bill-status-badge');
    await page.screenshot({ path: path.join(docsDir, `bill-detail-${vp.name}.png`), fullPage: true });

    // Estimate builder
    await page.goto('http://localhost:3000/billing/estimates/new');
    await page.waitForSelector('#btn-issue-estimate');
    await page.screenshot({ path: path.join(docsDir, `estimate-builder-${vp.name}.png`), fullPage: true });
  }

  // 2. Print Views: Estimate (A5 and A4)
  await page.setViewportSize({ width: 1200, height: 1600 });
  await page.goto(`http://localhost:3000/print/estimate/${issuedEstimate._id}`);
  await page.waitForSelector('#estimate-document');
  await page.screenshot({ path: path.join(docsDir, 'print-estimate-a5.png') });
  await page.pdf({
    path: path.join(artifactsDir, 'estimate-sample.pdf'),
    format: 'A5',
    printBackground: true,
    margin: { top: '0', bottom: '0', left: '0', right: '0' },
  });

  await page.click('#btn-paper-a4');
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(docsDir, 'print-estimate-a4.png') });

  // 3. Print Views: Bill (A5 and A4)
  await page.goto(`http://localhost:3000/print/bill/${bill._id}`);
  await page.waitForSelector('#bill-document');
  await page.screenshot({ path: path.join(docsDir, 'print-bill-a5.png') });
  await page.pdf({
    path: path.join(artifactsDir, 'bill-sample.pdf'),
    format: 'A5',
    printBackground: true,
    margin: { top: '0', bottom: '0', left: '0', right: '0' },
  });

  await page.click('#btn-paper-a4');
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(docsDir, 'print-bill-a4.png') });

  // 4. Print Views: Payment Receipt (A5 and A4)
  await page.goto(`http://localhost:3000/print/receipt/${payment2._id}`);
  await page.waitForSelector('#receipt-document');
  await page.screenshot({ path: path.join(docsDir, 'print-receipt-a5.png') });
  await page.pdf({
    path: path.join(artifactsDir, 'receipt-sample.pdf'),
    format: 'A5',
    printBackground: true,
    margin: { top: '0', bottom: '0', left: '0', right: '0' },
  });

  await page.click('#btn-paper-a4');
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(docsDir, 'print-receipt-a4.png') });

  // 5. Print Views: Reversal Receipt (A5 and A4)
  await page.goto(`http://localhost:3000/print/receipt/${reversal._id}`);
  await page.waitForSelector('#receipt-document');
  await page.screenshot({ path: path.join(docsDir, 'print-reversal-receipt-a5.png') });
  await page.pdf({
    path: path.join(artifactsDir, 'reversal-receipt-sample.pdf'),
    format: 'A5',
    printBackground: true,
    margin: { top: '0', bottom: '0', left: '0', right: '0' },
  });

  console.log('All screenshots and PDFs generated successfully!');
  await browser.close();
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('Failed generating artifacts:', err);
  process.exit(1);
});
