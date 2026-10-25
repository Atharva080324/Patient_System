import { z } from 'zod';

export const PERMANENT_TEETH = [
  // Upper Right (Q1)
  18, 17, 16, 15, 14, 13, 12, 11,
  // Upper Left (Q2)
  21, 22, 23, 24, 25, 26, 27, 28,
  // Lower Right (Q4)
  48, 47, 46, 45, 44, 43, 42, 41,
  // Lower Left (Q3)
  31, 32, 33, 34, 35, 36, 37, 38,
] as const;

export const PRIMARY_TEETH = [
  // Upper Right (Q5)
  55, 54, 53, 52, 51,
  // Upper Left (Q6)
  61, 62, 63, 64, 65,
  // Lower Right (Q8)
  85, 84, 83, 82, 81,
  // Lower Left (Q7)
  71, 72, 73, 74, 75,
] as const;

export const VALID_FDI_TEETH_SET = new Set<number>([
  ...PERMANENT_TEETH,
  ...PRIMARY_TEETH,
]);

export const STANDARD_DENTAL_CONDITIONS = [
  'Caries / Cavity',
  'Deep Dentinal Caries',
  'Root Canal Treatment (RCT) Needed',
  'RCT Done',
  'Restoration / Filling Done',
  'Crown / Bridge Indicated',
  'Extraction Indicated',
  'Missing / Extracted',
  'Fractured / Chipped Tooth',
  'Severe Mobility (Grade II/III)',
  'Pain / Periapical Abscess',
  'Calculus / Plaque',
  'Impacted Third Molar',
  'Attrition / Abrasion',
] as const;

export function isValidFdiTooth(tooth: unknown): boolean {
  if (typeof tooth !== 'number' || !Number.isInteger(tooth)) {
    return false;
  }
  return VALID_FDI_TEETH_SET.has(tooth);
}

export function isPermanentTooth(tooth: number): boolean {
  return tooth >= 11 && tooth <= 48 && VALID_FDI_TEETH_SET.has(tooth);
}

export function isPrimaryTooth(tooth: number): boolean {
  return tooth >= 51 && tooth <= 85 && VALID_FDI_TEETH_SET.has(tooth);
}

export function getToothArch(tooth: number): 'maxillary' | 'mandibular' {
  const quadrant = Math.floor(tooth / 10);
  return quadrant === 1 || quadrant === 2 || quadrant === 5 || quadrant === 6
    ? 'maxillary'
    : 'mandibular';
}

export function getToothSide(tooth: number): 'right' | 'left' {
  const quadrant = Math.floor(tooth / 10);
  return quadrant === 1 || quadrant === 4 || quadrant === 5 || quadrant === 8
    ? 'right'
    : 'left';
}

export function getToothLabel(tooth: number): string {
  if (!isValidFdiTooth(tooth)) {
    return `Invalid #${tooth}`;
  }
  const arch = getToothArch(tooth) === 'maxillary' ? 'Upper' : 'Lower';
  const side = getToothSide(tooth) === 'right' ? 'Right' : 'Left';
  const pos = tooth % 10;
  const isPrimary = isPrimaryTooth(tooth);

  if (isPrimary) {
    const letters = ['A', 'B', 'C', 'D', 'E'];
    const letter = letters[pos - 1] || `${pos}`;
    return `${tooth} (${arch} ${side} Deciduous ${letter})`;
  }

  const names = [
    'Central Incisor',
    'Lateral Incisor',
    'Canine',
    'First Premolar',
    'Second Premolar',
    'First Molar',
    'Second Molar',
    'Third Molar (Wisdom)',
  ];
  const name = names[pos - 1] || `Tooth ${pos}`;
  return `${tooth} (${arch} ${side} ${name})`;
}

// Zod schemas for request validation
export const FdiToothSchema = z
  .number()
  .int()
  .refine(isValidFdiTooth, {
    message: 'Invalid FDI tooth number. Must be permanent (11-18, 21-28, 31-38, 41-48) or primary (51-55, 61-65, 71-75, 81-85).',
  });

export const ToothEntrySchema = z
  .object({
    tooth: FdiToothSchema,
    condition: z.string().trim().min(1, 'Condition is required').max(200),
    notes: z.string().trim().max(500).optional().default(''),
  })
  .strict();
