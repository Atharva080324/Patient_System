import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  asPaise,
  parseRupees,
  toRupeesString,
  formatINR,
  addPaise,
  subtractPaise,
  sumPaise,
  applyPercentDiscount,
  allocateAcrossItems,
  amountInWordsINR,
  MAX_PAISE,
  Paise,
} from '@/lib/money';

describe('Money Primitives (Paise)', () => {
  describe('parseRupees', () => {
    it('parses valid integer and decimal rupee strings into integer paise', () => {
      expect(parseRupees('0')).toBe(0);
      expect(parseRupees('1')).toBe(100);
      expect(parseRupees('1.5')).toBe(150);
      expect(parseRupees('1.50')).toBe(150);
      expect(parseRupees('0.99')).toBe(99);
      expect(parseRupees('1234.56')).toBe(123456);
      expect(parseRupees('100000.00')).toBe(10000000);
    });

    it('rejects invalid, malformed, or float-drift inputs', () => {
      expect(() => parseRupees('')).toThrow();
      expect(() => parseRupees('abc')).toThrow();
      expect(() => parseRupees('1.234')).toThrow(); // More than 2 decimals
      expect(() => parseRupees('1.2.3')).toThrow();
      expect(() => parseRupees('-50', false)).toThrow(); // Negative disallowed
      expect(() => parseRupees('1000000001')).toThrow(); // Exceeds MAX_PAISE
    });

    it('allows negative amounts only when explicitly enabled', () => {
      expect(parseRupees('-50.25', true)).toBe(-5025);
      expect(() => parseRupees('-50.25', false)).toThrow();
    });
  });

  describe('toRupeesString', () => {
    it('converts paise to exact decimal strings without float drift', () => {
      expect(toRupeesString(asPaise(0))).toBe('0.00');
      expect(toRupeesString(asPaise(50))).toBe('0.50');
      expect(toRupeesString(asPaise(100))).toBe('1.00');
      expect(toRupeesString(asPaise(123456))).toBe('1234.56');
      expect(toRupeesString(asPaise(-500))).toBe('-5.00');
    });
  });

  describe('formatINR', () => {
    it('formats with ₹ and Indian Lakh/Crore grouping', () => {
      const formatted = formatINR(asPaise(12345600)); // 1,23,456.00
      expect(formatted).toContain('1,23,456.00');
      expect(formatted).toMatch(/₹|INR/);
    });
  });

  describe('addPaise & subtractPaise', () => {
    it('safely adds and subtracts paise integers', () => {
      expect(addPaise(asPaise(100), asPaise(250))).toBe(350);
      expect(subtractPaise(asPaise(500), asPaise(120))).toBe(380);
    });

    it('throws on arithmetic overflow beyond safe integer', () => {
      expect(() => addPaise(asPaise(MAX_PAISE), asPaise(1000))).toThrow();
    });
  });

  describe('applyPercentDiscount', () => {
    it('applies percentage discounts with deterministic round half away from zero', () => {
      // 100 Rs (10000 paise) with 10% discount -> 1000 paise discount
      const res1 = applyPercentDiscount(asPaise(10000), 10);
      expect(res1.discount).toBe(1000);
      expect(res1.finalAmount).toBe(9000);

      // Round half away from zero test:
      // 105 paise with 10% discount -> 10.5 paise -> rounds to 11 paise
      const res2 = applyPercentDiscount(asPaise(105), 10);
      expect(res2.discount).toBe(11);
      expect(res2.finalAmount).toBe(94);

      // 104 paise with 10% discount -> 10.4 paise -> rounds to 10 paise
      const res3 = applyPercentDiscount(asPaise(104), 10);
      expect(res3.discount).toBe(10);
      expect(res3.finalAmount).toBe(94);
    });

    it('rejects percentage outside 0-100 range', () => {
      expect(() => applyPercentDiscount(asPaise(1000), -5)).toThrow();
      expect(() => applyPercentDiscount(asPaise(1000), 105)).toThrow();
    });
  });

  describe('allocateAcrossItems (Hamilton-Webster Largest Remainder)', () => {
    it('ensures sum of allocated parts strictly equals total discount', () => {
      const totalDiscount = asPaise(100); // 100 paise
      const items = [asPaise(300), asPaise(300), asPaise(300)]; // equal items
      const allocated = allocateAcrossItems(totalDiscount, items);

      expect(sumPaise(allocated)).toBe(100);
      // 33 + 33 + 33 = 99 -> one gets remainder 1 -> [34, 33, 33]
      expect(allocated.sort()).toEqual([33, 33, 34]);
    });
  });

  describe('amountInWordsINR (30+ required test table)', () => {
    const cases: Array<[number, string]> = [
      [0, 'Rupees Zero Only'],
      [1, 'Rupees Zero and One Paise Only'],
      [25, 'Rupees Zero and Twenty-Five Paise Only'],
      [50, 'Rupees Zero and Fifty Paise Only'],
      [99, 'Rupees Zero and Ninety-Nine Paise Only'],
      [100, 'Rupees One Only'],
      [150, 'Rupees One and Fifty Paise Only'],
      [500, 'Rupees Five Only'],
      [999, 'Rupees Nine and Ninety-Nine Paise Only'],
      [1000, 'Rupees Ten Only'],
      [1250, 'Rupees Twelve and Fifty Paise Only'],
      [5000, 'Rupees Fifty Only'],
      [9999, 'Rupees Ninety-Nine and Ninety-Nine Paise Only'],
      [10000, 'Rupees One Hundred Only'],
      [25000, 'Rupees Two Hundred Fifty Only'],
      [99999, 'Rupees Nine Hundred Ninety-Nine and Ninety-Nine Paise Only'],
      [100000, 'Rupees One Thousand Only'],
      [123456, 'Rupees One Thousand Two Hundred Thirty-Four and Fifty-Six Paise Only'],
      [150000, 'Rupees One Thousand Five Hundred Only'],
      [500000, 'Rupees Five Thousand Only'],
      [999999, 'Rupees Nine Thousand Nine Hundred Ninety-Nine and Ninety-Nine Paise Only'],
      [1000000, 'Rupees Ten Thousand Only'],
      [12345600, 'Rupees One Lakh Twenty-Three Thousand Four Hundred Fifty-Six Only'],
      [12345650, 'Rupees One Lakh Twenty-Three Thousand Four Hundred Fifty-Six and Fifty Paise Only'],
      [50000000, 'Rupees Five Lakhs Only'],
      [100000000, 'Rupees Ten Lakhs Only'],
      [1000000000, 'Rupees One Crore Only'],
      [123456789, 'Rupees Twelve Lakhs Thirty-Four Thousand Five Hundred Sixty-Seven and Eighty-Nine Paise Only'],
      [5000000000, 'Rupees Five Crores Only'],
      [10000000000, 'Rupees Ten Crores Only'],
      [75, 'Rupees Zero and Seventy-Five Paise Only'],
    ];

    it.each(cases)('converts %i paise to "%s"', (paise, expectedWords) => {
      expect(amountInWordsINR(asPaise(paise))).toBe(expectedWords);
    });
  });

  describe('Property Tests (fast-check)', () => {
    it('sum of parts equals total with zero float drift', () => {
      fc.assert(
        fc.property(
          fc.array(fc.integer({ min: 0, max: 10000000 }), { minLength: 1, maxLength: 20 }),
          (numbers) => {
            const paiseList = numbers.map(asPaise);
            const total = sumPaise(paiseList);
            const manualSum = numbers.reduce((a, b) => a + b, 0);
            return total === manualSum;
          }
        )
      );
    });

    it('allocateAcrossItems strictly preserves the total discount invariant', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 50000 }),
          fc.array(fc.integer({ min: 100, max: 100000 }), { minLength: 1, maxLength: 10 }),
          (discountNum, itemsNum) => {
            const totalDiscount = asPaise(discountNum);
            const items = itemsNum.map(asPaise);
            const allocated = allocateAcrossItems(totalDiscount, items);
            const sumAllocated = sumPaise(allocated);
            return sumAllocated === totalDiscount;
          }
        )
      );
    });

    it('applyPercentDiscount discount + finalAmount strictly equals total', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 10000000 }),
          fc.float({ min: 0, max: 100, noNaN: true, noDefaultInfinity: true }),
          (totalNum, percent) => {
            const total = asPaise(totalNum);
            const { discount, finalAmount } = applyPercentDiscount(total, percent);
            return discount + finalAmount === total;
          }
        )
      );
    });
  });
});
