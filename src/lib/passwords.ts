import { hash, verify } from '@node-rs/argon2';
import crypto from 'crypto';

// Bundled list of common weak passwords
const COMMON_PASSWORDS = new Set([
  'password123456',
  '123456789012',
  'qwerty123456',
  'administrator',
  'changeme1234',
  'welcome12345',
  'password1234',
  'clinicadmin12',
  'dentalclinic1',
  'drsusheel123',
  'adminpassword',
  'letmein12345',
  'iloveyou1234',
  'sunshine1234',
  'princess1234',
  'football1234',
  'monkey123456',
  'shadow123456',
  'master123456',
  'secret123456',
]);

// OWASP Recommended parameters for Argon2id (Algorithm.Argon2id = 2)
const ARGON2_OPTIONS = {
  memoryCost: 19456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
  algorithm: 2,
};

// Fixed dummy hash for constant-time comparisons when email does not exist
// This is a pre-calculated Argon2id hash of "dummy-password-string-to-burn-cpu"
const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$MGw8yjxkm4oPzAuLqziL0A$Gh+IGGRrgDlsw7ALNCcEY2X7sS88h39f4deR+abU6Xg';

export function validatePasswordStrength(password: string): { valid: boolean; error?: string } {
  if (!password || password.length < 12) {
    return {
      valid: false,
      error: 'Password must be at least 12 characters long.',
    };
  }

  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    return {
      valid: false,
      error: 'This password is too common. Please choose a more secure passphrase.',
    };
  }

  return { valid: true };
}

export async function hashPassword(password: string): Promise<string> {
  const check = validatePasswordStrength(password);
  if (!check.valid) {
    throw new Error(check.error);
  }
  return hash(password, ARGON2_OPTIONS);
}

export async function hashKioskPin(pin: string): Promise<string> {
  if (!pin || pin.length < 4 || pin.length > 10) {
    throw new Error('Kiosk PIN must be between 4 and 10 digits.');
  }
  return hash(pin, ARGON2_OPTIONS);
}

export async function verifyPassword(hashString: string, password: string): Promise<boolean> {
  try {
    return await verify(hashString, password);
  } catch {
    return false;
  }
}

/**
 * Runs a dummy verification against DUMMY_HASH to consume constant time
 * preventing user enumeration via timing attack.
 */
export async function dummyVerify(password: string): Promise<boolean> {
  try {
    await verify(DUMMY_HASH, password);
  } catch {
    // Ignore error
  }
  return false;
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}
