import { MongoMemoryReplSet } from 'mongodb-memory-server';

async function main() {
  console.log('Starting in-memory MongoDB ReplicaSet on port 27017...');
  const replSet = await MongoMemoryReplSet.create({
    instanceOpts: [{ port: 27017 }],
    replSet: { name: 'rs0', count: 1 },
  });

  console.log('ReplicaSet online at:', replSet.getUri());
  console.log('Ready for dev/e2e connections.');

  const shutdown = async () => {
    console.log('Stopping ReplicaSet...');
    await replSet.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('Failed to start in-memory MongoDB:', err);
  process.exit(1);
});
