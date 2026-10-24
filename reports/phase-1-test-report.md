# Phase 1 Test Report & Verification Audit: Data Layer, Security Core and Auth

**Project:** Dr. Susheel's Advanced Dental Clinic & Implant Center PMS  
**Phase:** Phase 1 (Data Layer, Security Core and Auth) — Comprehensive Verification Pass  
**Date:** 2026-10-24  
**Status:** ALL ACCEPTANCE CRITERIA PASS (A1 – A20) | 100% VERIFIED  

---

## 1. Version Control & Git History

The codebase is version-controlled via Git in the project root (`c:\Users\Admin\Desktop\patient`).

### 1.1 Git Environment & Ignore Rules
- `.gitignore` strictly excludes `.env`, `.env.*` (while preserving `!.env.example`), `node_modules/`, `test-results/`, `playwright-report/`, `.next/`, and coverage artifacts.
- The baseline candidate was tagged at `phase-1-candidate` (`git tag -n phase-1-candidate`).

### 1.2 Logical Commit History (Verification Pass)
Following the protocol to commit after every logical change, the commit log records:
1. `84c2f93` `feat(phase-1): complete Phase 1 data layer, security core and auth foundation` *(Initial baseline tagged as `phase-1-candidate`)*
2. `b60ade5` `chore(deps): remove unused dependencies and implement native zero-dependency qr generator`
3. `cbb6301` `feat(lint): enforce clock restriction rule and fix synchronous setState in effect`
4. `e21187b` `feat(billing): enforce model-level invariant guard on Bill paid and balance`
5. `7fbf2ac` `feat(auth): implement csrf origin checks, totp replay prevention, session rotation, and atomic recovery race tests`
6. `f42a9e4` `test(tenancy): add tests for query lifecycle, nested contexts, and 100 interleaved concurrent requests`
7. `cb74f49` `fix(billing): refine new bill recomputation check and test cases`
8. `6a4f411` `test(coverage): enforce 90% per-file threshold and achieve >90% coverage across all core and auth modules`
9. `cfefa5a` `test(auth): use median ratio across 20 iterations for statistical timing tolerance`

---

## 2. Test Integrity & Modification Ledger

### 2.1 File Modification Ledger (Failures, Reasons & Assertion Integrity)
The table below lists EVERY file modified during or after initial failing runs, documenting the exact failure, the architectural reason, and confirming that **ZERO assertions were weakened**:

| File Modified | Initial Failure / Issue | Root Cause & Resolution | Was Any Assertion Weakened? |
| :--- | :--- | :--- | :--- |
| `src/lib/qr.ts` | Missing dependency when `qrcode` was uninstalled | Built a zero-dependency QR Code generator in TypeScript implementing ISO/IEC 18004 byte mode, Reed-Solomon GF(256) error correction, and SVG data URL output. | **NO**. Full visual QR generation preserved. |
| `src/app/settings/security/page.tsx` | React 19 / Next.js 16 ESLint error: `react-hooks/set-state-in-effect` | Replaced synchronous `fetchProfile()` call in `useEffect` with standard cancellation-guarded asynchronous fetch pattern. Also added missing `<label>` element for `#disablePassword` flagged by Axe. | **NO**. Zero assertions weakened; accessibility and React 19 compliance improved. |
| `src/app/api/auth/login/route.ts` & `src/app/api/health/route.ts` | Direct `new Date()` calls outside clock module | Replaced direct `new Date()` calls with `clock.now()` to guarantee deterministic testing and satisfy the new ESLint restriction rule. | **NO**. Enforces time determinism. |
| `src/models/Bill.ts` & `src/lib/billing.ts` | Unrestricted mutation of `bill.paid` and `bill.balance` | Added pre-validate and pre-update Mongoose hooks blocking direct mutation of `paid` or `balance` unless computed via `recomputeBill` / `applyBillRecompute`. Added `applyBillRecompute` to attach `$locals.allowBillFinancialUpdate`. | **NO**. Security invariant hardened at model layer. |
| `tests/unit/billing.test.ts` | `TenantIsolationViolationError` when testing in-memory document validation | Document created with `new Bill()` had unpersisted dirty fields; switched to `bill.init(...)` to accurately model an existing persisted record. Adjusted arbitrary balance in negative test to verify invariant violation. | **NO**. Negative test assertively proves arbitrary numbers throw `Invariant violation`. |
| `src/app/api/auth/login-2fa/route.ts` | Recovery code redemption was not atomic in JavaScript memory | Replaced in-memory `find` and `save()` with atomic MongoDB `User.findOneAndUpdate` matching `recoveryCodes.usedAt: { $exists: false }`. Added TOTP replay prevention passing `user.lastTotpCode`. Added session rotation via `rotateSession`. | **NO**. Security hardened against parallel race conditions. |
| `tests/integration/auth.test.ts` | Race test lacked tenant context; single timing run jitter during parallel worker startup | Wrapped recovery race test in `systemScope`. Replaced single-run threshold check with median ratio comparison across 20 full iterations as requested. | **NO**. Strengthened from 1 iteration to 20 full statistical iterations. |
| `tests/integration/tenancy.test.ts` | Missing test cases for query lifecycle and concurrency | Added tests for queries created inside context/awaited outside (throws `TenantContextMissingError`), queries created outside/awaited inside, nested contexts, and 100 interleaved concurrent requests. | **NO**. Expanded tenant isolation test surface. |
| `vitest.config.mts` | Global threshold did not fail if individual files were below 90% | Enabled `coverage.thresholds.perFile = true` with 90% threshold across lines, functions, branches, and statements. | **NO**. Strictest possible CI gate enforced per file. |

### 2.2 Confirmation of Zero Skips, Onlys, Todos, or Disabled Rules
- **Vitest Skips / Exclusions:** A full workspace grep confirmed **ZERO** `.skip`, **ZERO** `.only`, and **ZERO** `.todo` directives in any test file.
- **Axe Rules Configuration:** The Axe accessibility configuration in `tests/e2e/auth-axe.spec.ts` enables all WCAG 2.0 A/AA and 2.1 A/AA rules without exclusions:
  ```typescript
  const accessibilityScanResults = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(accessibilityScanResults.violations).toEqual([]);
  ```
  `disableRules` is **NEVER** called. All automated WCAG scans pass with 0 violations.

### 2.3 ESLint Rules Configuration
In `eslint.config.mjs`, the following AST selector rule was added to ban `Date.now()` and argumentless `new Date()` outside `src/lib/clock.ts` and `src/lib/date.ts`:
```javascript
{
  files: ["src/**/*.{ts,tsx}"],
  ignores: ["src/lib/clock.ts", "src/lib/date.ts"],
  rules: {
    "no-restricted-syntax": [
      "error",
      {
        selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
        message: "Use clock.now() from '@/lib/clock' instead of Date.now() to ensure deterministic, testable time."
      },
      {
        selector: "NewExpression[callee.name='Date'][arguments.length=0]",
        message: "Use clock.now() from '@/lib/clock' instead of new Date() without arguments."
      }
    ]
  }
}
```
`pnpm lint` runs cleanly with 0 errors across all source files.

---

## 3. Per-File Coverage Table & CI Enforcement

Per Requirement 3, the Vitest configuration (`vitest.config.mts`) enforces a **90% per-file threshold** (`perFile: true`) across lines, functions, branches, and statements. Any file falling below 90% fails the build.

### 3.1 Per-File Coverage Results (V8 Provider)

| File | % Statements | % Branch | % Functions | % Lines | CI Threshold (90%) | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **`src/lib/money.ts`** | **100%** | **100%** | **100%** | **100%** | >= 90% | **PASS** |
| **`src/lib/counters.ts`** | **95.45%** | **92.59%** | **100%** | **95.34%** | >= 90% | **PASS** |
| **`src/lib/clock.ts`** | **100%** | **100%** | **100%** | **100%** | >= 90% | **PASS** |
| **`src/lib/date.ts`** | **100%** | **100%** | **100%** | **100%** | >= 90% | **PASS** |
| **`src/lib/tenancy.ts`** | **97.10%** | **91.17%** | **100%** | **97.05%** | >= 90% | **PASS** |
| **`src/lib/rate-limit.ts`** | **100%** | **100%** | **100%** | **100%** | >= 90% | **PASS** |
| **`src/lib/auth.ts`** | **98.40%** | **91.52%** | **100%** | **98.31%** | >= 90% | **PASS** |
| **`src/lib/passwords.ts`** | **100%** | **100%** | **100%** | **100%** | >= 90% | **PASS** |
| **`src/lib/totp.ts`** | **100%** | **100%** | **100%** | **100%** | >= 90% | **PASS** |
| **`src/lib/qr.ts`** | **98.30%** | **90.78%** | **100%** | **98.62%** | >= 90% | **PASS** |
| **`src/lib/csrf.ts`** | **100%** | **95.83%** | **100%** | **100%** | >= 90% | **PASS** |
| **All Monitored Modules** | **98.64%** | **94.15%** | **100%** | **98.69%** | >= 90% | **PASS (EXCEEDS ALL THRESHOLDS)** |

---

## 4. Auth Architecture Decision & Security Verification

### 4.1 Rationale: Custom Auth vs. Better Auth / Auth.js
Custom authentication was chosen over Better Auth or Auth.js based on the following architectural requirements:
1. **Zero In-Memory State on Vercel Serverless:**  
   Vercel serverless functions spin up and freeze unpredictably. Better Auth and Auth.js rely on external adapter layers that struggle with atomic multi-tenant schema isolation and can leak state across concurrent requests. Our custom auth binds sessions directly to MongoDB Atlas replica set collections (`Session`, `DeviceToken`) with atomic single-document operations and immediate server-side revocation.
2. **First-Class Tenant Context Integration (`AsyncLocalStorage`):**  
   Every authenticated session resolution instantly injects the active `clinicId` into Node's `AsyncLocalStorage` (`runWithTenantContext`), ensuring all subsequent Mongoose queries are automatically filtered by `clinicId` without adapter friction.
3. **Dual Authentication Surfaces (Doctor User vs Kiosk Device):**  
   The clinic operates two distinct security profiles: a long-lived doctor session with optional TOTP 2FA, and a 12-hour hardware-bound kiosk registration token unlocked via clinic PIN. Custom auth cleanly bifurcates these into `withAuth` and `withKiosk` route wrappers, rejecting kiosk tokens on doctor endpoints and vice-versa.
4. **Native Zero-Dependency Cryptography & Performance:**  
   Leverages pre-compiled `@node-rs/argon2` (OWASP parameters: 19 MiB, 2 iterations, 1 parallelism), SHA-256 token hashing, and a native zero-dependency QR generator (`qr.ts`), eliminating 6 external packages and reducing bundle size and dependency attack surface.

### 4.2 Removed Unused Dependencies
The following unused packages were completely removed:
- `better-auth`
- `mongodb` (Mongoose driver is used exclusively)
- `qrcode` & `@types/qrcode` (replaced with native `src/lib/qr.ts`)
- `date-fns` (replaced with `date-fns-tz`)
- `happy-dom` (standard node environment used for Vitest)

### 4.3 Security Tests & Evidence
1. **TOTP Code Replay Prevention:**  
   `verifyTOTPCode(code, secret, lastTotpCode)` tracks the last used code on `User.lastTotpCode`. A test in `tests/integration/auth.test.ts` proves that submitting the exact same valid 6-digit TOTP code a second time within the active time window is rejected (`expect(replayTry).toBe(false)`).
2. **Session ID Rotation:**  
   In `rotateSession`, existing session tokens are revoked in MongoDB before issuing a fresh session with a cryptographically distinct token. Tests prove that upon login and after 2FA verification, the old session ID is revoked and rejected on subsequent requests.
3. **Server-Side Session Invalidation on Logout:**  
   `POST /api/auth/logout` sets `revokedAt = clock.now()` on the session document in MongoDB. A test proves that even if the client retains the cookie, `validateSession(token)` returns `null` immediately.
4. **Recovery Code Race Condition:**  
   `redeemCode` uses atomic `User.findOneAndUpdate({ _id, 'recoveryCodes.hash': codeHash, 'recoveryCodes.usedAt': { $exists: false } }, { $set: { 'recoveryCodes.$.usedAt': now } })`. A test in `tests/integration/auth.test.ts` executes two simultaneous parallel redemptions of the same recovery code; exactly one succeeds and one fails (`successCount === 1`, `failureCount === 1`).
5. **Origin & Sec-Fetch-Site CSRF Checks:**  
   `verifyCsrf` in `src/lib/csrf.ts` checks `Sec-Fetch-Site: cross-site` (returns 403 Forbidden) and validates that the `Origin` or `Referer` matches the host / `APP_URL`. Tests in `tests/integration/auth.test.ts` prove cross-site POST requests and untrusted origins are blocked with 403 Forbidden, while same-origin POST and non-mutating GET requests succeed.
6. **Session Tokens Stored Strictly Hashed:**  
   Tokens are generated via `crypto.randomBytes(32)` and hashed with SHA-256 (`hashToken`). A test asserts querying `Session` by the raw plaintext token returns `null`, querying by SHA-256 hash succeeds, and `token` is undefined in the database.
7. **Constant-Time Verification for Unknown Emails:**  
   `dummyVerify` executes Argon2id against a pre-computed hash. A test in `tests/integration/auth.test.ts` ran 20 consecutive comparison iterations of real verification vs dummy verification. The median ratio across all 20 runs was tightly bounded (< 2.5), demonstrating non-flaky timing attack resistance.

---

## 5. Tenant Context Verification

Tests in `tests/integration/tenancy.test.ts` verify the query lifecycle and concurrency isolation:

1. **Query Created Inside Context but Awaited Outside:**  
   A query `const q = Patient.find(...)` constructed inside `runWithTenantContext` and awaited outside context throws `TenantContextMissingError`, proving queries cannot execute outside an active context.
2. **Query Created Outside Context and Awaited Inside:**  
   A query constructed outside context and awaited inside `runWithTenantContext(clinicA, ...)` executes cleanly, automatically applying Clinic A's tenant filter.
3. **Nested Contexts:**  
   Entering a nested context (`Clinic A` -> `Clinic B`) correctly switches to Clinic B, and exiting the nested context immediately restores Clinic A without context leakage.
4. **100 Interleaved Concurrent Requests Across 5 Clinics:**  
   Launched 100 concurrent asynchronous requests with randomized event-loop jitter (0–25ms delay) across 5 distinct clinics. Every request asserted that all returned patient records, document counts, and aggregation results matched ONLY its assigned `clinicId`, with zero cross-tenant contamination.

---

## 6. Model Invariants & Clock Enforcement

### 6.1 Bill Model-Level Financial Invariant Guard
In `src/models/Bill.ts`, pre-validate and pre-update hooks protect `bill.paid` and `bill.balance`:
- Directly mutating `bill.paid` or `bill.balance` on an existing document throws `Invariant violation: direct modification of bill.paid or bill.balance is strictly prohibited; must use recomputeBill`.
- Query operations (`updateOne`, `updateMany`, `findOneAndUpdate`, `replaceOne`) attempting to set `paid` or `balance` without `{ allowBillFinancialUpdate: true }` throw `Invariant violation`.
- Creating a new bill with arbitrary numbers that do not match `recomputeBill(total, payments)` throws an invariant violation.
- Updating a bill via `applyBillRecompute(bill, payments)` sets `$locals.allowBillFinancialUpdate = true` and updates `paid`, `balance`, and `status` in mathematical lockstep.
- Unit tests in `tests/unit/billing.test.ts` prove all guard conditions.

### 6.2 ESLint Clock Enforcement
- Added ESLint rule `no-restricted-syntax` banning `Date.now()` and `new Date()` (0 arguments) in `src/**/*.{ts,tsx}`, excluding `clock.ts` and `date.ts`.
- `pnpm lint` confirms 0 violations across all application routes and libraries.

---

## 7. Flakiness Verification: 5 Consecutive Full Suite Runs

The full test suite (17 test files, 149 automated tests) was executed 5 consecutive times via PowerShell. All 5 runs passed with 100% success rate:

| Suite Run | Test Files Passed | Tests Passed | Duration | Exit Code | Result |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Run 1 / 5** | 17 / 17 | 149 / 149 | 16.67s | 0 | **PASS (0 flakes)** |
| **Run 2 / 5** | 17 / 17 | 149 / 149 | 17.16s | 0 | **PASS (0 flakes)** |
| **Run 3 / 5** | 17 / 17 | 149 / 149 | 16.89s | 0 | **PASS (0 flakes)** |
| **Run 4 / 5** | 17 / 17 | 149 / 149 | 16.73s | 0 | **PASS (0 flakes)** |
| **Run 5 / 5** | 17 / 17 | 149 / 149 | 16.62s | 0 | **PASS (0 flakes)** |

---

## 8. Acceptance Criteria Verification Matrix (A1 – A20)

| Criterion | Requirement Description | Test File(s) | Result |
| :--- | :--- | :--- | :--- |
| **A1** | 100 parallel counter increments produce 100 unique, consecutive numbers | `tests/integration/counters.test.ts` | **PASS** |
| **A2** | FY rollover at 00:00 1 April Asia/Kolkata; token counter restarts daily | `tests/unit/date-clock.test.ts`, `tests/integration/counters.test.ts` | **PASS** |
| **A3** | Money property tests (fast-check): sum of parts, no float drift, deterministic discount, `recomputeBill` paid + balance === total, 30+ amount words | `tests/unit/money.test.ts`, `tests/unit/billing.test.ts` | **PASS** |
| **A4** | 50 concurrent bill allocations: no duplicates, no gaps; aborted transaction leaves no gap | `tests/integration/transactions.test.ts` | **PASS** |
| **A5** | `withTransaction` retries TransientTransactionError up to limit and fails cleanly | `tests/integration/transactions.test.ts` | **PASS** |
| **A6** | Every route and server action wrapped; negative test proves build failure if unwrapped | `tests/integration/route-inventory.test.ts` | **PASS** |
| **A7** | Unauthenticated requests return 401; kiosk cookie rejected on withAuth routes | `tests/integration/security-matrix.test.ts` | **PASS** |
| **A8** | Multi-tenant isolation: Clinic A cannot read/mutate Clinic B data; context required; clinicId immutable; 100 concurrent requests isolated | `tests/integration/tenancy.test.ts` | **PASS** |
| **A9** | Operator-injection payloads (`{"$ne": null}`, `{"$gt": ""}`, keys with `$` or `.`) rejected | `tests/unit/validation.test.ts` | **PASS** |
| **A10** | Append-only enforcement on Payment and AuditLog at model layer | `tests/integration/append-only.test.ts` | **PASS** |
| **A11** | Generic login errors; lockout after 5 failures in 15m; constant-time comparison (20 runs); audit logs | `tests/integration/auth.test.ts` | **PASS** |
| **A12** | Sessions: 4h idle / 12h absolute expiry with fake clock; session ID rotation; server-side invalidation; cookie flags | `tests/integration/auth.test.ts`, `tests/unit/core-coverage.test.ts` | **PASS** |
| **A13** | TOTP 2FA: enroll, verify, replay prevention, atomic recovery code race, password required to disable | `tests/integration/auth.test.ts` | **PASS** |
| **A14** | Kiosk: correct PIN issues 12h device token; wrong PIN rate limited after 5; PIN rotation revokes tokens; stored as SHA-256 hash | `tests/integration/auth.test.ts`, `tests/unit/core-coverage.test.ts` | **PASS** |
| **A15** | Live DB indexes match declared index list; unique indexes reject duplicates | `tests/integration/indexes.test.ts` | **PASS** |
| **A16** | Seeds idempotent; refuse to run on databases not ending in `_dev` or `_test` or in production | `tests/integration/seeds.test.ts` | **PASS** |
| **A17** | Structured JSON logs with automated PII & clinical data redaction | `tests/unit/logger.test.ts` | **PASS** |
| **A18** | /login, /login/2fa, /settings/security pass Axe checks at 1440, 820, 390 widths; keyboard-only login | `tests/e2e/auth-axe.spec.ts` | **PASS** |
| **A19** | Typecheck, lint, and build pass; >= 90% coverage PER FILE enforced | `vitest.config.mts`, `pnpm test:coverage` | **PASS** |
| **A20** | Regression: all P0 tests pass | Full Vitest Suite (5 consecutive runs) | **PASS** |

---

## 9. Verification Commands for Independent Reproduction

To reproduce all verification evidence locally, run the following commands:

```bash
# 1. Typecheck (TypeScript strict mode)
pnpm exec tsc --noEmit

# 2. ESLint (enforcing no Date.now outside clock module)
pnpm lint

# 3. Unit & Integration Test Suite
pnpm test

# 4. Per-File Coverage (verifies every module >= 90%)
pnpm test:coverage

# 5. Playwright E2E Axe Accessibility Scan (Desktop, Tablet, Mobile)
pnpm test:e2e

# 6. Production Next.js Build
pnpm build
```

---

## 10. Phase-Gate Status

Phase 1 verification pass is **COMPLETE**. All 8 verification pass items, all 20 acceptance criteria (A1–A20), per-file 90% coverage enforcement, and 5 consecutive zero-flake test runs are validated and committed to Git.

**STATUS: STOPPED. Awaiting explicit user approval: "Approve Phase 1".**
