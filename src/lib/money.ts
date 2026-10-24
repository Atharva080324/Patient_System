export type Paise = number & { readonly __brand: unique symbol };

export const MAX_PAISE = 100_000_000_00; // 10 Crore INR in paise

export function asPaise(value: number): Paise {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`Invalid paise value: ${value} is not a safe integer`);
  }
  return value as Paise;
}

/**
 * Parses a rupee string (e.g. "150", "150.50", "0.75") into integer Paise.
 * Uses exact decimal parsing without floating-point math.
 */
export function parseRupees(input: string | number, allowNegative = false): Paise {
  const str = String(input).trim();
  if (!str) {
    throw new Error('Amount cannot be empty');
  }

  const isNegative = str.startsWith('-');
  if (isNegative && !allowNegative) {
    throw new Error('Negative amounts are not allowed');
  }

  const cleanStr = isNegative ? str.slice(1) : str;
  // Match integer or up to 2 decimal places
  if (!/^\d+(\.\d{1,2})?$/.test(cleanStr)) {
    throw new Error(`Invalid rupee amount format: "${input}"`);
  }

  const parts = cleanStr.split('.');
  const wholePart = BigInt(parts[0]);
  const fractionPart = BigInt((parts[1] || '').padEnd(2, '0'));

  const totalPaiseBig = wholePart * BigInt(100) + fractionPart;

  if (totalPaiseBig > BigInt(MAX_PAISE)) {
    throw new Error(`Amount exceeds maximum allowable limit of ${MAX_PAISE / 100} INR`);
  }

  const signedPaise = isNegative ? -totalPaiseBig : totalPaiseBig;
  const num = Number(signedPaise);

  return asPaise(num);
}

/**
 * Converts integer Paise into a decimal string without floating point operations.
 * e.g. 15050 -> "150.50", -50 -> "-0.50"
 */
export function toRupeesString(paise: Paise): string {
  const p = Number(paise);
  const sign = p < 0 ? '-' : '';
  const abs = Math.abs(p);
  const whole = Math.floor(abs / 100);
  const frac = (abs % 100).toString().padStart(2, '0');
  return `${sign}${whole}.${frac}`;
}

/**
 * Formats integer Paise with en-IN locale (₹ sign, Lakh/Crore grouping).
 */
export function formatINR(paise: Paise): string {
  const rupees = Number(paise) / 100;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(rupees);
}

/**
 * Addition with overflow protection.
 */
export function addPaise(a: Paise, b: Paise): Paise {
  const sum = Number(a) + Number(b);
  if (!Number.isSafeInteger(sum) || Math.abs(sum) > MAX_PAISE) {
    throw new Error(`Paise arithmetic overflow: ${a} + ${b}`);
  }
  return asPaise(sum);
}

/**
 * Subtraction with overflow protection.
 */
export function subtractPaise(a: Paise, b: Paise): Paise {
  const diff = Number(a) - Number(b);
  if (!Number.isSafeInteger(diff) || Math.abs(diff) > MAX_PAISE) {
    throw new Error(`Paise arithmetic overflow: ${a} - ${b}`);
  }
  return asPaise(diff);
}

/**
 * Sum an array of Paise with overflow protection.
 */
export function sumPaise(items: Paise[]): Paise {
  return items.reduce((acc, curr) => addPaise(acc, curr), asPaise(0));
}

/**
 * Applies percentage discount using deterministic rounding (round half away from zero at paise level).
 */
export function applyPercentDiscount(
  total: Paise,
  percent: number
): { discount: Paise; finalAmount: Paise } {
  if (Number.isNaN(percent) || percent < 0 || percent > 100) {
    throw new Error(`Discount percent must be a valid number between 0 and 100, got ${percent}`);
  }

  if (total <= 0 || percent === 0) {
    return { discount: asPaise(0), finalAmount: total };
  }

  // Calculate basis points: percent * 10000 to keep 4 decimal places of percent precision
  // Formula: discount = (total * percent) / 100
  // Round half away from zero: (total * percent_bps + 5000) / 10000
  const totalBig = BigInt(total);
  const percentBps = BigInt(Math.round(percent * 10000));
  const numerator = totalBig * percentBps;
  const divisor = BigInt(1000000); // 100 * 10000

  // Deterministic round half away from zero
  const quotient = numerator / divisor;
  const remainder = numerator % divisor;
  const shouldRoundUp = remainder * BigInt(2) >= divisor;

  const discountVal = Number(shouldRoundUp ? quotient + BigInt(1) : quotient);
  const discount = asPaise(discountVal);
  const finalAmount = subtractPaise(total, discount);

  return { discount, finalAmount };
}

/**
 * Distributes a total discount across multiple line items proportionally using the
 * Largest Remainder (Hamilton-Webster) method so sum of item discounts strictly equals totalDiscount.
 */
export function allocateAcrossItems(totalDiscount: Paise, itemAmounts: Paise[]): Paise[] {
  if (itemAmounts.length === 0) return [];
  if (totalDiscount <= 0) return itemAmounts.map(() => asPaise(0));

  const totalAmount = sumPaise(itemAmounts);
  if (totalAmount <= 0) return itemAmounts.map(() => asPaise(0));

  const totalDiscountBig = BigInt(totalDiscount);
  const totalAmountBig = BigInt(totalAmount);

  interface AllocEntry {
    index: number;
    integerShare: number;
    remainder: bigint;
  }

  const entries: AllocEntry[] = itemAmounts.map((amount, index) => {
    const itemBig = BigInt(amount);
    const prod = itemBig * totalDiscountBig;
    const quotient = prod / totalAmountBig;
    const rem = prod % totalAmountBig;
    return {
      index,
      integerShare: Number(quotient),
      remainder: rem,
    };
  });

  const allocatedSum = entries.reduce((s, e) => s + e.integerShare, 0);
  const remainderToDistribute = totalDiscount - allocatedSum;

  // Sort descending by remainder
  entries.sort((a, b) => (b.remainder > a.remainder ? 1 : b.remainder < a.remainder ? -1 : 0));

  for (let i = 0; i < remainderToDistribute; i++) {
    entries[i % entries.length].integerShare += 1;
  }

  // Restore original order
  entries.sort((a, b) => a.index - b.index);

  return entries.map((e) => asPaise(e.integerShare));
}

const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
  'Seventeen', 'Eighteen', 'Nineteen'
];

const TENS = [
  '', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'
];

function convertNumberLessThanThousand(n: number): string {
  let str = '';
  if (n >= 100) {
    str += ONES[Math.floor(n / 100)] + ' Hundred';
    n %= 100;
    if (n > 0) str += ' ';
  }
  if (n > 0) {
    if (n < 20) {
      str += ONES[n];
    } else {
      str += TENS[Math.floor(n / 10)];
      if (n % 10 > 0) {
        str += '-' + ONES[n % 10];
      }
    }
  }
  return str;
}

/**
 * Converts integer Paise into words adhering to Indian numbering format.
 * (Crore, Lakh, Thousand, Hundred, Rupees, Paise)
 * e.g. 12345600 -> "Rupees One Lakh Twenty-Three Thousand Four Hundred Fifty-Six Only"
 */
export function amountInWordsINR(paise: Paise): string {
  const p = Number(paise);
  if (p === 0) return 'Rupees Zero Only';

  const isNegative = p < 0;
  const abs = Math.abs(p);
  const rupees = Math.floor(abs / 100);
  const paiseRemainder = abs % 100;

  let words = '';

  if (rupees > 0) {
    let remRupees = rupees;

    const crores = Math.floor(remRupees / 10000000);
    remRupees %= 10000000;

    const lakhs = Math.floor(remRupees / 100000);
    remRupees %= 100000;

    const thousands = Math.floor(remRupees / 1000);
    remRupees %= 1000;

    const hundredsAndUnits = remRupees;

    const parts: string[] = [];

    if (crores > 0) {
      parts.push(convertNumberLessThanThousand(crores) + (crores > 1 ? ' Crores' : ' Crore'));
    }
    if (lakhs > 0) {
      parts.push(convertNumberLessThanThousand(lakhs) + (lakhs > 1 ? ' Lakhs' : ' Lakh'));
    }
    if (thousands > 0) {
      parts.push(convertNumberLessThanThousand(thousands) + ' Thousand');
    }
    if (hundredsAndUnits > 0) {
      parts.push(convertNumberLessThanThousand(hundredsAndUnits));
    }

    words = 'Rupees ' + parts.join(' ');
  }

  if (paiseRemainder > 0) {
    const paiseWords = convertNumberLessThanThousand(paiseRemainder) + ' Paise';
    if (words) {
      words += ' and ' + paiseWords;
    } else {
      words = 'Rupees Zero and ' + paiseWords;
    }
  }

  words += ' Only';
  if (isNegative) {
    words = 'Minus ' + words;
  }

  return words;
}
