import { describe, it, expect } from 'vitest';
import {
  fdiTooth,
  indianMobile,
  personName,
  dateOnly,
  ageYears,
  assertPlainInput,
  NoSqlInjectionError,
} from '@/lib/validation';

describe('Validation Primitives', () => {
  describe('fdiTooth', () => {
    it('accepts all permanent teeth (11-18, 21-28, 31-38, 41-48)', () => {
      const permanent = [
        11, 12, 13, 14, 15, 16, 17, 18,
        21, 22, 23, 24, 25, 26, 27, 28,
        31, 32, 33, 34, 35, 36, 37, 38,
        41, 42, 43, 44, 45, 46, 47, 48,
      ];
      for (const tooth of permanent) {
        expect(fdiTooth.safeParse(tooth).success).toBe(true);
      }
    });

    it('accepts all primary (deciduous) teeth (51-55, 61-65, 71-75, 81-85)', () => {
      const primary = [
        51, 52, 53, 54, 55,
        61, 62, 63, 64, 65,
        71, 72, 73, 74, 75,
        81, 82, 83, 84, 85,
      ];
      for (const tooth of primary) {
        expect(fdiTooth.safeParse(tooth).success).toBe(true);
      }
    });

    it('rejects invalid or non-existent FDI tooth numbers', () => {
      const invalid = [0, 10, 19, 20, 29, 39, 49, 50, 56, 59, 66, 76, 86, 90, 99, -11];
      for (const tooth of invalid) {
        expect(fdiTooth.safeParse(tooth).success).toBe(false);
      }
    });
  });

  describe('indianMobile', () => {
    it('normalises various valid formats to standard 10 digits', () => {
      expect(indianMobile.parse('9822000000')).toBe('9822000000');
      expect(indianMobile.parse('+91 98220 00000')).toBe('9822000000');
      expect(indianMobile.parse('+919822000000')).toBe('9822000000');
      expect(indianMobile.parse('09822000000')).toBe('9822000000');
      expect(indianMobile.parse('919822000000')).toBe('9822000000');
      expect(indianMobile.parse('6123456789')).toBe('6123456789');
      expect(indianMobile.parse('7123456789')).toBe('7123456789');
      expect(indianMobile.parse('8123456789')).toBe('8123456789');
    });

    it('rejects numbers starting with 0-5 or invalid length', () => {
      expect(indianMobile.safeParse('5822000000').success).toBe(false);
      expect(indianMobile.safeParse('1234567890').success).toBe(false);
      expect(indianMobile.safeParse('98220000').success).toBe(false);
      expect(indianMobile.safeParse('9822000000000').success).toBe(false);
      expect(indianMobile.safeParse('abc9822000').success).toBe(false);
    });
  });

  describe('personName', () => {
    it('accepts letters in Latin, Devanagari, spaces, hyphens, and periods', () => {
      expect(personName.parse('Dr. Susheel Chauthmal')).toBe('Dr. Susheel Chauthmal');
      expect(personName.parse('सुशील चौथमल')).toBe('सुशील चौथमल');
      expect(personName.parse("Mary-Jane O'Connor")).toBe("Mary-Jane O'Connor");
      expect(personName.parse('  Trimmed Name  ')).toBe('Trimmed Name');
    });

    it('rejects too short or invalid symbols', () => {
      expect(personName.safeParse('A').success).toBe(false);
      expect(personName.safeParse('User<script>').success).toBe(false);
      expect(personName.safeParse('User #1').success).toBe(false);
    });
  });

  describe('dateOnly', () => {
    it('accepts real calendar dates in YYYY-MM-DD', () => {
      expect(dateOnly.parse('2026-10-24')).toBe('2026-10-24');
      expect(dateOnly.parse('2024-02-29')).toBe('2024-02-29'); // Leap year
    });

    it('rejects impossible calendar dates', () => {
      expect(dateOnly.safeParse('2026-02-29').success).toBe(false); // Not leap year
      expect(dateOnly.safeParse('2026-04-31').success).toBe(false); // April has 30 days
      expect(dateOnly.safeParse('2026-13-01').success).toBe(false); // Month 13
      expect(dateOnly.safeParse('24-10-2026').success).toBe(false);
    });
  });

  describe('A9: NoSQL Operator Injection Guard (assertPlainInput)', () => {
    it('allows clean primitive values, objects, and arrays', () => {
      expect(() =>
        assertPlainInput({
          name: 'Patient Test',
          phone: '9822000000',
          nested: { key: 'value', numbers: [1, 2, 3] },
        })
      ).not.toThrow();
    });

    it('rejects keys starting with $ at any nesting level', () => {
      expect(() => assertPlainInput({ $gt: '' })).toThrow(NoSqlInjectionError);
      expect(() => assertPlainInput({ $ne: null })).toThrow(NoSqlInjectionError);
      expect(() => assertPlainInput({ $where: '1 == 1' })).toThrow(NoSqlInjectionError);
      expect(() =>
        assertPlainInput({ filter: { search: { $regex: '.*' } } })
      ).toThrow(NoSqlInjectionError);
      expect(() => assertPlainInput([{ clean: 'ok' }, { $gt: 5 }])).toThrow(NoSqlInjectionError);
    });

    it('rejects keys containing dots at any nesting level', () => {
      expect(() => assertPlainInput({ 'user.role': 'DOCTOR' })).toThrow(NoSqlInjectionError);
      expect(() =>
        assertPlainInput({ data: { 'medicalHistory.allergies': 'Penicillin' } })
      ).toThrow(NoSqlInjectionError);
    });
  });
});
