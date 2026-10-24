import { formatInTimeZone } from 'date-fns-tz';

export const CLINIC_TIMEZONE = 'Asia/Kolkata';

/**
 * Returns "YYYY-MM-DD" for a given instant in Asia/Kolkata.
 */
export function clinicDate(instant: Date | number | string = new Date()): string {
  const d = new Date(instant);
  return formatInTimeZone(d, CLINIC_TIMEZONE, 'yyyy-MM-dd');
}

/**
 * Returns UTC instant for start of clinic day ("YYYY-MM-DD 00:00:00.000" IST).
 */
export function startOfClinicDay(dateStr: string): Date {
  // Format: "YYYY-MM-DD 00:00:00.000" in Asia/Kolkata (+05:30)
  // Converting "YYYY-MM-DDT00:00:00.000+05:30"
  return new Date(`${dateStr}T00:00:00.000+05:30`);
}

/**
 * Returns UTC instant for end of clinic day ("YYYY-MM-DD 23:59:59.999" IST).
 */
export function endOfClinicDay(dateStr: string): Date {
  return new Date(`${dateStr}T23:59:59.999+05:30`);
}

/**
 * Returns the Indian Financial Year string (e.g. "2026-27") for an instant evaluated in Asia/Kolkata.
 * India FY: 1 April to 31 March.
 */
export function financialYear(instant: Date | number | string = new Date()): string {
  const d = new Date(instant);
  const yearStr = formatInTimeZone(d, CLINIC_TIMEZONE, 'yyyy');
  const monthStr = formatInTimeZone(d, CLINIC_TIMEZONE, 'MM');

  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10); // 1-12

  let startYear: number;
  let endYearShort: number;

  if (month >= 4) {
    // April (4) to December (12)
    startYear = year;
    endYearShort = (year + 1) % 100;
  } else {
    // January (1) to March (3)
    startYear = year - 1;
    endYearShort = year % 100;
  }

  const endYearFormatted = endYearShort.toString().padStart(2, '0');
  return `${startYear}-${endYearFormatted}`;
}
