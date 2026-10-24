import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { PUBLIC_ROUTES_ALLOWLIST } from '@/lib/public-routes';

interface RouteCheckResult {
  filePath: string;
  routePath: string;
  valid: boolean;
  error?: string;
}

export function checkRouteFile(filePath: string, content: string): RouteCheckResult {
  const normalizedPath = filePath.replace(/\\/g, '/');
  // Extract route path like /api/auth/login from src/app/api/auth/login/route.ts
  const match = normalizedPath.match(/src\/app(\/api\/.*?)\/route\.ts/);
  const routePath = match ? match[1] : filePath;

  const httpMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

  for (const method of httpMethods) {
    const exportRegex = new RegExp(`export\\s+const\\s+${method}\\s*=\\s*([a-zA-Z0-9_]+)\\s*\\(`, 'm');
    const exportMatch = content.match(exportRegex);

    if (exportMatch) {
      const wrapperName = exportMatch[1];
      const validWrappers = ['withAuth', 'withKiosk', 'publicRoute'];

      if (!validWrappers.includes(wrapperName)) {
        return {
          filePath,
          routePath,
          valid: false,
          error: `Handler "${method}" is wrapped with unknown wrapper "${wrapperName}". Must use withAuth, withKiosk, or publicRoute.`,
        };
      }

      if (wrapperName === 'publicRoute') {
        if (!PUBLIC_ROUTES_ALLOWLIST.includes(routePath)) {
          return {
            filePath,
            routePath,
            valid: false,
            error: `Route "${routePath}" is wrapped with publicRoute but is NOT registered in PUBLIC_ROUTES_ALLOWLIST.`,
          };
        }
      }
    } else {
      // Check if method is exported without wrapper e.g. export async function GET or export const GET = async
      const rawAsyncExport = new RegExp(`export\\s+(async\\s+function\\s+${method}|const\\s+${method}\\s*=\\s*async)`, 'm');
      if (rawAsyncExport.test(content)) {
        return {
          filePath,
          routePath,
          valid: false,
          error: `Handler "${method}" is exported directly without withAuth, withKiosk, or publicRoute wrapper!`,
        };
      }
    }
  }

  return { filePath, routePath, valid: true };
}

describe('A6: Route Inventory & Security Wrapper Verification', () => {
  const apiDir = path.resolve(__dirname, '../../src/app/api');

  function getRouteFiles(dir: string): string[] {
    let files: string[] = [];
    const items = fs.readdirSync(dir, { withFileTypes: true });
    for (const item of items) {
      const fullPath = path.join(dir, item.name);
      if (item.isDirectory()) {
        files = files.concat(getRouteFiles(fullPath));
      } else if (item.name === 'route.ts') {
        files.push(fullPath);
      }
    }
    return files;
  }

  it('scans all app/api routes and asserts every handler is wrapped in withAuth, withKiosk, or publicRoute on allowlist', () => {
    const routeFiles = getRouteFiles(apiDir);
    expect(routeFiles.length).toBeGreaterThan(0);

    for (const file of routeFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      const result = checkRouteFile(file, content);
      expect(
        result.valid,
        `Route verification failed in ${result.filePath}: ${result.error}`
      ).toBe(true);
    }
  });

  it('deliberate negative test: detects and fails on an unwrapped route handler', () => {
    const unwrappedContent = `
      import { NextResponse } from 'next/server';
      export const GET = async (req) => {
        return NextResponse.json({ leaked: true });
      };
    `;

    const result = checkRouteFile('src/app/api/unprotected/test/route.ts', unwrappedContent);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/without withAuth, withKiosk, or publicRoute wrapper|Must use withAuth, withKiosk, or publicRoute/);
  });

  it('deliberate negative test: detects and fails if a public route is not in allowlist', () => {
    const unauthorizedPublicContent = `
      import { NextResponse } from 'next/server';
      import { publicRoute } from '@/lib/auth';
      export const GET = publicRoute(async () => {
        return NextResponse.json({ test: true });
      });
    `;

    const result = checkRouteFile('src/app/api/secret/bypass/route.ts', unauthorizedPublicContent);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('NOT registered in PUBLIC_ROUTES_ALLOWLIST');
  });
});
