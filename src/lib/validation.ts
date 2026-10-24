import { z } from 'zod';
import { MAX_PAISE } from './money';

export class NoSqlInjectionError extends Error {
  constructor(message = 'NoSQL injection payload detected') {
    super(message);
    this.name = 'NoSqlInjectionError';
  }
}

/**
 * Validates that an input structure contains no keys starting with '$' or containing '.'
 * to prevent NoSQL operator injection in MongoDB queries.
 */
export function assertPlainInput(input: unknown, path = ''): void {
  if (input === null || input === undefined) return;

  if (typeof input === 'object') {
    if (Array.isArray(input)) {
      for (let i = 0; i < input.length; i++) {
        assertPlainInput(input[i], `${path}[${i}]`);
      }
    } else {
      for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
        if (key.startsWith('$') || key.includes('.')) {
          throw new NoSqlInjectionError(
            `Illegal key "${key}" detected at ${path || 'root'}. Keys cannot start with '$' or contain '.'`
          );
        }
        assertPlainInput(value, path ? `${path}.${key}` : key);
      }
    }
  }
}

/**
 * Normalises and validates Indian mobile numbers.
 * Accepts: "+91 98765 43210", "09876543210", "919876543210", "9876543210".
 * Normalises to exact 10 digits starting with 6, 7, 8, or 9.
 */
export const indianMobile = z
  .string()
  .transform((val) => val.replace(/[\s\-\(\)]/g, ''))
  .transform((val) => {
    if (val.startsWith('+91')) return val.slice(3);
    if (val.startsWith('0') && val.length === 11) return val.slice(1);
    if (val.startsWith('91') && val.length === 12) return val.slice(2);
    return val;
  })
  .refine((val) => /^[6-9]\d{9}$/.test(val), {
    message: 'Mobile number must be a valid 10-digit Indian phone number starting with 6-9',
  });

/**
 * Person name: 2-100 chars, trimmed, letters in any script (\p{L}), spaces, ., -, '
 */
export const personName = z
  .string()
  .trim()
  .min(2, 'Name must be at least 2 characters')
  .max(100, 'Name must not exceed 100 characters')
  .refine((val) => /^[\p{L}\p{M}\s.\-']+$/u.test(val), {
    message: 'Name can only contain letters, spaces, hyphens, apostrophes, and periods',
  });

/**
 * Age in integer years between 0 and 120.
 */
export const ageYears = z
  .number()
  .int('Age must be an integer')
  .min(0, 'Age cannot be negative')
  .max(120, 'Age cannot exceed 120');

/**
 * Real calendar date in YYYY-MM-DD format.
 */
export const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
  .refine((val) => {
    const [y, m, d] = val.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    return (
      date.getUTCFullYear() === y &&
      date.getUTCMonth() === m - 1 &&
      date.getUTCDate() === d
    );
  }, {
    message: 'Must be a valid calendar date in YYYY-MM-DD format',
  });

/**
 * Sex enum: Male, Female, Other.
 */
export const sexEnum = z.enum(['Male', 'Female', 'Other']);

/**
 * MongoDB 24-character hex ObjectId string.
 */
export const objectId = z
  .string()
  .regex(/^[0-9a-fA-F]{24}$/, 'Invalid ObjectId string');

/**
 * Integer paise amount.
 */
export const paiseInteger = z
  .number()
  .int('Amount must be an integer')
  .min(0, 'Amount cannot be negative')
  .max(MAX_PAISE, 'Amount exceeds maximum allowable limit');

/**
 * Allowed FDI 2-digit dental tooth notation numbers:
 * Permanent:
 * - Upper Right (Q1): 11 - 18
 * - Upper Left  (Q2): 21 - 28
 * - Lower Left  (Q3): 31 - 38
 * - Lower Right (Q4): 41 - 48
 * Primary (Deciduous):
 * - Upper Right (Q5): 51 - 55
 * - Upper Left  (Q6): 61 - 65
 * - Lower Left  (Q7): 71 - 75
 * - Lower Right (Q8): 81 - 85
 */
const VALID_PERMANENT_TEETH = new Set([
  11, 12, 13, 14, 15, 16, 17, 18,
  21, 22, 23, 24, 25, 26, 27, 28,
  31, 32, 33, 34, 35, 36, 37, 38,
  41, 42, 43, 44, 45, 46, 47, 48,
]);

const VALID_PRIMARY_TEETH = new Set([
  51, 52, 53, 54, 55,
  61, 62, 63, 64, 65,
  71, 72, 73, 74, 75,
  81, 82, 83, 84, 85,
]);

export const fdiTooth = z
  .number()
  .int('Tooth number must be an integer')
  .refine(
    (n) => VALID_PERMANENT_TEETH.has(n) || VALID_PRIMARY_TEETH.has(n),
    {
      message: 'Invalid FDI tooth number. Must be adult (11-48) or primary (51-85) tooth.',
    }
  );

/**
 * Standard pagination schema.
 */
export const pagination = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();
