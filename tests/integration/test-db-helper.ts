import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';

let replSet: MongoMemoryReplSet | null = null;

export async function setupTestReplSet(): Promise<string> {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }

  if (!replSet) {
    replSet = await MongoMemoryReplSet.create({
      replSet: { count: 1, name: 'rs0' },
    });
  }

  const uri = replSet.getUri();
  await mongoose.connect(uri, {
    dbName: 'patient_test',
  });

  return uri;
}

export async function teardownTestReplSet(): Promise<void> {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  if (replSet) {
    await replSet.stop();
    replSet = null;
  }
}

export async function clearTestDatabase(): Promise<void> {
  if (mongoose.connection.readyState !== 0) {
    const collections = mongoose.connection.collections;
    for (const key in collections) {
      await collections[key].deleteMany({});
    }
  }
}
