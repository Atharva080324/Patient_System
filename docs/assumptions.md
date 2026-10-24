# Phase 1: Architectural Assumptions & Decisions

## 1. Authentication Engine
- **Decision:** Custom lightweight Argon2id + TOTP + session token architecture modelled after Better Auth patterns.
- **Rationale:** 
  - Direct integration with MongoDB Native Driver & Mongoose ensures strict tenant isolation (`clinicId` injected via `AsyncLocalStorage`).
  - Native `@node-rs/argon2` provides prebuilt SIMD-accelerated binaries that avoid native compilation issues in serverless runtimes.
  - No external service dependencies; everything runs securely within MongoDB.
  - Zero in-memory state; fully compliant with Vercel serverless deployment constraints.

## 2. Multi-Tenant Isolation
- **Pattern:** Node.js `AsyncLocalStorage` (`tenantStorage`).
- **Enforcement:**
  - Automatic injection of `{ clinicId }` on all Mongoose queries (`find`, `findOne`, `count`, `update*`, `delete*`, `findOneAndUpdate`, and `aggregate`).
  - Pre-save hooks prevent modifications to `clinicId` (immutable).
  - Explicit bypasses exist only via `systemScope(clinicId, fn)` for administrative scripts, and `systemAdminScope(fn)` for initial session/cookie token lookups before tenant identity is resolved.
  - Any query executed without a valid tenant context throws a fatal `TenantContextMissingError`.

## 3. Financial & Counter Invariants
- **Monetary Units:** All money is represented exclusively as integer `Paise` (branded type `Paise`). No floating-point math is used anywhere in the codebase.
- **Rounding:** Indian GST and discount calculations use deterministic Round Half Away From Zero at the paise level.
- **Counter Strategy:**
  - Gapless sequences (`rx:FY`, `bill:FY`, `receipt:FY`, `estimate:FY`) are incremented inside the MongoDB multi-document transaction; if the transaction aborts, the counter is atomically rolled back.
  - Gappable sequences (`patientCode`, daily `token:YYYY-MM-DD`) are incremented outside transactions to avoid write locks and transaction overhead.
  - Sequential format: Fiscal Year evaluated in `Asia/Kolkata` (1 April to 31 March). E.g., `BILL/2026-27/0001`.

## 4. Append-Only Collections
- `Payment` and `AuditLog` collections are strictly append-only.
- All mutating Mongoose hooks (`updateOne`, `updateMany`, `findOneAndUpdate`, `replaceOne`, `deleteOne`, `deleteMany`, `save()` on existing records) are intercepted and rejected with an `Error('Append-only collection...')`.
- Financial reversals are represented by creating a new `REVERSAL` payment document referencing the original receipt.

## 5. Security & Rate Limiting
- **Fixed Window Rate Limiting:** Backed by MongoDB atomic `$inc` with TTL auto-expiration.
- **Kiosk Mode:** Device token is stored strictly as a SHA-256 hash. Kiosk sessions are strictly segregated from Doctor sessions (`withKiosk` vs `withAuth`).
- **Audit Logs:** All sensitive PII (names, phones, emails, passwords, tokens, medical notes) are redacted by the structured logging layer. Only entity IDs and changed field names are logged.

---

# Phase 2: Registration Kiosk and Live Queue Assumptions

## 1. Visit State Machine & Transition Rules
- **States:** `WAITING`, `IN_CONSULTATION`, `COMPLETED`, `SKIPPED`, `NO_SHOW`, `CANCELLED`.
- **Transition Table:**
  - `WAITING` -> `IN_CONSULTATION`, `SKIPPED`, `NO_SHOW`, `CANCELLED`
  - `SKIPPED` -> `WAITING`, `IN_CONSULTATION`, `NO_SHOW`, `CANCELLED`
  - `IN_CONSULTATION` -> `COMPLETED`, `WAITING` (sent back)
  - `COMPLETED` -> Terminal (no transitions)
  - `NO_SHOW` -> Terminal (no transitions)
  - `CANCELLED` -> Terminal (no transitions)
- **Single Operatory Invariant:** Only one visit per clinic may be `IN_CONSULTATION` at any given time. Enforced in MongoDB via partial unique index `{ clinicId: 1, status: 1 }` where `{ status: 'IN_CONSULTATION' }`, in addition to an atomic update condition.
- **Concurrency & Optimistic Locking:** Every status update increments `version` (`$inc: { version: 1 }`) and asserts `version === currentVersion`. Competing updates return `409 Conflict`.

## 2. Kiosk Write-Only Security Boundary
- **Isolation:** Kiosk requests authenticate with the `__Host-kiosk` cookie checked by `withKiosk`.
- **Access Whitelist:** Kiosk can access ONLY:
  - `POST /api/kiosk/unlock` (authenticates clinic PIN, issues 12h device token)
  - `POST /api/kiosk/lock` (revokes device token, clears cookie)
  - `POST /api/kiosk/register` (creates exactly 1 registration)
- **Read Ban:** All other routes (including all GET endpoints and all `withAuth` doctor routes) return `401 Unauthorized` or `403 Forbidden` when called with the kiosk cookie.
- **Information Leakage Prevention:** `POST /api/kiosk/register` returns an identical response format regardless of whether the patient is brand new, returning, or flagged as duplicate. No patient PII, database IDs, or previous visit counts are returned.
- **Client State Hygiene:** Registration UI does not store data in `localStorage` or `sessionStorage`. On success, state is cleared and `history.replaceState` is called so browser Back button cannot restore previous entries.

## 3. Duplicate Detection Rules
- **Normalization:** Indian 10-digit mobile number normalized (e.g. `9822012345`). Names normalized to lowercase, whitespace collapsed, punctuation removed.
- **Evaluation Matrix:**
  | Phone Match | Name Similarity | Age / DOB Match | Action Taken |
  | :--- | :--- | :--- | :--- |
  | None | Any | Any | **NEW_PATIENT** (No duplicate flag) |
  | Match | High (>= 0.88 Jaro-Winkler) | Match or Absent | **RETURNING_PATIENT** (Link visit to existing patient) |
  | Match | Low (< 0.60 Jaro-Winkler) | Different | **NEW_PATIENT** (Family member with shared phone; no duplicate flag) |
  | Match | Moderate (0.60 to 0.88) | Ambiguous | **NEW_PATIENT** with `possibleDuplicateOf` set to existing patient |
- **Invariant:** Never auto-merge patients. Only link if exact/high-confidence match, otherwise flag via `possibleDuplicateOf`. Doctor queue displays duplicate badges.

## 4. Registration Idempotency Design
- **Client-Provided Key:** Client generates a unique UUIDv4 `idempotencyKey` per submission.
- **Storage & Lock:** Stored in MongoDB `IdempotencyKey` collection with unique index `{ clinicId: 1, key: 1 }` and 24-hour TTL.
- **Parallel Execution:** Concurrent duplicate requests with the same key collide on the unique index; exactly one executes registration while parallel calls wait or receive the cached response.
- **Atomicity:** Patient creation (if new) and Visit creation execute inside a MongoDB transaction. If either fails, the transaction aborts leaving no orphan patient or visit.

## 5. Rate Limits & Honeypot
- **Registration Rate Limit:** 60 registrations per hour per device token / IP.
- **Kiosk PIN Unlock Rate Limit:** 5 attempts per 15 minutes per IP.
- **Honeypot:** Hidden field `confirm_hp`. If filled, registration returns standard success response but creates nothing in MongoDB and logs `HONEYPOT_TRIGGERED`.

## 6. Closing Report & Timezone Handling
- **Timezone:** Asia/Kolkata (`+05:30`).
- **Day Boundary:** Evaluated from `00:00:00.000` to `23:59:59.999` in Asia/Kolkata using `startOfClinicDay` and `endOfClinicDay`.
- **Reconciliation:** All numbers (registered, completed, skipped, no-show, cancelled, waiting) match raw MongoDB count of visits for the specified clinic day.

---

# Phase 3: Consultation, Case Sheet & Prescription Assumptions

## 1. Case Sheet Data Model & Optimistic Concurrency Versioning
- **Collection & Isolation:** Case sheet is stored in a dedicated `CaseSheet` collection with a unique compound index `{ clinicId: 1, visitId: 1 }`.
- **Versioning (`version`):**
  - Starts at `1` upon creation.
  - Every update must supply the `version` on which the edit was based.
  - Updates use atomic `findOneAndUpdate({ clinicId, visitId, version: incomingVersion }, { $set: changedFields, $inc: { version: 1 } })`.
  - If another session updated the case sheet in between, the filter fails to match and returns HTTP `409 Conflict`.
  - The client UI intercepts `409 Conflict`, retains the doctor's locally typed text, displays an explicit conflict alert with "Reload Latest" and "Copy My Text", ensuring zero typed data is ever lost or silently overwritten.
- **Autosave & Field-Level Audit:**
  - Client debounces autosave (1.5 seconds) while typing.
  - Only changed fields are transmitted and updated.
  - Audit logging (`CASE_SHEET_UPDATE`) records entity IDs and field *names* only (e.g. `['chiefComplaint', 'diagnosis']`), never clinical values or PII.

## 2. Prescription Lifecycle, Immutability & Correction Model
- **States:**
  - `DRAFT`: Editable, autosaved, no prescription number assigned yet.
  - `ISSUED`: Numbered with gapless `RX/FY/0001` allocated atomically within the issue transaction. Immutable; all fields frozen in snapshot.
  - `VOID`: Voided with a mandatory doctor-provided `voidReason`. Never deleted from database.
- **Strict Immutability Invariant:**
  - Once a prescription transitions to `ISSUED`, any further update to medicine lines, dose, frequency, duration, or advice is strictly forbidden and rejected at the model/service level.
- **Correction Workflow:**
  - To correct an issued prescription, the doctor voids the old prescription specifying a reason (`voidReason`, `voidedAt`, `voidedBy`).
  - A new prescription is created with `replacesPrescriptionId: oldPrescription._id`.
  - Both prescriptions remain permanently in the database for legal/compliance integrity. RX numbers are never reused or gapped.
- **Gapless Sequence Integrity:**
  - Allocated via `getNextSequenceValue(clinicId, 'rx', session)` within a MongoDB multi-document transaction. If any part of the issue fails, the transaction aborts and the counter rolls back with no gap.

## 3. Print Snapshot Design (Issue-Time Freezing)
- At the exact moment a prescription is transitioned from `DRAFT` to `ISSUED`, a complete `snapshot` is frozen:
  - `clinic`: name, address, phone, email, registrationNo, logoUrl, workingHours.
  - `doctor`: name, qualification, registrationNo (from clinic/user record).
  - `patient`: name, ageYears, sex, patientCode, phone, address.
  - `date`: clinic date string in `Asia/Kolkata`.
  - `items`: exact medicine lines (genericName, brandName, form, strength, dose, frequency, duration, instructions, note).
  - `advice` & `followUpDate`.
  - `language`: active prescription language setting ('en' | 'hi' | 'mr').
- All subsequent print requests (`/print/prescription/[id]`) render strictly from this frozen snapshot. Future changes to patient demographic data or clinic letterhead never alter an issued prescription.
- Reprints are audited (`PRESCRIPTION_PRINT`) and display a subtle "Reprint" indicator after the first print. Voided prescriptions display a prominent diagonal "VOID" watermark.

## 4. Medicine Search, Favourites & Custom Medicine Invariants
- **No AI / No Suggestion Invariant:**
  - The system NEVER suggests drugs, dosages, frequencies, durations, or drug-drug interactions. The doctor has complete clinical autonomy.
  - The medicine combobox only displays `genericName`, `brandName`, `form`, `strength`, and a `verified` badge.
- **Search Strategy & Performance:**
  - Optimized prefix matching with MongoDB compound index `{ clinicId: 1, active: 1, genericName: 1 }` and text index.
  - Performance requirement: p95 response time < 50ms across 5,000 seeded items.
- **Doctor Favourites & Custom Medicines:**
  - Doctor can mark medicines as favorite (`isFavorite: true` or high usage count in `DoctorMedicine`). Favourites appear first when combobox opens empty.
  - Doctor can add custom medicines owned by the clinic (`source: 'CUSTOM'`), preventing case-insensitive duplicates. Custom medicines can be deactivated (`active: false`), never deleted.

## 5. FDI Tooth Notation & Server-Side Validation
- **Standard:** FDI Two-Digit World Dental Federation notation.
- **Valid Teeth:**
  - Permanent (Adult): `11`..`18`, `21`..`28`, `31`..`38`, `41`..`48` (32 teeth).
  - Primary (Deciduous): `51`..`55`, `61`..`65`, `71`..`75`, `81`..`85` (20 teeth).
- **Validation:** Validated both on client UI and server schema/service via `isValidFdiTooth(number)`. Any out-of-range number is rejected with HTTP `400 Bad Request`.
- **Pure Recording:** Tooth selection records findings/notes only. No automatic diagnoses or treatment auto-assignments.

## 6. Allergy Chip Invariant
- Purely a visual reminder chip displaying patient allergies entered by the doctor.
- Strictly informational: does NOT inspect drugs, does NOT block prescription creation or issuing.

