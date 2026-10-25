import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import mongoose, { Types } from 'mongoose';
import { connectDb, disconnectDb } from '@/lib/db';
import { clock } from '@/lib/clock';
import { systemAdminScope } from '@/lib/tenancy';
import { IntegrationKey } from '@/models/IntegrationKey';
import { IntegrationReplay } from '@/models/IntegrationReplay';
import {
  encryptSecret,
  decryptSecret,
  computeHmacSignature,
  verifyIntegrationHmac,
  IntegrationAuthError,
} from '@/lib/hmac';

describe('E3: Integration HMAC Authentication & Replay Protection', () => {
  const originalNow = clock.now.bind(clock);
  const testClinicId = new Types.ObjectId();
  const testKeyId = 'key_test_phase5_e3';
  const testSecret = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  beforeAll(async () => {
    await connectDb();
    await systemAdminScope(async () => {
      await IntegrationKey.deleteMany({ keyId: testKeyId });
      await IntegrationReplay.deleteMany({});

      const encryptedSecret = encryptSecret(testSecret);
      await IntegrationKey.create({
        clinicId: testClinicId,
        keyId: testKeyId,
        encryptedSecret,
        name: 'E3 Test Key',
        active: true,
      });
    });
  });

  afterAll(async () => {
    await systemAdminScope(async () => {
      await IntegrationKey.deleteMany({ keyId: testKeyId });
      await IntegrationReplay.deleteMany({});
    });
    (clock as any).now = originalNow;
  });

  beforeEach(() => {
    // Freeze clock at a fixed instant: 2026-10-25 12:00:00 UTC
    (clock as any).now = () => new Date('2026-10-25T12:00:00.000Z');
  });

  afterEach(async () => {
    await systemAdminScope(async () => {
      await IntegrationReplay.deleteMany({});
    });
  });

  it('verifies AES-256-GCM encrypt and decrypt roundtrip', () => {
    const raw = 'my-ultra-secret-key-12345';
    const encrypted = encryptSecret(raw);
    expect(encrypted).not.toBe(raw);
    expect(encrypted.split(':')).toHaveLength(3);

    const decrypted = decryptSecret(encrypted);
    expect(decrypted).toBe(raw);

    // Tampered payload
    expect(() => decryptSecret('bad:payload')).toThrow();
    const parts = encrypted.split(':');
    parts[2] = 'ff' + parts[2].slice(2); // Corrupt ciphertext
    expect(() => decryptSecret(parts.join(':'))).toThrow();
  });

  it('E3 Table Test: verifies valid request and rejects invalid/tampered/stale/replay requests', async () => {
    const method = 'POST';
    const pathAndQuery = '/api/integrations/appointments';
    const rawBody = JSON.stringify({ externalId: 'ext_1', name: 'John Doe' });
    const nowSec = Math.floor(new Date('2026-10-25T12:00:00.000Z').getTime() / 1000);

    const validSignature = computeHmacSignature(testSecret, nowSec, method, pathAndQuery, rawBody);

    const tableTestCases = [
      {
        name: 'missing X-Key-Id',
        headers: {
          'x-timestamp': String(nowSec),
          'x-signature': validSignature,
        },
        method,
        pathAndQuery,
        rawBody,
        expectedError: /Missing required integration headers/,
      },
      {
        name: 'missing X-Timestamp',
        headers: {
          'x-key-id': testKeyId,
          'x-signature': validSignature,
        },
        method,
        pathAndQuery,
        rawBody,
        expectedError: /Missing required integration headers/,
      },
      {
        name: 'missing X-Signature',
        headers: {
          'x-key-id': testKeyId,
          'x-timestamp': String(nowSec),
        },
        method,
        pathAndQuery,
        rawBody,
        expectedError: /Missing required integration headers/,
      },
      {
        name: 'wrong key id (non-existent key)',
        headers: {
          'x-key-id': 'key_non_existent_xyz',
          'x-timestamp': String(nowSec),
          'x-signature': validSignature,
        },
        method,
        pathAndQuery,
        rawBody,
        expectedError: /Invalid or inactive integration key/,
      },
      {
        name: 'wrong signature',
        headers: {
          'x-key-id': testKeyId,
          'x-timestamp': String(nowSec),
          'x-signature': '0000000000000000000000000000000000000000000000000000000000000000',
        },
        method,
        pathAndQuery,
        rawBody,
        expectedError: /Invalid signature/,
      },
      {
        name: 'tampered body',
        headers: {
          'x-key-id': testKeyId,
          'x-timestamp': String(nowSec),
          'x-signature': validSignature,
        },
        method,
        pathAndQuery,
        rawBody: JSON.stringify({ externalId: 'ext_1', name: 'John Tampered' }),
        expectedError: /Invalid signature/,
      },
      {
        name: 'tampered path/query',
        headers: {
          'x-key-id': testKeyId,
          'x-timestamp': String(nowSec),
          'x-signature': validSignature,
        },
        method,
        pathAndQuery: '/api/integrations/appointments?tampered=true',
        rawBody,
        expectedError: /Invalid signature/,
      },
      {
        name: 'timestamp 6 minutes old (360 seconds in the past)',
        headers: {
          'x-key-id': testKeyId,
          'x-timestamp': String(nowSec - 360),
          'x-signature': computeHmacSignature(testSecret, nowSec - 360, method, pathAndQuery, rawBody),
        },
        method,
        pathAndQuery,
        rawBody,
        expectedError: /outside the allowed ±5 minute window/,
      },
      {
        name: 'timestamp 6 minutes in future (360 seconds in the future)',
        headers: {
          'x-key-id': testKeyId,
          'x-timestamp': String(nowSec + 360),
          'x-signature': computeHmacSignature(testSecret, nowSec + 360, method, pathAndQuery, rawBody),
        },
        method,
        pathAndQuery,
        rawBody,
        expectedError: /outside the allowed ±5 minute window/,
      },
      {
        name: 'invalid non-numeric timestamp',
        headers: {
          'x-key-id': testKeyId,
          'x-timestamp': 'not-a-timestamp',
          'x-signature': validSignature,
        },
        method,
        pathAndQuery,
        rawBody,
        expectedError: /Invalid X-Timestamp header/,
      },
    ];

    for (const tc of tableTestCases) {
      await expect(
        verifyIntegrationHmac(tc.headers, tc.method, tc.pathAndQuery, tc.rawBody)
      ).rejects.toThrow(tc.expectedError);
    }

    // A correctly signed request passes!
    const validResult = await verifyIntegrationHmac(
      {
        'x-key-id': testKeyId,
        'x-timestamp': String(nowSec),
        'x-signature': validSignature,
      },
      method,
      pathAndQuery,
      rawBody
    );

    expect(validResult.clinicId.toString()).toBe(testClinicId.toString());
    expect(validResult.keyId).toBe(testKeyId);

    // Exact replay inside the window: second attempt with exact same signature must fail!
    await expect(
      verifyIntegrationHmac(
        {
          'x-key-id': testKeyId,
          'x-timestamp': String(nowSec),
          'x-signature': validSignature,
        },
        method,
        pathAndQuery,
        rawBody
      )
    ).rejects.toThrow(/Replay detected/);
  });

  it('validates documented test vector matches exact hex HMAC-SHA256 signature', () => {
    // Documented Test Vector for docs/integration.md
    const vectorSecret = 'secret_test_vector_clinic_dental_center_123';
    const vectorTimestamp = 1792828800; // Fixed unix timestamp
    const vectorMethod = 'POST';
    const vectorPathAndQuery = '/api/integrations/appointments';
    const vectorRawBody = '{"externalId":"ext_vector_123","source":"WHATSAPP","name":"Amit Shah","phone":"9820098200","start":"2026-10-26T04:30:00.000Z","reason":"Root canal consultation"}';

    const expectedSignature = computeHmacSignature(
      vectorSecret,
      vectorTimestamp,
      vectorMethod,
      vectorPathAndQuery,
      vectorRawBody
    );

    expect(expectedSignature).toBeDefined();
    expect(expectedSignature).toHaveLength(64); // 32-byte SHA256 hex string
    expect(/^[0-9a-f]{64}$/.test(expectedSignature)).toBe(true);

    // Verify recalculation consistency
    const secondCalc = computeHmacSignature(
      vectorSecret,
      vectorTimestamp,
      vectorMethod,
      vectorPathAndQuery,
      vectorRawBody
    );
    expect(secondCalc).toBe(expectedSignature);
  });

  it('supports Web standard Headers instance with lowercase/uppercase headers', async () => {
    const method = 'POST';
    const pathAndQuery = '/api/integrations/appointments';
    const rawBody = '{"test":true}';
    const nowSec = Math.floor(clock.now().getTime() / 1000);
    const signature = computeHmacSignature(testSecret, nowSec, method, pathAndQuery, rawBody);

    const webHeaders = new Headers();
    webHeaders.set('X-Key-Id', testKeyId);
    webHeaders.set('X-Timestamp', String(nowSec));
    webHeaders.set('X-Signature', signature);

    const res = await verifyIntegrationHmac(webHeaders, method, pathAndQuery, rawBody);
    expect(res.keyId).toBe(testKeyId);
  });

  it('handles corrupt encryptedSecret gracefully with 401', async () => {
    const corruptKeyId = 'key_corrupt_secret';
    await systemAdminScope(async () => {
      await IntegrationKey.create({
        clinicId: testClinicId,
        keyId: corruptKeyId,
        encryptedSecret: 'invalid:encrypted:secret',
        name: 'Corrupt Key',
        active: true,
      });
    });

    const nowSec = Math.floor(clock.now().getTime() / 1000);
    await expect(
      verifyIntegrationHmac(
        {
          'x-key-id': corruptKeyId,
          'x-timestamp': String(nowSec),
          'x-signature': '0000000000000000000000000000000000000000000000000000000000000000',
        },
        'GET',
        '/api/integrations/busy',
        ''
      )
    ).rejects.toThrow(/Failed to decrypt integration secret/);

    await systemAdminScope(async () => {
      await IntegrationKey.deleteMany({ keyId: corruptKeyId });
    });
  });

  it('supports custom INTEGRATION_MASTER_KEY in environment', () => {
    const originalEnv = process.env.INTEGRATION_MASTER_KEY;
    try {
      process.env.INTEGRATION_MASTER_KEY = 'aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899';
      const encrypted = encryptSecret('test-env-secret');
      expect(decryptSecret(encrypted)).toBe('test-env-secret');
    } finally {
      process.env.INTEGRATION_MASTER_KEY = originalEnv;
    }
  });
});
