import { asPaise, toRupeesString } from './money';
import { clock } from './clock';

export const CSV_MAX_ROWS = 20000;
export const UTF8_BOM = '\uFEFF';

export interface PatientExportRow {
  patientCode: string;
  name: string;
  ageDisplay: string;
  sex: string;
  phone: string;
  source: string;
  registeredDate: string; // YYYY-MM-DD
  lastVisitDate: string; // YYYY-MM-DD or empty
  visitCount: number;
  outstandingBalancePaise: number;
}

export const CSV_HEADERS = [
  'Patient Code',
  'Name',
  'Age',
  'Sex',
  'Phone',
  'Registration Source',
  'Registration Date',
  'Last Visit Date',
  'Visit Count',
  'Outstanding Balance (INR)',
];

/**
 * Computes age display according to the requirement:
 * - If dob exists: computes age from Clock
 * - If ageYears exists: shows "Age X (as recorded on <date>)"
 */
export function formatAgeDisplay(
  patient: { ageYears?: number; dob?: string; createdAt?: Date | string },
  currentDate?: Date
): string {
  if (patient.dob) {
    const now = currentDate || clock.now();
    const [birthYear, birthMonth, birthDay] = patient.dob.split('-').map(Number);
    let age = now.getUTCFullYear() - birthYear;
    const currentMonth = now.getUTCMonth() + 1;
    const currentDay = now.getUTCDate();

    if (currentMonth < birthMonth || (currentMonth === birthMonth && currentDay < birthDay)) {
      age -= 1;
    }
    return `${Math.max(0, age)} Y`;
  }

  if (patient.ageYears !== undefined && patient.ageYears !== null) {
    const recordedDate = patient.createdAt
      ? new Date(patient.createdAt).toISOString().slice(0, 10)
      : 'registration';
    return `Age ${patient.ageYears} (as recorded on ${recordedDate})`;
  }

  return 'Unknown';
}

/**
 * Neutralises spreadsheet formula injection (CWE-1236)
 * Prefixes cells beginning with =, +, -, @, \t, or \r with a single quote.
 * Plain numbers (e.g. phone numbers or money amounts) are not modified.
 */
export function sanitizeCsvCell(value: string | number | null | undefined, isNumeric = false): string {
  if (value === null || value === undefined) return '';

  const str = String(value);
  if (isNumeric) {
    return str;
  }

  // Check for formula injection triggers
  const firstChar = str.charAt(0);
  const isFormulaTrigger = ['=', '+', '-', '@', '\t', '\r'].includes(firstChar);

  if (isFormulaTrigger) {
    return `'${str}`;
  }

  return str;
}

/**
 * Quotes a cell according to RFC 4180
 * Cells containing commas, double quotes, or newlines must be enclosed in quotes.
 * Existing quotes are doubled ("").
 */
export function escapeCsvCell(cellValue: string): string {
  const needsQuotes = /[",\r\n]/.test(cellValue);
  if (needsQuotes) {
    return `"${cellValue.replace(/"/g, '""')}"`;
  }
  return cellValue;
}

/**
 * Encodes a row of cells into RFC 4180 CRLF format
 */
export function formatCsvRow(cells: string[]): string {
  return cells.map(escapeCsvCell).join(',') + '\r\n';
}

/**
 * Generates the complete CSV string for export
 * Enforces the hard 20,000-row cap.
 */
export function generatePatientsCsv(rows: PatientExportRow[]): string {
  if (rows.length > CSV_MAX_ROWS) {
    throw new Error(`Export exceeds maximum allowable limit of ${CSV_MAX_ROWS} rows.`);
  }

  let csv = UTF8_BOM;
  csv += formatCsvRow(CSV_HEADERS);

  for (const row of rows) {
    const balanceRupees = toRupeesString(asPaise(row.outstandingBalancePaise || 0));

    const cells = [
      escapeCsvCell(sanitizeCsvCell(row.patientCode)),
      escapeCsvCell(sanitizeCsvCell(row.name)),
      escapeCsvCell(sanitizeCsvCell(row.ageDisplay)),
      escapeCsvCell(sanitizeCsvCell(row.sex)),
      escapeCsvCell(sanitizeCsvCell(row.phone, true)), // phone as plain digits
      escapeCsvCell(sanitizeCsvCell(row.source)),
      escapeCsvCell(sanitizeCsvCell(row.registeredDate)),
      escapeCsvCell(sanitizeCsvCell(row.lastVisitDate)),
      escapeCsvCell(sanitizeCsvCell(row.visitCount, true)), // numeric visit count
      escapeCsvCell(sanitizeCsvCell(balanceRupees, true)), // numeric decimal amount
    ];

    csv += cells.join(',') + '\r\n';
  }

  return csv;
}
