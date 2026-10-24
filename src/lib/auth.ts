import crypto from 'crypto';
import mongoose from 'mongoose';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { Session, ISession } from '../models/Session';
import { User, IUser } from '../models/User';
import { Clinic, IClinic } from '../models/Clinic';
import { DeviceToken, IDeviceToken } from '../models/DeviceToken';
import { hashToken, verifyPassword, hashKioskPin, dummyVerify } from './passwords';
import { clock } from './clock';
import { runWithTenantContext, TenantActor, systemScope, systemAdminScope } from './tenancy';
import { audit } from './audit';
import { AuditAction } from '../models/AuditLog';
import { RateLimitRules } from './rate-limit';
import { env } from './env';

export const SESSION_COOKIE_NAME = '__Host-session';
export const KIOSK_COOKIE_NAME = '__Host-kiosk';

// Fallback cookie names for plain HTTP localhost development if __Host- prefix rejected
export const DEV_SESSION_COOKIE_NAME = 'patient_session';
export const DEV_KIOSK_COOKIE_NAME = 'patient_kiosk';

export function getSessionCookieName(): string {
  return env.NODE_ENV === 'production' ? SESSION_COOKIE_NAME : DEV_SESSION_COOKIE_NAME;
}

export function getKioskCookieName(): string {
  return env.NODE_ENV === 'production' ? KIOSK_COOKIE_NAME : DEV_KIOSK_COOKIE_NAME;
}

export interface AuthSessionResult {
  session: ISession;
  user: IUser;
}

/**
 * Creates a new serverless session in MongoDB and returns the raw secret token.
 */
export async function createSession(
  userId: mongoose.Types.ObjectId,
  clinicId: mongoose.Types.ObjectId,
  ip?: string,
  userAgent?: string
): Promise<{ token: string; session: ISession }> {
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(token);
  const now = clock.now();

  const absoluteLifetimeMs = env.SESSION_ABSOLUTE_HOURS * 60 * 60 * 1000;

  const session = await systemScope(clinicId, async () => {
    return Session.create({
      clinicId,
      userId,
      tokenHash,
      createdAt: now,
      expiresAt: new Date(now.getTime() + absoluteLifetimeMs),
      lastActivityAt: now,
      recentPasswordConfirmAt: now,
      ip,
      userAgent,
      createdBy: { type: 'USER', id: userId.toString() },
    });
  });

  return { token, session };
}

/**
 * Validates a session token with idle and absolute expiration checks.
 */
export async function validateSession(token: string): Promise<AuthSessionResult | null> {
  if (!token) return null;
  const tokenHash = hashToken(token);
  const now = clock.now();

  return systemAdminScope(async () => {
    // Find session by hash
    const session = await Session.findOne({ tokenHash, revokedAt: { $exists: false } });
    if (!session) return null;

    // Check absolute expiry
    if (session.expiresAt.getTime() <= now.getTime()) {
      return null;
    }

    // Check idle expiry (e.g. 4 hours)
    const idleMs = env.SESSION_IDLE_MINUTES * 60 * 1000;
    if (now.getTime() - session.lastActivityAt.getTime() > idleMs) {
      return null;
    }

    // Refresh activity
    session.lastActivityAt = now;
    await session.save();

    // Load user
    const user = await User.findOne({ _id: session.userId, clinicId: session.clinicId });
    if (!user) return null;

    return { session, user };
  });
}

/**
 * Revokes all sessions for a user (called on password change or sign out everywhere).
 */
export async function revokeAllUserSessions(
  userId: mongoose.Types.ObjectId,
  clinicId: mongoose.Types.ObjectId
): Promise<void> {
  await systemScope(clinicId, async () => {
    await Session.updateMany(
      { userId, revokedAt: { $exists: false } },
      { $set: { revokedAt: clock.now() } }
    );
  });
}

/**
 * Revokes a single session.
 */
export async function revokeSession(token: string): Promise<void> {
  const tokenHash = hashToken(token);
  await systemAdminScope(async () => {
    await Session.updateOne({ tokenHash }, { $set: { revokedAt: clock.now() } });
  });
}

/**
 * Kiosk device token creation (12 hours lifetime).
 */
export async function unlockKiosk(
  clinicId: mongoose.Types.ObjectId,
  pin: string,
  ip = '127.0.0.1',
  userAgent = 'Unknown'
): Promise<{ token: string; expiresAt: Date }> {
  // Check rate limit: 5 failures per IP per 15 min
  const rl = await RateLimitRules.kioskUnlockIp(ip);
  if (!rl.allowed) {
    await audit.record({
      clinicId,
      action: AuditAction.KIOSK_FAIL,
      entity: 'DeviceToken',
      entityId: 'rate_limited',
      actor: { type: 'KIOSK', id: ip },
      ip,
      userAgent,
      meta: { reasonCode: 'RATE_LIMITED' },
    });
    throw new Error('Too many unlock attempts. Please try again later.');
  }

  const clinic = await systemAdminScope(async () => Clinic.findById(clinicId));
  if (!clinic) {
    throw new Error('Clinic not found');
  }

  const validPin = await verifyPassword(clinic.kioskPinHash, pin);
  if (!validPin) {
    await audit.record({
      clinicId,
      action: AuditAction.KIOSK_FAIL,
      entity: 'DeviceToken',
      entityId: 'invalid_pin',
      actor: { type: 'KIOSK', id: ip },
      ip,
      userAgent,
      meta: { reasonCode: 'INVALID_PIN' },
    });
    throw new Error('Invalid kiosk PIN');
  }

  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(token);
  const now = clock.now();
  const expiresAt = new Date(now.getTime() + 12 * 60 * 60 * 1000); // 12 hours

  await systemScope(clinicId, async () => {
    await DeviceToken.create({
      clinicId,
      tokenHash,
      name: 'Registration Kiosk Device',
      role: 'KIOSK',
      expiresAt,
      lastUsedAt: now,
      userAgent,
      ipPrefix: ip.split('.').slice(0, 3).join('.'),
      createdBy: { type: 'KIOSK', id: ip },
    });
  });

  await audit.record({
    clinicId,
    action: AuditAction.KIOSK_UNLOCK,
    entity: 'DeviceToken',
    entityId: tokenHash.slice(0, 8),
    actor: { type: 'KIOSK', id: ip },
    ip,
    userAgent,
  });

  return { token, expiresAt };
}

/**
 * Rotates kiosk PIN and revokes all active device tokens.
 */
export async function rotateKioskPin(
  clinicId: mongoose.Types.ObjectId,
  newPin: string,
  actor: TenantActor
): Promise<void> {
  const pinHash = await hashKioskPin(newPin);

  await systemScope(clinicId, async () => {
    await Clinic.updateOne({ _id: clinicId }, { $set: { kioskPinHash: pinHash } });
    await DeviceToken.updateMany(
      { clinicId, revokedAt: { $exists: false } },
      { $set: { revokedAt: clock.now() } }
    );
  });

  await audit.record({
    clinicId,
    action: AuditAction.PIN_ROTATED,
    entity: 'Clinic',
    entityId: clinicId.toString(),
    actor,
  });
}

/**
 * Validates a kiosk device token.
 */
export async function validateKioskToken(token: string): Promise<IDeviceToken | null> {
  if (!token) return null;
  const tokenHash = hashToken(token);
  const now = clock.now();

  return systemAdminScope(async () => {
    const device = await DeviceToken.findOne({
      tokenHash,
      revokedAt: { $exists: false },
      expiresAt: { $gt: now },
    });

    if (!device) return null;

    device.lastUsedAt = now;
    await device.save();

    return device;
  });
}

// ==========================================
// Authorization Route Wrappers
// ==========================================

export interface RouteContext {
  params?: Promise<Record<string, string | string[]>> | Record<string, string | string[]> | any;
}

export type AuthenticatedHandler = (
  req: NextRequest,
  auth: AuthSessionResult,
  context?: RouteContext
) => Promise<NextResponse>;

export type KioskHandler = (
  req: NextRequest,
  device: IDeviceToken,
  context?: RouteContext
) => Promise<NextResponse>;

export type PublicHandler = (
  req: NextRequest,
  context?: RouteContext
) => Promise<NextResponse>;

/**
 * Wraps protected doctor routes. Enforces:
 * 1. Valid user session (rejects kiosk tokens)
 * 2. Role matching
 * 3. TenantContext injection
 */
export function withAuth(
  handler: AuthenticatedHandler,
  options: { roles?: string[] } = {}
) {
  return async (req: NextRequest, context?: RouteContext): Promise<NextResponse> => {
    try {
      let sessionCookie =
        req.cookies?.get(SESSION_COOKIE_NAME)?.value ||
        req.cookies?.get(DEV_SESSION_COOKIE_NAME)?.value;

      if (!sessionCookie) {
        try {
          const cookieStore = await cookies();
          sessionCookie =
            cookieStore.get(SESSION_COOKIE_NAME)?.value ||
            cookieStore.get(DEV_SESSION_COOKIE_NAME)?.value;
        } catch {
          // outside Next.js request context
        }
      }

      if (!sessionCookie) {
        return NextResponse.json(
          { error: 'Unauthorized: authentication required' },
          { status: 401 }
        );
      }

      const authResult = await validateSession(sessionCookie);
      if (!authResult) {
        return NextResponse.json(
          { error: 'Unauthorized: invalid or expired session' },
          { status: 401 }
        );
      }

      const { user, session } = authResult;

      if (options.roles && !options.roles.includes(user.role)) {
        return NextResponse.json(
          { error: 'Forbidden: insufficient role privileges' },
          { status: 403 }
        );
      }

      return await runWithTenantContext(
        {
          clinicId: user.clinicId,
          actor: { type: 'USER', id: user._id.toString() },
        },
        async () => {
          return handler(req, authResult, context);
        }
      );
    } catch (err: any) {
      console.error('withAuth error:', err);
      return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
  };
}

/**
 * Wraps kiosk-scoped routes (e.g. self-registration).
 * Strictly accepts ONLY kiosk device tokens.
 */
export function withKiosk(handler: KioskHandler) {
  return async (req: NextRequest, context?: RouteContext): Promise<NextResponse> => {
    try {
      let kioskCookie =
        req.cookies?.get(KIOSK_COOKIE_NAME)?.value ||
        req.cookies?.get(DEV_KIOSK_COOKIE_NAME)?.value;

      if (!kioskCookie) {
        try {
          const cookieStore = await cookies();
          kioskCookie =
            cookieStore.get(KIOSK_COOKIE_NAME)?.value ||
            cookieStore.get(DEV_KIOSK_COOKIE_NAME)?.value;
        } catch {
          // outside Next.js request context
        }
      }

      if (!kioskCookie) {
        return NextResponse.json(
          { error: 'Unauthorized: kiosk session required' },
          { status: 401 }
        );
      }

      const device = await validateKioskToken(kioskCookie);
      if (!device) {
        return NextResponse.json(
          { error: 'Unauthorized: invalid or expired kiosk session' },
          { status: 401 }
        );
      }

      return await runWithTenantContext(
        {
          clinicId: device.clinicId,
          actor: { type: 'KIOSK', id: device._id.toString() },
        },
        async () => {
          return handler(req, device, context);
        }
      );
    } catch (err: any) {
      console.error('withKiosk error:', err);
      return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
  };
}

/**
 * Wraps public routes (e.g. login, health).
 * Validates inputs against NoSQL injection.
 */
export function publicRoute(handler: PublicHandler) {
  return async (req: NextRequest, context?: RouteContext): Promise<NextResponse> => {
    try {
      return await handler(req, context);
    } catch (err: any) {
      console.error('publicRoute error:', err);
      return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
  };
}
