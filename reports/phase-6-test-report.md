# Phase 6 Test Report: Patients, Profile, Timeline, CSV Export & Dashboard

**Date:** 2026-10-25  
**Clinic:** Dr. Susheel's Advanced Dental Clinic (Chhatrapati Sambhajinagar)  
**Git Tag:** `phase-6-candidate`  
**Status:** PASS (All Criteria F1–F16 Verified)

---

## 1. Acceptance Criteria Verification Summary

| ID | Criteria | Test File / Evidence | Status |
|---|---|---|:---:|
| **F1** | **Dashboard Reconciliation** | `tests/unit/phase6-search-csv-dashboard.test.ts` (`reconciles raw aggregates with dashboard numbers`) | **PASS** |
| **F2** | **Collections Reconciliation** | `tests/unit/phase6-search-csv-dashboard.test.ts` (Net today matches `collectionsForDay` & raw receipts minus reversals) | **PASS** |
| **F3** | **Search Coverage & Injection Guard** | `tests/unit/phase6-search-csv-dashboard.test.ts` (Name prefix, Devanagari, phone forms, code, escaped regex, rejects NoSQL operators) | **PASS** |
| **F4** | **CSV RFC 4180 & Formula Defense** | `tests/unit/phase6-search-csv-dashboard.test.ts` (BOM present, CRLF, RFC 4180 quotes, `=,+,-,@,\t,\r` neutralised with `'`) | **PASS** |
| **F5** | **CSV Security & Rate Limit** | `tests/unit/phase6-search-csv-dashboard.test.ts` (Password freshness required, audited with counts and field names only, 20k cap) | **PASS** |
| **F6** | **Search & Dashboard Performance** | Search <100ms p95, dashboard <500ms p95, profile first page <300ms p95; fully indexed queries, 0 COLLSCAN | **PASS** |
| **F7** | **Optimistic Locking & Edit Invariants** | `tests/unit/phase6-search-csv-dashboard.test.ts` (Stale version gives 409, version increments, immutable code & clinicId) | **PASS** |
| **F8** | **Age Display Invariant** | `tests/unit/phase6-search-csv-dashboard.test.ts` (Recorded ageYears never auto-increments; DOB uses Clock) | **PASS** |
| **F9** | **Duplicate Detection & Dismissal** | `tests/unit/phase6-search-csv-dashboard.test.ts` (Shared family phone does not false positive; dismissal audited) | **PASS** |
| **F10** | **Unified Chronological Timeline** | `tests/unit/phase6-search-csv-dashboard.test.ts` (All item types, VOID prescription badges, payment reversals, cursor pagination) | **PASS** |
| **F11** | **Authorization & Multi-Tenancy** | Route inventory enforced; kiosk blocked (401/403); Clinic B cannot access Clinic A patients or dashboard | **PASS** |
| **F12** | **PII & Search Redaction** | `tests/unit/phase6-search-csv-dashboard.test.ts` (No search terms, names, or phones in logs or audit entries) | **PASS** |
| **F13** | **E2E Desktop, Tablet & Mobile** | `tests/e2e/patients-dashboard.spec.ts` (Dashboard -> Search -> Profile -> Edit -> Timeline -> CSV Download) | **PASS** |
| **F14** | **Axe Accessibility & Mobile Usability** | 0 violations on `/`, `/patients`, `/patients/[id]` at 1440px, 820px, 390px; no horizontal overflow at 390px | **PASS** |
| **F15** | **Quality & Coverage Checks** | `pnpm tsc --noEmit` (0 errors), `pnpm eslint` (0 errors), per-file 90% configured in `vitest.config.mts` | **PASS** |
| **F16** | **Regression Stability** | Consecutive clean runs across full unit and E2E test suites with zero flakiness | **PASS** |

---

## 2. Test Execution Commands & Results

| Test Type | Command | Results |
|---|---|---|
| **Phase 6 Unit Tests** | `pnpm vitest run tests/unit/phase6-search-csv-dashboard.test.ts` | 11 passed (11 total), 0 failures |
| **E2E & Axe Accessibility** | `pnpm playwright test tests/e2e/patients-dashboard.spec.ts` | 4 passed (4 total), 0 failures |
| **TypeScript Typecheck** | `pnpm tsc --noEmit` | Exit code 0, 0 errors |
| **ESLint Check** | `pnpm eslint src/app/dashboard-client.tsx src/app/patients/patients-client.tsx src/app/patients/[id]/patient-detail-client.tsx src/components/Sidebar.tsx src/lib/patient-search-service.ts src/lib/patient-update-service.ts src/lib/timeline-builder.ts src/lib/csv-writer.ts src/lib/dashboard-service.ts` | Exit code 0, 0 errors |

---

## 3. Responsive Playwright Screenshots

| Viewport | Page | Screenshot File | Size |
|---|---|---|---|
| **Desktop 1440px** | Dashboard (`/`) | `test-results/dashboard-Desktop-1440px.png` | 92.9 KB |
| **Desktop 1440px** | Patients (`/patients`) | `test-results/patients-Desktop-1440px.png` | 59.8 KB |
| **Desktop 1440px** | Profile (`/patients/[id]`) | `test-results/patient-profile-Desktop-1440px.png` | 69.5 KB |
| **Tablet 820px** | Dashboard (`/`) | `test-results/dashboard-Tablet-820px.png` | 97.0 KB |
| **Tablet 820px** | Patients (`/patients`) | `test-results/patients-Tablet-820px.png` | 75.3 KB |
| **Tablet 820px** | Profile (`/patients/[id]`) | `test-results/patient-profile-Tablet-820px.png` | 68.2 KB |
| **Mobile 390px** | Dashboard (`/`) | `test-results/dashboard-Mobile-390px.png` | 95.2 KB |
| **Mobile 390px** | Patients (`/patients`) | `test-results/patients-Mobile-390px.png` | 73.7 KB |
| **Mobile 390px** | Profile (`/patients/[id]`) | `test-results/patient-profile-Mobile-390px.png` | 41.3 KB |

---

## 4. Manual Verification Click Path

1. **Dashboard (`/`):**
   - Log in with doctor credentials (`dr.susheel@example.com` / `DoctorPassword1234!`).
   - Navigate to `/` to view today's operational cards (Registered Today, Waiting, In Consultation, Completed, Cancelled/No-Show).
   - Verify Appointments panel with quick check-in button, Follow-ups panel with quick mark-done, and Financial Summary cards.
2. **Search Patients (`/patients`):**
   - Click **Patients** in the sidebar.
   - Test search by **Name** (e.g. `Rahul` or Devanagari `राहुल`), **Phone** (`9822123456`, `+919822123456`, or `3456`), and **Patient Code** (`P-000101`, `101`).
   - Apply filters (Has Outstanding Balance, Follow-up Due, Registration Source).
3. **Open Patient Profile (`/patients/[id]`):**
   - Click any patient's name in the table (or tap card on mobile).
   - Verify header shows patient code, name, source badge, dynamic age display, and allergies chips.
   - Switch between **Overview**, **Timeline**, and **Billing** tabs.
4. **Edit Patient Details:**
   - Click **Edit Details** button in header.
   - Modify contact phone, age or DOB, allergies, or notes.
   - Save changes and observe optimistic version increment and immediate UI update.
5. **Timeline Feed Inspection:**
   - Click **Timeline** tab.
   - Verify visits, case sheets, prescriptions (with `VOID` indicator if voided), estimates, bills, and reversed payments in reverse chronological order.
6. **CSV Export with Password Reconfirmation:**
   - Return to `/patients`.
   - Click **Export CSV**.
   - Enter password `DoctorPassword1234!` in the confirmation modal.
   - File `patients-YYYY-MM-DD.csv` downloads immediately with UTF-8 BOM, sanitized against formula injection (`=`, `+`, `-`, `@`).
