import { describe, it, expect } from 'vitest';
import {
  isValidFdiTooth,
  isPermanentTooth,
  isPrimaryTooth,
  getToothArch,
  getToothSide,
  getToothLabel,
  PERMANENT_TEETH,
  PRIMARY_TEETH,
  FdiToothSchema,
  ToothEntrySchema,
} from '@/lib/fdi-tooth';

describe('FDI Two-Digit Dental Tooth Notation & Validation', () => {
  it('validates all 32 permanent teeth (11-18, 21-28, 31-38, 41-48)', () => {
    expect(PERMANENT_TEETH).toHaveLength(32);
    for (const tooth of PERMANENT_TEETH) {
      expect(isValidFdiTooth(tooth)).toBe(true);
      expect(isPermanentTooth(tooth)).toBe(true);
      expect(isPrimaryTooth(tooth)).toBe(false);
      expect(() => FdiToothSchema.parse(tooth)).not.toThrow();
    }
  });

  it('validates all 20 primary / deciduous teeth (51-55, 61-65, 71-75, 81-85)', () => {
    expect(PRIMARY_TEETH).toHaveLength(20);
    for (const tooth of PRIMARY_TEETH) {
      expect(isValidFdiTooth(tooth)).toBe(true);
      expect(isPermanentTooth(tooth)).toBe(false);
      expect(isPrimaryTooth(tooth)).toBe(true);
      expect(() => FdiToothSchema.parse(tooth)).not.toThrow();
    }
  });

  it('rejects invalid tooth numbers with clear validation failures', () => {
    const invalidNumbers = [0, 9, 10, 19, 20, 29, 30, 39, 40, 49, 50, 56, 60, 66, 70, 76, 80, 86, 90, 99, -1, 11.5];
    for (const invalid of invalidNumbers) {
      expect(isValidFdiTooth(invalid)).toBe(false);
      expect(isPermanentTooth(invalid)).toBe(false);
      expect(isPrimaryTooth(invalid)).toBe(false);
      expect(() => FdiToothSchema.parse(invalid)).toThrow();
    }

    expect(isValidFdiTooth(null)).toBe(false);
    expect(isValidFdiTooth('11')).toBe(false);
    expect(isValidFdiTooth(undefined)).toBe(false);
  });

  it('correctly maps tooth arches and sides', () => {
    // Q1: Upper Right Permanent
    expect(getToothArch(11)).toBe('maxillary');
    expect(getToothSide(11)).toBe('right');

    // Q2: Upper Left Permanent
    expect(getToothArch(21)).toBe('maxillary');
    expect(getToothSide(21)).toBe('left');

    // Q3: Lower Left Permanent
    expect(getToothArch(36)).toBe('mandibular');
    expect(getToothSide(36)).toBe('left');

    // Q4: Lower Right Permanent
    expect(getToothArch(46)).toBe('mandibular');
    expect(getToothSide(46)).toBe('right');

    // Q5: Upper Right Deciduous
    expect(getToothArch(51)).toBe('maxillary');
    expect(getToothSide(51)).toBe('right');

    // Q6: Upper Left Deciduous
    expect(getToothArch(61)).toBe('maxillary');
    expect(getToothSide(61)).toBe('left');

    // Q7: Lower Left Deciduous
    expect(getToothArch(71)).toBe('mandibular');
    expect(getToothSide(71)).toBe('left');

    // Q8: Lower Right Deciduous
    expect(getToothArch(81)).toBe('mandibular');
    expect(getToothSide(81)).toBe('right');
  });

  it('generates descriptive tooth labels for clinical records', () => {
    expect(getToothLabel(11)).toContain('Upper Right Central Incisor');
    expect(getToothLabel(18)).toContain('Upper Right Third Molar (Wisdom)');
    expect(getToothLabel(46)).toContain('Lower Right First Molar');
    expect(getToothLabel(51)).toContain('Deciduous A');
    expect(getToothLabel(85)).toContain('Deciduous E');
    expect(getToothLabel(99)).toContain('Invalid #99');
  });

  it('validates ToothEntrySchema with strict bounds', () => {
    const validEntry = {
      tooth: 46,
      condition: 'Deep Dentinal Caries',
      notes: 'Tenderness on percussion',
    };
    expect(ToothEntrySchema.parse(validEntry)).toEqual(validEntry);

    // Invalid tooth number
    expect(() =>
      ToothEntrySchema.parse({
        tooth: 99,
        condition: 'Caries',
      })
    ).toThrow();

    // Empty condition
    expect(() =>
      ToothEntrySchema.parse({
        tooth: 46,
        condition: '',
      })
    ).toThrow();

    // Extra unknown field (.strict())
    expect(() =>
      ToothEntrySchema.parse({
        tooth: 46,
        condition: 'Caries',
        unknownField: 123,
      })
    ).toThrow();
  });
});
