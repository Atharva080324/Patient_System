import { describe, it, expect } from 'vitest';
import { redactSensitiveData, logger } from '@/lib/logger';

describe('A17: Structured Logger & Data Redaction', () => {
  it('recursively redacts PII and clinical data keys', () => {
    const input = {
      patientId: '6523abc12345678901234567',
      name: 'John Doe',
      patientName: 'Jane Doe',
      phone: '9822000000',
      address: '123 Main St, Aurangabad',
      medicalHistory: {
        conditions: ['Diabetes', 'Hypertension'],
        allergies: ['Amoxicillin'],
        currentMedications: ['Metformin'],
      },
      token: 'secret_session_token_xyz',
      password: 'mypassword123',
      kioskPin: '1234',
      chiefComplaint: 'Toothache in 46',
      diagnosis: 'Irreversible pulpitis',
      metadata: {
        statusCode: 200,
        requestId: 'req_123',
        userRole: 'DOCTOR',
      },
    };

    const redacted = redactSensitiveData(input) as any;

    // Redacted fields
    expect(redacted.name).toBe('[REDACTED]');
    expect(redacted.patientName).toBe('[REDACTED]');
    expect(redacted.phone).toBe('[REDACTED]');
    expect(redacted.address).toBe('[REDACTED]');
    expect(redacted.medicalHistory).toBe('[REDACTED]');
    expect(redacted.token).toBe('[REDACTED]');
    expect(redacted.password).toBe('[REDACTED]');
    expect(redacted.kioskPin).toBe('[REDACTED]');
    expect(redacted.chiefComplaint).toBe('[REDACTED]');
    expect(redacted.diagnosis).toBe('[REDACTED]');

    // Preserved fields (IDs, metadata, status)
    expect(redacted.patientId).toBe('6523abc12345678901234567');
    expect(redacted.metadata.statusCode).toBe(200);
    expect(redacted.metadata.requestId).toBe('req_123');
    expect(redacted.metadata.userRole).toBe('DOCTOR');
  });

  it('redacts raw Indian phone patterns within arbitrary text strings', () => {
    const text = 'User called from 9822000000 regarding appointment';
    const redacted = redactSensitiveData(text);
    expect(redacted).toBe('[REDACTED_PHONE]');
  });

  it('logger produces valid structured JSON with redacted metadata', () => {
    const entry = logger.info('Test audit log entry', {
      doctorId: 'doc_123',
      name: 'Dr. Secret Name',
      phone: '9822123456',
    });

    expect(entry.level).toBe('info');
    expect(entry.message).toBe('Test audit log entry');
    expect(entry.doctorId).toBe('doc_123');
    expect(entry.name).toBe('[REDACTED]');
    expect(entry.phone).toBe('[REDACTED]');
    expect(entry.timestamp).toBeDefined();
  });

  it('E12: redacts integration secrets, HMAC signatures, and appointment contact details', () => {
    const input = {
      secret: 'super_secret_integration_key_hex_123',
      signature: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      encryptedSecret: 'iv:tag:data_hex',
      contactName: 'Mr. Patient Contact',
      contactPhone: '9822112233',
      appointmentId: '6523abc12345678901234599',
      externalId: 'ext_whatsapp_456',
    };

    const redacted = redactSensitiveData(input) as any;

    expect(redacted.secret).toBe('[REDACTED]');
    expect(redacted.signature).toBe('[REDACTED]');
    expect(redacted.encryptedSecret).toBe('[REDACTED]');
    expect(redacted.contactName).toBe('[REDACTED]');
    expect(redacted.contactPhone).toBe('[REDACTED]');

    // Non-PII IDs preserved
    expect(redacted.appointmentId).toBe('6523abc12345678901234599');
    expect(redacted.externalId).toBe('ext_whatsapp_456');
  });
});

