import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Types } from 'mongoose';
import { setupTestReplSet, teardownTestReplSet, clearTestDatabase } from './test-db-helper';
import { audit, sanitizeAuditMeta } from '@/lib/audit';
import { AuditLog, AuditAction } from '@/models/AuditLog';
import { systemScope } from '@/lib/tenancy';
import { clock } from '@/lib/clock';

describe('Audit Log Integration', () => {
  const clinicId = new Types.ObjectId();

  beforeAll(async () => {
    await setupTestReplSet();
  });

  afterAll(async () => {
    await teardownTestReplSet();
  });

  beforeEach(async () => {
    await clearTestDatabase();
  });

  it('sanitizeAuditMeta preserves field names, counts, and IDs while stripping raw values', () => {
    const rawMeta = {
      patientId: '6523abc12345678901234567',
      changedFields: ['name', 'phone', 'address'],
      patientName: 'Real Patient Name',
      phoneNumber: '9822000000',
      reasonCode: 'INVALID_CREDENTIALS',
      success: true,
    };

    const sanitized = sanitizeAuditMeta(rawMeta);

    expect(sanitized?.patientId).toBe('6523abc12345678901234567');
    expect(sanitized?.changedFields).toEqual(['name', 'phone', 'address']);
    expect(sanitized?.reasonCode).toBe('INVALID_CREDENTIALS');
    expect(sanitized?.success).toBe(true);

    // Stripped values replaced by marker
    expect(sanitized?.patientName).toBe('[FIELD_MODIFIED]');
    expect(sanitized?.phoneNumber).toBe('[FIELD_MODIFIED]');
  });

  it('audit.record persists audit entry with correct actor and action', async () => {
    const actor = { type: 'USER' as const, id: 'doctor_1' };

    await audit.record({
      clinicId,
      action: AuditAction.PASSWORD_CHANGED,
      entity: 'User',
      entityId: 'doctor_1',
      actor,
      meta: { changedFields: ['passwordHash'], success: true },
      ip: '127.0.0.1',
      userAgent: 'Mozilla/5.0 Test',
    });

    const entries = await systemScope(clinicId, async () => {
      return AuditLog.find({ clinicId });
    });

    expect(entries).toHaveLength(1);
    expect(entries[0].action).toBe('PASSWORD_CHANGED');
    expect(entries[0].entity).toBe('User');
    expect(entries[0].entityId).toBe('doctor_1');
    expect(entries[0].actor.id).toBe('doctor_1');
    expect(entries[0].meta?.changedFields).toEqual(['passwordHash']);
  });
});
