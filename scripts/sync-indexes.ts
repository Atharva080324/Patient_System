import { connectDb, disconnectDb } from '../src/lib/db';
import { syncDatabaseIndexes } from '../src/lib/sync-indexes';

async function main() {
  console.log('Synchronizing database indexes...');
  await connectDb();
  const results = await syncDatabaseIndexes();

  let hasError = false;
  for (const [modelName, result] of Object.entries(results)) {
    if (result.success) {
      console.log(`✓ ${modelName}: Indexes synchronized`);
    } else {
      console.error(`✗ ${modelName}: Error synchronizing indexes:`, result.error);
      hasError = true;
    }
  }

  await disconnectDb();
  if (hasError) {
    process.exit(1);
  }
  console.log('Index synchronization completed successfully.');
}

main().catch((err) => {
  console.error('Fatal error during index sync:', err);
  process.exit(1);
});
