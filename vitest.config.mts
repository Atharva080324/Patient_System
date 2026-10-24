import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/e2e/**/*', 'node_modules/**/*'],
    fileParallelism: false,
    testTimeout: 60000,
    hookTimeout: 60000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: [
        'src/lib/money.ts',
        'src/lib/counters.ts',
        'src/lib/clock.ts',
        'src/lib/date.ts',
        'src/lib/tenancy.ts',
        'src/lib/rate-limit.ts',
        'src/lib/auth.ts',
        'src/lib/passwords.ts',
        'src/lib/totp.ts',
        'src/lib/qr.ts',
        'src/lib/csrf.ts',
        'src/lib/visit-state-machine.ts',
        'src/lib/duplicate-detector.ts',
        'src/lib/registration-service.ts',
        'src/lib/queue-service.ts',
        'src/lib/closing-report-service.ts',
      ],
      thresholds: {
        perFile: true,
        lines: 90,
        functions: 90,
        branches: 90,
        statements: 90,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
});
