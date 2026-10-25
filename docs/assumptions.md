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

---

# Phase 4: Estimates, Billing, Payments & Receipts Assumptions

## 1. State Machines and Transition Tables

### Estimate State Machine
- **States:** `DRAFT`, `ISSUED`, `CONVERTED`, `CANCELLED`
- **Dynamic Computed State:** `EXPIRED` (evaluated on read if `status === 'ISSUED'` and `clock.now() > validUntilEndOfDay`). Never stored as a stale value.
- **Transition Table:**
  | Current Status | Allowed Action | Next Status | Invariant / Preconditions |
  | :--- | :--- | :--- | :--- |
  | `DRAFT` | `ISSUE` | `ISSUED` | Validates lines (1..99 qty, valid FDI teeth, positive unitPrice). Allocates gapless `EST/FY/0001` in transaction. Freezes complete print snapshot. |
  | `DRAFT` | `CANCEL` | `CANCELLED` | Requires `cancelReason`. Terminal. |
  | `ISSUED` | `CONVERT` | `CONVERTED` | Atomically converts to a single `Bill`. Requires estimate not expired. Stores `convertedToBillId`. Terminal. |
  | `ISSUED` | `CANCEL` | `CANCELLED` | Requires `cancelReason`. Allows creating replacing estimate via `replacesEstimateId`. Terminal. |
  | `CONVERTED`| None | None | Terminal. Cannot be edited, cancelled, or re-converted. |
  | `CANCELLED`| None | None | Terminal. Cannot be edited, issued, or converted. |

### Bill State Machine
- **States:** `UNPAID`, `PARTIAL`, `PAID`, `CANCELLED`
- **Derived Status Rule:** Bill status is derived exclusively by `recomputeBill(total, payments, isCancelled)`. Direct modification of status or financial fields is prohibited.
- **Transition Table:**
  | Current Status | Event / Trigger | Next Status | Conditions / Invariants |
  | :--- | :--- | :--- | :--- |
  | `UNPAID` | Payment (`paid < total`) | `PARTIAL` | `paid > 0 && balance > 0` |
  | `UNPAID` | Payment (`paid === total`)| `PAID` | `paid === total && balance === 0` |
  | `UNPAID` | Action `CANCEL` | `CANCELLED` | Net paid must be 0. Requires `cancelReason`. Releases `activeForVisit` lock. |
  | `PARTIAL`| Payment (`paid === total`)| `PAID` | Balance reaches 0. |
  | `PARTIAL`| Reversal of all payments | `UNPAID` | Net paid returns to 0. |
  | `PAID` | Partial reversal | `PARTIAL` | Balance becomes > 0. |
  | `PAID` | Total reversal | `UNPAID` | Net paid returns to 0. |
  | `CANCELLED`| None | None | Terminal. Cannot receive payments or edits. |

### Payment & Reversal State Machine
- **Model:** Append-only documents. Zero in-place edits or deletions.
- **Types:** Standard payment (`amount > 0`) vs Reversal (`isReversal: true, amount < 0, reversalOf: originalPaymentId`).
- **Reversal Constraints:**
  - A payment can be reversed at most once. Enforced by unique index on `{ clinicId: 1, reversalOf: 1 }`.
  - A reversal cannot be reversed (`reversalOf` can only reference a non-reversal payment).
  - Every reversal allocates a sequential receipt number from the same `receipt` counter series (`REC/FY/0001`).

## 2. Transaction Boundaries
- **Estimate Issuance Transaction:** Allocates `EST/FY/0001`, saves immutable snapshot, updates status to `ISSUED`, writes `ESTIMATE_ISSUE` audit log.
- **Bill Creation Transaction:** Allocates `BILL/FY/0001`, updates Estimate to `CONVERTED` (if applicable), writes Bill. If initial payment provided, allocates `REC/FY/0001`, writes `Payment`, recomputes bill `paid` and `balance` in the EXACT same transaction. Mid-transaction failure rolls back bill, payment, and both counters with zero gaps.
- **Payment Creation Transaction:** Queries existing payments, enforces `currentPaid + amount <= bill.total`, allocates `REC/FY/0001`, writes `Payment` with receipt snapshot, updates Bill `paid`, `balance`, `status`, and version (`$inc: { version: 1 }`), writes `PAYMENT_CREATE` audit log.
- **Payment Reversal Transaction:** Reads original payment, asserts not already reversed, writes reversal `Payment` document with new `REC/FY/0001` and reversal snapshot, recomputes Bill via `recomputeBill`, updates Bill with version increment, writes `PAYMENT_REVERSE` audit log.

## 3. Prevention of Overpayment and Concurrency Control
- **No Overpayment:** `amount` must be > 0 and <= `bill.balance`. All calculations use integer paise.
- **Concurrent Payment Protection:** Concurrent requests run in MongoDB multi-document transactions with primary read preference. Bill version check (`version === currentVersion`) and atomic update `$inc: { version: 1 }` prevents concurrent transactions from both committing when their combined sum exceeds balance. One succeeds, the second fails with HTTP 422/409.

## 4. "One Active Bill Per Visit" Invariant
- **Rule:** A visit can have at most one active (non-cancelled) bill.
- **Implementation:** Explicit boolean `activeForVisit: true` on `Bill`.
- **Database Index:**
  `{ clinicId: 1, visitId: 1, activeForVisit: 1 }` with `{ unique: true, partialFilterExpression: { activeForVisit: true } }`.
  - When bill is created: `activeForVisit: true`. Any parallel attempt for the same `visitId` hits MongoDB duplicate key error (11000) and returns HTTP 409.
  - When bill is cancelled: `activeForVisit: false`. This releases the partial unique index, allowing a new bill to be created for the visit.

## 5. Editing and Cancellation Invariants
- **Bill Edit Lock:** Lines and discount can be edited ONLY when `net paid === 0` and bill is not cancelled, guarded by optimistic versioning (`version`). Once any payment exists, the bill is permanently locked.
- **Correction Workflow:** To correct a locked bill, reverse all payments, cancel the bill with a reason, and create a new bill from the visit.
- **Bill Cancellation:** Allowed ONLY when `net paid === 0`. Requires a reason. Leaves permanent record with status `CANCELLED`.

## 6. Treatment Price Overrides & Audit
- Lines store both `listPrice` and `unitPrice`.
- Doctor price overrides are audited under `PRICE_OVERRIDE` recording line IDs and field names only (never amounts or patient PII).

---

# Phase 5: Appointments, Follow-ups, and Integration Endpoint Assumptions

## 1. Appointment State Machine & Transition Rules
- **States:** `BOOKED` -> `CHECKED_IN`, `CANCELLED`, `NO_SHOW`.
- `CHECKED_IN`, `CANCELLED`, and `NO_SHOW` are terminal. Rescheduling changes `start`/`end` while `BOOKED` guarded by `version` check and audit entry; there is no separate `RESCHEDULED` state.
- Illegal transitions throw and return HTTP 409 Conflict.

## 2. Slot Geometry & Clinic Operating Hours
- **Default Slot Length:** 30 minutes (`DEFAULT_SLOT_MINUTES = 30`). All starts must align to 30-minute grid multiples (:00 or :30).
- **Clinic Hours:** 09:00 to 20:00 in Asia/Kolkata (`CLINIC_OPEN_HOUR = 9`, `CLINIC_CLOSE_HOUR = 20`). Bookings outside operating hours or starting in the past (measured against Clock) are rejected with HTTP 422.
- **Double-Booking Prevention:** Enforced inside a MongoDB transaction by atomically writing to a per-clinic-per-day lock (`SlotLock` document keyed by `clinicId` and `clinicDate` updated with `$inc`), then querying for overlapping active (`BOOKED` or `CHECKED_IN`) appointments where `start < newEnd && end > newStart`. Overlaps return HTTP 409 `SLOT_TAKEN`. No override permitted in v1.

## 3. Check-In & Queue Idempotency
- **Today-Only Rule:** Check-in requires `clinicDate(appointment.start) === clinicDate(clock.now())`. Future or past dates return HTTP 422.
- **Idempotency Invariant:** Check-in transitions appointment atomically (`status: 'BOOKED'` -> `'CHECKED_IN'`) and inserts exactly ONE visit with next token. Enforced via unique partial index on `visits.appointmentId` (`{ partialFilterExpression: { appointmentId: { $exists: true } } }`). Parallel calls return `{ alreadyCheckedIn: true, visit }` with HTTP 200.
- **Unlinked Patient Registration:** If an appointment has no `patientId`, P2 duplicate detector checks phone and name. High-confidence match auto-links; otherwise, requires age/DOB and sex, creating patient with `consentTextVersion = '1.0-staff'`.

## 4. Follow-Up Computing Invariant
- **Status:** `PENDING`, `DONE`, `CANCELLED`.
- **Dynamic Overdue Calculation:** `OVERDUE` is NEVER stored in the database. A follow-up is overdue if and only if `status === 'PENDING'` and `dueDate < clinicDate(clock.now())` evaluated in `Asia/Kolkata`.
- **Prescription Free-Text Policy:** System does not parse free-text follow-up fields from prescriptions. Follow-ups are created via structured dialogs.

## 5. Integration Auth & Replay Protection
- **HMAC Authentication:** Header `X-Signature` is hex HMAC-SHA256 over `${timestamp}.${method}.${pathAndQuery}.${rawBody}` using integration secret. Constant-time comparison prevents timing attacks.
- **Timestamp Window:** ±5 minutes compared to Clock. Stale or future timestamps return HTTP 401.
- **Replay Protection:** Accepted signature hashes are stored in `IntegrationReplay` with 10-minute TTL index. Duplicates inside window return HTTP 401.
- **Secret Storage:** Generated via `pnpm integration:create-key`, secret printed once to stdout. Stored as Argon2id hash in `IntegrationKey` collection.
- **Busy Endpoint Privacy:** `GET /api/integrations/busy?from=&to=` returns ONLY an array of `{ start, end }` ISO strings for active appointments. Names, phones, and IDs are strictly excluded.

---

# Phase 6: Patients, Patient Profile, Timeline, CSV Export & Dashboard Assumptions

## 1. Patient Search Design & Text Indexing
- **Search Architecture:** Search supports prefix matching across Name (including Devanagari script), Phone, and Patient Code.
- **Normalized Name Field (`searchName`):** Because MongoDB text indexes do not support prefix matching (`^`), `Patient` maintains an indexed `searchName` field (lowercased, trimmed, multiple whitespace collapsed). Name queries execute as anchored regexes `^...` over `searchName`.
- **Query Input Sanitization:** All search inputs are passed through the Phase 1 plain-input guard. Regex metacharacters (`.*`, `(`, `\`, `^`, `$`, `[`, `]`, `?`, `+`) are escaped with `escapeRegex()`, preventing ReDoS and accidental full-collection scans. Complex MongoDB query operators (e.g. `{"$ne": null}`) are strictly rejected.
- **Phone & Code Normalization:**
  - Phone numbers are normalized using the Indian mobile logic (`indianMobile`). Input forms (+91, 0 prefix, 10-digit, or trailing 4+ digits) query indexed `phone` field.
  - Patient code queries match exact or case-insensitive code patterns (`P-000123`, `p-123`, `123`).
- **Privacy & Redaction:** Patient search terms are classified as PII and are strictly excluded from server logs and audit entries.
- **Performance Guarantee:** Query plan uses indexed searches (`{ clinicId: 1, isDeleted: 1, searchName: 1 }`, `{ clinicId: 1, phone: 1 }`, `{ clinicId: 1, patientCode: 1 }`). No `COLLSCAN` is permitted. Response p95 < 100ms on 5,000 patients.

## 2. Patient Profile, Age Display & Edit Invariants
- **No Delete or Merge in v1:** In v1, patients cannot be merged or deleted through the UI. Any future deletion will be soft-delete via `isDeleted: true`.
- **Age Display Rule:**
  - If only `ageYears` is recorded: display as `"Age <X> (as recorded on <date>)"`. The system NEVER auto-increments recorded age.
  - If `dob` is recorded: age is computed dynamically at render time using `clock.now()`.
- **Optimistic Concurrency Control:** Patient document edits require `version === currentVersion`. Concurrent edits return HTTP 409 Conflict.
- **Immutability Invariants:** `patientCode` and `clinicId` are strictly immutable once created.
- **Duplicate Detection on Update:** When `name` or `phone` is edited, Phase 2 duplicate detection is automatically re-evaluated. If duplicate score is high, a duplicate banner is shown. The doctor may dismiss the warning (`DUPLICATE_DISMISS` audit), which is reversible upon subsequent detection.
- **Audit Logging:** Opening a patient profile logs `PATIENT_VIEW` (id only). Editing logs `PATIENT_UPDATE` (changed field names only, never field values or PII).

## 3. Timeline Architecture
- **Unified Chronological Feed:** Assembles items across Visits, Case Sheets, Prescriptions, Estimates, Bills, Payments (with Reversals), Appointments, and FollowUps in descending chronological order (`newest first`).
- **Status & Integrity Flags:** VOID prescriptions and reversed payments are clearly badged.
- **Cursor Pagination:** Paginates using `(timestamp, _id)` cursors with page limit (e.g. 15 items) and "Load more" action. Never loads an entire lifetime record into serverless memory.
- **Performance Target:** Profile page 1 load < 300ms server time for patients with 50+ visits.

## 4. CSV Export & Formula Injection (CWE-1236) Protection
- **Security & Authorization:** Doctor-only endpoint, rate-limited, requiring re-authentication via password confirmation within the last 5 minutes.
- **Audit:** Audited under `PATIENT_EXPORT` with row count and filtered field names (never field values).
- **RFC 4180 Compliance:** UTF-8 BOM (`\uFEFF`) prepended for seamless Microsoft Excel rendering (including Devanagari script). CRLF line terminators (`\r\n`). Fields containing quotes, commas, or line breaks are wrapped in double quotes; inner quotes are escaped as `""`.
- **Formula Injection Mitigation:** Any text cell beginning with `=`, `+`, `-`, `@`, `\t` (Tab), or `\r` (Carriage Return) is prepended with a single quote (`'`). Plain numeric columns (phone numbers, currency amounts in rupees) are output as digits without alteration to preserve numeric parsing.
- **Hard Cap & Streaming:** Capped at 20,000 rows. Response is streamed in chunks to ensure flat memory overhead. Filename is `patients-YYYY-MM-DD.csv` evaluated in Asia/Kolkata from the Clock.

## 5. Dashboard Aggregation & Invariants
- **Doctor-Only Realtime Dashboard:** Displays today's operational summary based on `clinicDate(clock.now())` in Asia/Kolkata.
- **Reconciliation Invariant:** All dashboard figures (visits by state, appointments, follow-ups, net collections via `collectionsForDay`, and outstanding balance) match raw database query totals.
- **Zero In-Memory Cache:** All metrics are fetched via indexed MongoDB pipelines and `Promise.all` parallelism to respect serverless lifecycle and multi-instance concurrency.
- **Auto-Refresh:** Frontend auto-refreshes every 60 seconds when active; pauses on tab visibility hidden.



