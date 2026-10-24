import { env } from '../src/lib/env';

export function assertSafeDatabase(): void {
  if (env.NODE_ENV === 'production') {
    throw new Error('Refusing to run script: NODE_ENV is production');
  }
  const dbName = env.MONGODB_DB;
  if (!dbName.endsWith('_dev') && !dbName.endsWith('_test')) {
    throw new Error(
      `Refusing to run script: database name "${dbName}" must end in _dev or _test to prevent accidental production overwrite`
    );
  }
}
