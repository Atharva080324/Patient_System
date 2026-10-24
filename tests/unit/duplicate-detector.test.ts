import { describe, it, expect } from 'vitest';
import {
  normalizePhone,
  normalizeName,
  jaroSimilarity,
  jaroWinklerSimilarity,
  evaluateDuplicate,
  ExistingPatientCandidate,
  NewPatientInput,
} from '@/lib/duplicate-detector';

describe('B9: Duplicate Detector - Normalization, Similarity & Decision Rules', () => {
  describe('normalizePhone', () => {
    it('normalizes various Indian phone formats to 10 digits', () => {
      expect(normalizePhone('+91 98220 12345')).toBe('9822012345');
      expect(normalizePhone('09822012345')).toBe('9822012345');
      expect(normalizePhone('919822012345')).toBe('9822012345');
      expect(normalizePhone('9822012345')).toBe('9822012345');
      expect(normalizePhone('+91-98220-12345')).toBe('9822012345');
      expect(normalizePhone('(0982) 201-2345')).toBe('9822012345');
    });
  });

  describe('normalizeName', () => {
    it('strips honorifics and punctuation, lowercase and trims whitespace', () => {
      expect(normalizeName('Dr. Susheel Joshi')).toBe('susheel joshi');
      expect(normalizeName('Mr. Ramesh Kumar')).toBe('ramesh kumar');
      expect(normalizeName('Mrs. Sunita Deshmukh')).toBe('sunita deshmukh');
      expect(normalizeName('Shri Balasaheb Patil')).toBe('balasaheb patil');
      expect(normalizeName('  Aarav   Sharma  ')).toBe('aarav sharma');
      expect(normalizeName('Pooja S.')).toBe('pooja s');
    });
  });

  describe('Jaro & Jaro-Winkler Similarity', () => {
    it('returns 1.0 for identical strings', () => {
      expect(jaroSimilarity('susheel', 'susheel')).toBe(1.0);
      expect(jaroWinklerSimilarity('susheel', 'susheel')).toBe(1.0);
    });

    it('returns 0.0 for empty or completely disjoint strings', () => {
      expect(jaroSimilarity('', 'susheel')).toBe(0.0);
      expect(jaroSimilarity('abc', 'xyz')).toBe(0.0);
    });

    it('rewards common prefixes in Jaro-Winkler', () => {
      const jaro = jaroSimilarity('dixon', 'dicksonx');
      const jaroWinkler = jaroWinklerSimilarity('dixon', 'dicksonx');
      expect(jaroWinkler).toBeGreaterThanOrEqual(jaro);
    });
  });

  describe('evaluateDuplicate Rule Matrix', () => {
    const existingCandidates: ExistingPatientCandidate[] = [
      {
        _id: 'pat_001',
        patientCode: 'P-000001',
        name: 'Ramesh Balasaheb Patil',
        phone: '9822012345',
        ageYears: 45,
      },
      {
        _id: 'pat_002',
        patientCode: 'P-000002',
        name: 'Sunita Ramesh Patil',
        phone: '9822012345',
        ageYears: 42,
      },
    ];

    it('returns NEW_PATIENT with NO_PHONE_MATCH if phone is not in database', () => {
      const input: NewPatientInput = {
        name: 'Ramesh Patil',
        phone: '9899999999',
        ageYears: 45,
      };

      const result = evaluateDuplicate(input, existingCandidates);
      expect(result.action).toBe('NEW_PATIENT');
      expect(result.reason).toBe('NO_PHONE_MATCH');
      expect(result.matchedPatientId).toBeUndefined();
      expect(result.possibleDuplicateOfId).toBeUndefined();
    });

    it('returns RETURNING_PATIENT for exact name and phone match', () => {
      const input: NewPatientInput = {
        name: 'Mr. Ramesh Balasaheb Patil',
        phone: '+91 98220 12345',
        ageYears: 45,
      };

      const result = evaluateDuplicate(input, existingCandidates);
      expect(result.action).toBe('RETURNING_PATIENT');
      expect(result.reason).toBe('EXACT_OR_HIGH_NAME_MATCH');
      expect(result.matchedPatientId).toBe('pat_001');
      expect(result.matchedPatientCode).toBe('P-000001');
    });

    it('returns RETURNING_PATIENT for high name similarity (minor spelling variation)', () => {
      const input: NewPatientInput = {
        name: 'Ramesh B. Patil',
        phone: '9822012345',
        ageYears: 45,
      };

      const result = evaluateDuplicate(input, existingCandidates);
      expect(result.action).toBe('RETURNING_PATIENT');
      expect(result.matchedPatientId).toBe('pat_001');
    });

    it('returns NEW_PATIENT with FAMILY_SHARED_PHONE for family members sharing phone', () => {
      // Different family member (e.g. child Aditya Patil sharing parents' phone)
      const input: NewPatientInput = {
        name: 'Aditya Patil',
        phone: '9822012345',
        ageYears: 16,
      };

      const result = evaluateDuplicate(input, existingCandidates);
      expect(result.action).toBe('NEW_PATIENT');
      expect(result.reason).toBe('FAMILY_SHARED_PHONE');
      expect(result.matchedPatientId).toBeUndefined();
      expect(result.possibleDuplicateOfId).toBeUndefined(); // Crucial: NOT flagged as duplicate!
    });

    it('flags POSSIBLE_DUPLICATE when names are moderately similar', () => {
      const input: NewPatientInput = {
        name: 'Rameshwar Patil',
        phone: '9822012345',
        ageYears: 45,
      };

      const result = evaluateDuplicate(input, existingCandidates);
      // High/moderate prefix similarity but distinct suffix
      expect(result.action).toBe('NEW_PATIENT');
      expect(result.possibleDuplicateOfId).toBe('pat_001');
      expect(result.possibleDuplicateOfCode).toBe('P-000001');
    });

    it('flags POSSIBLE_DUPLICATE if names match but age differs significantly (e.g. Sr. vs Jr.)', () => {
      const input: NewPatientInput = {
        name: 'Ramesh Balasaheb Patil',
        phone: '9822012345',
        ageYears: 18, // 18 vs 45
      };

      const result = evaluateDuplicate(input, existingCandidates);
      expect(result.action).toBe('NEW_PATIENT');
      expect(result.reason).toBe('POSSIBLE_DUPLICATE_FLAG');
      expect(result.possibleDuplicateOfId).toBe('pat_001');
    });

    it('flags POSSIBLE_DUPLICATE if dob is provided and mismatches', () => {
      const candidatesWithDob: ExistingPatientCandidate[] = [
        {
          _id: 'pat_003',
          patientCode: 'P-000003',
          name: 'Vikas Deshmukh',
          phone: '9822112233',
          dob: '1985-05-15',
        },
      ];

      const input: NewPatientInput = {
        name: 'Vikas Deshmukh',
        phone: '9822112233',
        dob: '1992-10-20',
      };

      const result = evaluateDuplicate(input, candidatesWithDob);
      expect(result.action).toBe('NEW_PATIENT');
      expect(result.reason).toBe('POSSIBLE_DUPLICATE_FLAG');
      expect(result.possibleDuplicateOfId).toBe('pat_003');
    });
  });
});
