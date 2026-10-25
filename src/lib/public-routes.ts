/**
 * Explicit allowlist of routes that are permitted to be wrapped with publicRoute.
 * The route inventory test validates that NO protected endpoint is accidentally public
 * and that any public route is explicitly registered here.
 */
export const PUBLIC_ROUTES_ALLOWLIST: string[] = [
  '/api/health',
  '/api/auth/login',
  '/api/auth/login-2fa',
  '/api/kiosk/unlock',
  '/api/integrations/appointments',
  '/api/integrations/appointments/[externalId]',
  '/api/integrations/busy',
];

export function isAllowedPublicRoute(pathname: string): boolean {
  return PUBLIC_ROUTES_ALLOWLIST.includes(pathname);
}
