import crypto from 'crypto';
import mongoose from 'mongoose';
import { IntegrationKey } from '../models/IntegrationKey';
import { IntegrationReplay } from '../models/IntegrationReplay';
import { systemAdminScope } from './tenancy';
import { clock } from './clock';

const DEFAULT_MASTER_KEY_HEX = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

function getMasterKey(): Buffer {
  const envKey = process.env.INTEGRATION_MASTER_KEY;
  if (envKey && envKey.length === 64) {
    return Buffer.from(envKey, 'hex');
  }
  return Buffer.from(DEFAULT_MASTER_KEY_HEX, 'hex');
}

export function encryptSecret(secret: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getMasterKey(), iv);
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptSecret(encryptedPayload: string): string {
  const parts = encryptedPayload.split(':');
  if (parts.length !== 3) {
    throw new Error('Malformed encrypted secret payload');
  }
  const [ivHex, tagHex, dataHex] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const data = Buffer.from(dataHex, 'hex');

  const decipher = crypto.createDecipheriv('aes-256-gcm', getMasterKey(), iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return decrypted.toString('utf8');
}

export function computeHmacSignature(
  secret: string,
  timestamp: number,
  method: string,
  pathAndQuery: string,
  rawBody: string
): string {
  const message = `${timestamp}.${method.toUpperCase()}.${pathAndQuery}.${rawBody}`;
  return crypto.createHmac('sha256', secret).update(message).digest('hex');
}

export class IntegrationAuthError extends Error {
  statusCode: number;
  constructor(message = 'Unauthorized: invalid or missing integration credentials') {
    super(message);
    this.name = 'IntegrationAuthError';
    this.statusCode = 401;
  }
}

export interface VerifiedIntegrationContext {
  clinicId: mongoose.Types.ObjectId;
  keyId: string;
}

export async function verifyIntegrationHmac(
  headers: Headers | Record<string, string | string[] | undefined>,
  method: string,
  pathAndQuery: string,
  rawBody: string
): Promise<VerifiedIntegrationContext> {
  const getHeader = (name: string): string | undefined => {
    if (typeof (headers as Headers).get === 'function') {
      return (headers as Headers).get(name) || (headers as Headers).get(name.toLowerCase()) || undefined;
    }
    const val = (headers as Record<string, string | string[] | undefined>)[name] ||
      (headers as Record<string, string | string[] | undefined>)[name.toLowerCase()];
    return Array.isArray(val) ? val[0] : val;
  };

  const keyId = getHeader('x-key-id');
  const timestampHeader = getHeader('x-timestamp');
  const signatureHex = getHeader('x-signature');

  if (!keyId || !timestampHeader || !signatureHex) {
    throw new IntegrationAuthError('Missing required integration headers (X-Key-Id, X-Timestamp, X-Signature)');
  }

  const timestamp = parseInt(timestampHeader, 10);
  if (isNaN(timestamp)) {
    throw new IntegrationAuthError('Invalid X-Timestamp header');
  }

  const nowSec = Math.floor(clock.now().getTime() / 1000);
  if (Math.abs(nowSec - timestamp) > 300) {
    throw new IntegrationAuthError('X-Timestamp is outside the allowed ±5 minute window');
  }

  const keyDoc = await systemAdminScope(async () => {
    return IntegrationKey.findOne({ keyId, active: true });
  });

  if (!keyDoc) {
    throw new IntegrationAuthError('Invalid or inactive integration key');
  }

  let secret: string;
  try {
    secret = decryptSecret(keyDoc.encryptedSecret);
  } catch {
    throw new IntegrationAuthError('Failed to decrypt integration secret');
  }

  const expectedSignatureHex = computeHmacSignature(secret, timestamp, method, pathAndQuery, rawBody);

  const sigBuf = Buffer.from(signatureHex, 'hex');
  const expectedBuf = Buffer.from(expectedSignatureHex, 'hex');

  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    throw new IntegrationAuthError('Invalid signature');
  }

  // Replay protection: store SHA-256 of signature in collection with 10-minute TTL
  const sigHash = crypto.createHash('sha256').update(signatureHex).digest('hex');

  try {
    await IntegrationReplay.create({
      sigHash,
      createdAt: clock.now(),
    });
  } catch (err: any) {
    if (err && (err.code === 11000 || err.name === 'MongoServerError')) {
      throw new IntegrationAuthError('Replay detected: duplicate signature within replay window');
    }
    throw err;
  }

  return {
    clinicId: keyDoc.clinicId,
    keyId: keyDoc.keyId,
  };
}
