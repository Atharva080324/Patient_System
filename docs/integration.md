# Integration API Reference

> This document specifies the HMAC-authenticated integration endpoints for external systems
> (e.g., WhatsApp bot, website widget) to interact with the appointment scheduling system.

---

## 1. Authentication: HMAC-SHA256

Every integration request must include three headers:

| Header | Type | Description |
| :--- | :--- | :--- |
| `X-Key-Id` | string | Unique key identifier (e.g., `key_whatsapp_prod`) |
| `X-Timestamp` | string | Unix epoch seconds at time of signing |
| `X-Signature` | string | Hex-encoded HMAC-SHA256 signature |

### Signing Recipe

The HMAC message is constructed as:

```
message = "${timestamp}.${METHOD}.${pathAndQuery}.${rawBody}"
```

The signature is computed as:

```
signature = HMAC-SHA256(secret, message).hex()
```

Where:
- `timestamp`: The same Unix epoch seconds sent in `X-Timestamp`
- `METHOD`: HTTP method in **UPPERCASE** (e.g., `POST`, `GET`, `PATCH`)
- `pathAndQuery`: Full path including query string (e.g., `/api/integrations/appointments?status=BOOKED`)
- `rawBody`: The raw UTF-8 request body (empty string `""` for GET requests)
- `secret`: The plaintext secret issued to the integration partner

### Security Properties

| Property | Detail |
| :--- | :--- |
| **Clock tolerance** | ±5 minutes (300 seconds). Requests outside this window are rejected with `401`. |
| **Replay protection** | Each unique signature is stored for 10 minutes (MongoDB TTL on `IntegrationReplay`). Duplicate signatures within the window are rejected with `401 Replay detected`. |
| **Constant-time comparison** | Signature verification uses `crypto.timingSafeEqual()` to prevent timing attacks. |
| **Secret storage** | Integration secrets are encrypted at rest using AES-256-GCM with a 32-byte master key (`INTEGRATION_MASTER_KEY` env var). |

---

## 2. Worked Example (Test Vector)

Use these values to verify your signing implementation:

```
Secret:    secret_test_vector_clinic_dental_center_123
Timestamp: 1792828800
Method:    POST
Path:      /api/integrations/appointments
Body:      {"externalId":"ext_vector_123","source":"WHATSAPP","name":"Amit Shah","phone":"9820098200","start":"2026-10-26T04:30:00.000Z","reason":"Root canal consultation"}
```

**Message string** (concatenated with `.` separator):

```
1792828800.POST./api/integrations/appointments.{"externalId":"ext_vector_123","source":"WHATSAPP","name":"Amit Shah","phone":"9820098200","start":"2026-10-26T04:30:00.000Z","reason":"Root canal consultation"}
```

**Expected signature**: A 64-character hex string. Run the following Node.js snippet to compute:

```javascript
const crypto = require('crypto');
const secret = 'secret_test_vector_clinic_dental_center_123';
const message = '1792828800.POST./api/integrations/appointments.{"externalId":"ext_vector_123","source":"WHATSAPP","name":"Amit Shah","phone":"9820098200","start":"2026-10-26T04:30:00.000Z","reason":"Root canal consultation"}';
const sig = crypto.createHmac('sha256', secret).update(message).digest('hex');
console.log(sig);
// Verify this matches: /^[0-9a-f]{64}$/
```

This test vector is validated in the unit test `phase5-hmac.test.ts` → `"validates documented test vector matches exact hex HMAC-SHA256 signature"`.

---

## 3. Endpoints

### 3.1. Create Appointment

```
POST /api/integrations/appointments
```

**Request body:**

```json
{
  "externalId": "ext_wa_12345",
  "source": "WHATSAPP",
  "name": "Ramesh Patil",
  "phone": "9876543210",
  "start": "2026-10-26T04:30:00.000Z",
  "reason": "Root canal consultation",
  "treatmentCode": "RCT",
  "notes": "Patient prefers morning slots"
}
```

| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `externalId` | string | ✅ | Unique ID from the external system. Idempotent: second POST with same externalId + source returns existing. |
| `source` | `"WEBSITE"` \| `"WHATSAPP"` | ✅ | Must not be `"MANUAL"`. |
| `name` | string | ✅ | Patient/contact full name. |
| `phone` | string (10 digits) | ✅ | 10-digit Indian mobile number. |
| `start` | ISO 8601 datetime | ✅ | Slot start in UTC. Must be grid-aligned (`:00` or `:30`), within 09:00–20:00 IST, and not in the past. |
| `reason` | string | ✅ | Reason for visit (max 500 chars). |
| `treatmentCode` | string | ❌ | Optional treatment code from the clinic's schedule. |
| `notes` | string | ❌ | Optional clinical notes (max 1000 chars). |

**Success response (201):**

```json
{
  "_id": "671c...",
  "clinicId": "670a...",
  "contactName": "Ramesh Patil",
  "contactPhone": "9876543210",
  "start": "2026-10-26T04:30:00.000Z",
  "end": "2026-10-26T05:00:00.000Z",
  "clinicDate": "2026-10-26",
  "status": "BOOKED",
  "source": "WHATSAPP",
  "externalId": "ext_wa_12345",
  "version": 1
}
```

### 3.2. Cancel / Reschedule Appointment

```
PATCH /api/integrations/appointments/:externalId
```

**Cancel request body:**

```json
{
  "action": "cancel",
  "reason": "Patient requested cancellation"
}
```

**Reschedule request body:**

```json
{
  "action": "reschedule",
  "start": "2026-10-27T04:30:00.000Z"
}
```

| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `action` | `"cancel"` \| `"reschedule"` | ✅ | The operation to perform. |
| `reason` | string | For cancel | Cancellation reason (required for cancel). |
| `start` | ISO 8601 | For reschedule | New slot start (required for reschedule). Same grid/hours/future constraints apply. |

**Success response (200):**

```json
{
  "appointment": { ... },
  "message": "Appointment cancelled successfully"
}
```

### 3.3. Get Busy Intervals

```
GET /api/integrations/busy?date=2026-10-26
```

**Query parameters:**

| Param | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `date` | `YYYY-MM-DD` | ✅ | Clinic date to query busy intervals for. |

**Success response (200):**

```json
{
  "intervals": [
    { "start": "2026-10-26T03:30:00.000Z", "end": "2026-10-26T04:00:00.000Z" },
    { "start": "2026-10-26T04:30:00.000Z", "end": "2026-10-26T05:00:00.000Z" }
  ],
  "busy": [
    { "start": "2026-10-26T03:30:00.000Z", "end": "2026-10-26T04:00:00.000Z" },
    { "start": "2026-10-26T04:30:00.000Z", "end": "2026-10-26T05:00:00.000Z" }
  ]
}
```

> Both `intervals` and `busy` contain the same data (for backward compatibility).

---

## 4. Error Codes

| HTTP Status | Code | When |
| :--- | :--- | :--- |
| `400` | Validation Error | Malformed body, missing required fields, injection attempt. |
| `401` | Missing headers | `X-Key-Id`, `X-Timestamp`, or `X-Signature` header missing. |
| `401` | Invalid key | `X-Key-Id` not found or inactive. |
| `401` | Invalid signature | HMAC mismatch (tampered body, wrong secret, wrong method/path). |
| `401` | Stale timestamp | `X-Timestamp` outside ±5 minute window. |
| `401` | Replay detected | Duplicate signature within 10-minute replay cache. |
| `409` | SLOT_TAKEN | Another appointment already occupies the requested time slot. |
| `409` | EXTERNAL_ID_CONFLICT | Duplicate `externalId` + `source` (idempotent: returns existing appointment). |
| `409` | State transition error | Cannot cancel/reschedule appointment in terminal state. |
| `422` | Geometry error | Slot not grid-aligned (30-min), outside 09:00–20:00 IST, or in the past. |
| `429` | Rate limit | Too many requests. Retry after backoff. |

---

## 5. Key Generation

Generate a new integration key using the CLI script:

```bash
pnpm integration:create-key
```

This will:
1. Generate a random 64-character hex secret.
2. Encrypt the secret using AES-256-GCM with the master key.
3. Store the encrypted secret in the `IntegrationKey` collection.
4. Print the `keyId` and plaintext secret to stdout (one-time display).

**Environment variable:** Set `INTEGRATION_MASTER_KEY` (64-char hex, 32 bytes) in production. A default development key is used if unset.

---

## 6. Example cURL

```bash
# Variables
SECRET="your_plaintext_secret_here"
KEY_ID="key_whatsapp_prod"
TIMESTAMP=$(date +%s)
METHOD="POST"
PATH_AND_QUERY="/api/integrations/appointments"
BODY='{"externalId":"ext_wa_999","source":"WHATSAPP","name":"Test Patient","phone":"9876543210","start":"2026-10-27T04:30:00.000Z","reason":"Checkup"}'

# Compute HMAC-SHA256
MESSAGE="${TIMESTAMP}.${METHOD}.${PATH_AND_QUERY}.${BODY}"
SIGNATURE=$(echo -n "$MESSAGE" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $2}')

# Send request
curl -X POST "http://localhost:3000${PATH_AND_QUERY}" \
  -H "Content-Type: application/json" \
  -H "X-Key-Id: ${KEY_ID}" \
  -H "X-Timestamp: ${TIMESTAMP}" \
  -H "X-Signature: ${SIGNATURE}" \
  -d "${BODY}"
```
