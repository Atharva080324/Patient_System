# Authentication & Security Core Specification

## 1. Authentication Architecture

The system implements a custom, serverless-native authentication engine running directly against MongoDB Atlas, avoiding all in-memory state.

### Password Hashing
- **Algorithm:** Argon2id via `@node-rs/argon2`
- **Parameters:**
  - Memory Cost: 19 MiB (`19456` KiB)
  - Time Cost: 2 iterations
  - Parallelism: 1 thread
  - Output Key Length: 32 bytes
- **Policies:**
  - Minimum 12 characters
  - Common passwords list rejection
  - No artificial composition rules
  - Constant-time verification with pre-computed dummy hash to prevent user enumeration

### Two-Factor Authentication (TOTP 2FA)
- **Standard:** RFC 6238 TOTP via `otplib`
- **Time Step:** 30 seconds, SHA-1, 6-digit tokens
- **Enrollment Flow:**
  1. Doctor initiates setup at `/settings/security` -> backend returns `otpauth://` URI and QR Code.
  2. 10 alphanumeric recovery codes generated; stored in MongoDB as SHA-256 hashes.
  3. Doctor confirms with valid TOTP code to activate.
- **Login Flow:**
  - If 2FA enabled, valid email/password issues a short-lived 5-minute ephemeral state; redirects to `/login/2fa`.
  - Submitting correct TOTP code or single-use recovery code issues full session.

---

## 2. Session Lifecycle & Cookie Settings

### Session Configuration
- **Idle Timeout:** 4 hours (configurable via `SESSION_IDLE_MINUTES=240`)
- **Absolute Lifetime:** 12 hours (configurable via `SESSION_ABSOLUTE_HOURS=12`)
- **Revocation:** Changing password or clicking "Sign out everywhere" sets `revokedAt` timestamp, terminating all active sessions across all devices.

### Cookie Attributes
| Attribute | Doctor Session (`__Host-session`) | Kiosk Session (`__Host-kiosk`) |
| :--- | :--- | :--- |
| **Prefix** | `__Host-` | `__Host-` |
| **HttpOnly** | `true` | `true` |
| **Secure** | `true` (HTTPS only) | `true` (HTTPS only) |
| **SameSite** | `Lax` | `Strict` |
| **Path** | `/` | `/` |
| **Max-Age** | 12 hours (43,200s) | 12 hours (43,200s) |

---

## 3. Rate Limiting Rules (MongoDB-backed Fixed Window)

All rate limits use MongoDB atomic `$inc` with TTL auto-expiration:

| Action / Endpoint | Rate Limit Rule | Key Prefix | Window | Limit |
| :--- | :--- | :--- | :--- | :--- |
| Doctor Login (Email) | Per Email Failures | `rl:login:email:<hash>` | 15 minutes (900s) | 5 attempts |
| Doctor Login (IP) | Per IP Failures | `rl:login:ip:<ip>` | 15 minutes (900s) | 20 attempts |
| Kiosk Unlock (IP) | Per IP Failures | `rl:kiosk:ip:<ip>` | 15 minutes (900s) | 5 attempts |
| 2FA Code (User) | Per User Failures | `rl:2fa:<userId>` | 15 minutes (900s) | 5 attempts |
| API Default | General IP Throttle | `rl:api:ip:<ip>` | 1 minute (60s) | 120 requests |

When limit exceeded, the server returns HTTP 429 with `Retry-After: <seconds>` header.

---

## 4. Kiosk Mode & Device Tokens

- Kiosk devices unlock via numeric PIN (4–10 digits) stored as Argon2id hash on the `Clinic` record.
- Successful unlock generates a 256-bit cryptographic token stored in MongoDB **only as a SHA-256 hash** (`tokenHash`) with a 12-hour expiration.
- **PIN Rotation:** Rotating the kiosk PIN updates `Clinic.kioskPinHash` and immediately revokes all active device tokens (`revokedAt = now`).
- **Authorization Segregation:**
  - Route handlers wrapped with `withAuth` reject kiosk tokens.
  - Route handlers wrapped with `withKiosk` reject doctor session cookies.
