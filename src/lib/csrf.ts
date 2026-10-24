import { NextRequest } from 'next/server';
import { env } from './env';

export interface CsrfValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validates Origin and Sec-Fetch-Site headers on state-changing requests
 * to protect against Cross-Site Request Forgery (CSRF).
 */
export function verifyCsrf(req: NextRequest): CsrfValidationResult {
  const method = req.method?.toUpperCase();
  const stateChangingMethods = ['POST', 'PUT', 'DELETE', 'PATCH'];

  // Non-mutating methods (GET, HEAD, OPTIONS) do not require CSRF origin validation
  if (!stateChangingMethods.includes(method)) {
    return { valid: true };
  }

  // 1. Check Sec-Fetch-Site if provided by modern browsers
  const secFetchSite = req.headers.get('sec-fetch-site')?.toLowerCase();
  if (secFetchSite === 'cross-site') {
    return {
      valid: false,
      error: 'Forbidden: cross-site requests are rejected (Sec-Fetch-Site: cross-site)',
    };
  }

  // 2. Check Origin header
  const originHeader = req.headers.get('origin');
  const hostHeader = req.headers.get('host') || req.nextUrl?.host;

  if (originHeader) {
    try {
      const originUrl = new URL(originHeader);
      const appUrl = new URL(env.APP_URL);

      // Origin must match either the direct host header or the configured APP_URL host
      const hostMatches =
        hostHeader && (originUrl.host === hostHeader || originUrl.host === hostHeader.split(':')[0]);
      const appUrlMatches = originUrl.host === appUrl.host;

      if (!hostMatches && !appUrlMatches) {
        return {
          valid: false,
          error: `Forbidden: request origin "${originHeader}" does not match host "${hostHeader}"`,
        };
      }
    } catch {
      return { valid: false, error: 'Forbidden: invalid origin header format' };
    }
  } else {
    // 3. Fallback to Referer header if Origin is absent
    const refererHeader = req.headers.get('referer');
    if (refererHeader) {
      try {
        const refererUrl = new URL(refererHeader);
        const appUrl = new URL(env.APP_URL);
        const hostMatches =
          hostHeader && (refererUrl.host === hostHeader || refererUrl.host === hostHeader.split(':')[0]);
        const appUrlMatches = refererUrl.host === appUrl.host;

        if (!hostMatches && !appUrlMatches) {
          return {
            valid: false,
            error: `Forbidden: request referer "${refererHeader}" does not match host "${hostHeader}"`,
          };
        }
      } catch {
        return { valid: false, error: 'Forbidden: invalid referer header format' };
      }
    }
  }

  return { valid: true };
}
