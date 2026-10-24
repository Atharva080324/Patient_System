# Kiosk Device Setup, Operations, and Security Specification

**Clinic:** Dr. Susheel's Advanced Dental Clinic & Implant Center  
**Device:** Front-desk tablet (e.g., iPad 10.2", Samsung Galaxy Tab A8, or similar 820px+ tablet)

---

## 1. Overview & Security Persona

The registration kiosk is a walk-in check-in terminal placed at the clinic reception desk. Patients use it independently to register their arrival.

### Key Security Invariants
- **Untrusted Terminal:** The tablet is physically accessible to patients and visitors.
- **Write-Only Access:** The kiosk can submit a patient registration, receive a token number, and **read nothing else**.
- **No In-Memory or Local Storage:** Patient names, phone numbers, and visit IDs are never stored in `localStorage`, `sessionStorage`, or cookies.
- **Immediate State Wipe:** Upon registration, the display shows only the assigned token number and resets automatically to a blank form within 10 seconds.
- **History Protection:** `history.replaceState` prevents navigating back to previous patient entries via the browser Back button.

---

## 2. Kiosk Lifecycle & Operation

### 2.1 Unlocking the Kiosk
1. Navigate to `/register` on the tablet browser.
2. If no valid `__Host-kiosk` device cookie exists, the kiosk displays the **Kiosk PIN Unlock** screen.
3. The clinic staff enters the 4–6 digit clinic PIN (configured in Clinic security settings).
4. Upon successful entry:
   - A `POST /api/kiosk/unlock` request verifies the PIN against Argon2id hash.
   - Issues a secure `__Host-kiosk` cookie valid for 12 hours.
   - The SHA-256 hash of the device token is recorded in the `DeviceToken` collection in MongoDB.
   - The UI reveals the walk-in registration form.

### 2.2 Locking the Kiosk
- Clinic staff can click the **"Lock Kiosk"** button in the header/footer at any time.
- Calls `POST /api/kiosk/lock`, which immediately marks the device token as revoked in MongoDB and clears the cookie.
- The UI immediately returns to the PIN unlock screen.
- If the 12-hour validity expires or the PIN is changed in settings, all existing kiosk tokens are automatically invalidated.

---

## 3. What the Kiosk CAN and CANNOT Do

### What the Kiosk CAN Do:
- Verify clinic PIN to obtain a 12-hour device token (`POST /api/kiosk/unlock`).
- Revoke its active device token to lock the screen (`POST /api/kiosk/lock`).
- Submit a walk-in registration (`POST /api/kiosk/register`) with name, age/DOB, sex, phone number, reason for visit, and consent.
- Receive the generated token number for display to the patient.

### What the Kiosk CANNOT Do:
- **Cannot Read Any Data:** Cannot query patients, visits, queue status, doctors, medical records, or bills. Any GET request returns `401 Unauthorized` or `403 Forbidden`.
- **Cannot Access Doctor Routes:** All `withAuth` routes reject kiosk tokens.
- **Cannot Inspect Previous Registrations:** Responses from `POST /api/kiosk/register` return only `{ ok: true, token: N }`. They reveal no patient IDs, database records, or whether the patient was new or existing.
- **Cannot Bypass Rate Limits:** Kiosk submissions are rate-limited to 60 registrations per hour, and PIN entry is locked out after 5 failures in 15 minutes.
