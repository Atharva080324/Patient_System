import { generateSecret, generateURI, verifySync, generateSync } from 'otplib';
import QRCode from 'qrcode';
import crypto from 'crypto';
import { hashToken } from './passwords';

export interface TOTPSetupResult {
  secret: string;
  otpauthUrl: string;
  qrCodeDataUrl: string;
  recoveryCodes: string[];
  hashedRecoveryCodes: Array<{ hash: string; usedAt?: Date }>;
}

export function generateTOTPSecret(): string {
  return generateSecret();
}

export function getTOTPUrl(email: string, secret: string, issuer = "Dr. Susheel's Dental Clinic"): string {
  return generateURI({
    secret,
    label: email,
    issuer,
  });
}

export async function generateTOTPSetup(email: string): Promise<TOTPSetupResult> {
  const secret = generateTOTPSecret();
  const otpauthUrl = getTOTPUrl(email, secret);
  const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl);

  const recoveryCodes: string[] = [];
  const hashedRecoveryCodes: Array<{ hash: string; usedAt?: Date }> = [];

  for (let i = 0; i < 10; i++) {
    const code = crypto.randomBytes(5).toString('hex').toUpperCase();
    recoveryCodes.push(code);
    hashedRecoveryCodes.push({
      hash: hashToken(code),
    });
  }

  return {
    secret,
    otpauthUrl,
    qrCodeDataUrl,
    recoveryCodes,
    hashedRecoveryCodes,
  };
}

export function verifyTOTPCode(token: string, secret: string): boolean {
  try {
    const res = verifySync({ token, secret });
    return res.valid;
  } catch {
    return false;
  }
}

export function generateTOTPCode(secret: string): string {
  return generateSync({ secret });
}

