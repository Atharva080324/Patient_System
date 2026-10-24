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
