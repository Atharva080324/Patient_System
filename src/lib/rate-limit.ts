import { RateLimit } from '../models/RateLimit';
import { clock } from './clock';

export interface RateLimitResult {
  allowed: boolean;
  count: number;
  remaining: number;
  retryAfterSeconds: number;
}

/**
 * MongoDB-backed fixed-window rate limiter using atomic upserts.
 * Works strictly without in-memory state, making it serverless and multi-instance safe.
 */
export async function rateLimit(
  key: string,
  limit: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  const now = clock.now();
  const nowMs = now.getTime();
  const windowMs = windowSeconds * 1000;

  // Fixed window boundary
  const windowStartMs = Math.floor(nowMs / windowMs) * windowMs;
  const windowEndMs = windowStartMs + windowMs;

  const docId = `${key}:${windowStartMs}`;

  const doc = await RateLimit.findOneAndUpdate(
    { _id: docId },
    {
      $inc: { count: 1 },
      $setOnInsert: {
        _id: docId,
        key,
        windowStart: new Date(windowStartMs),
        expireAt: new Date(windowEndMs + 60 * 1000), // retain slightly past window for TTL
      },
    },
    { upsert: true, new: true }
  );

  const count = doc.count;
  const allowed = count <= limit;
  const remaining = Math.max(0, limit - count);
  const retryAfterSeconds = Math.max(1, Math.ceil((windowEndMs - nowMs) / 1000));

  return {
    allowed,
    count,
    remaining,
    retryAfterSeconds,
  };
}

/**
 * Standard rate limiting presets per specification:
 * - Login failures: 5 per email per 15 min, 20 per IP per 15 min
 * - Kiosk unlock: 5 per IP per 15 min
 * - Default API: 120 per minute per IP
 */
export const RateLimitRules = {
  loginEmailFailure: (email: string) => rateLimit(`login:email:fail:${email.toLowerCase()}`, 5, 15 * 60),
  loginIpFailure: (ip: string) => rateLimit(`login:ip:fail:${ip}`, 20, 15 * 60),
  kioskUnlockIp: (ip: string) => rateLimit(`kiosk:unlock:${ip}`, 5, 15 * 60),
  defaultApi: (ip: string) => rateLimit(`api:ip:${ip}`, 120, 60),
};
