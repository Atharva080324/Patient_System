import crypto from 'crypto';
import { connectDb, disconnectDb } from '../src/lib/db';
import { Clinic } from '../src/models/Clinic';
import { IntegrationKey } from '../src/models/IntegrationKey';
import { encryptSecret } from '../src/lib/hmac';
import { systemAdminScope } from '../src/lib/tenancy';

async function main() {
  await connectDb();
  await systemAdminScope(async () => {
    const clinic = await Clinic.findOne();
    if (!clinic) {
      console.error('No clinic found. Please seed the database first.');
      process.exit(1);
    }
    const keyId = `key_${crypto.randomBytes(8).toString('hex')}`;
    const secret = crypto.randomBytes(32).toString('hex');
    const encryptedSecret = encryptSecret(secret);

    const name = process.argv[2] || 'Default External Bot Key';
    await IntegrationKey.create({
      clinicId: clinic._id,
      keyId,
      encryptedSecret,
      name,
      active: true,
      schemaVersion: 1,
      createdBy: { type: 'SYSTEM', id: 'cli' },
    });

    console.log('--------------------------------------------------');
    console.log('✓ Integration Key Generated Successfully');
    console.log(`Clinic ID: ${clinic._id}`);
    console.log(`Key ID:    ${keyId}`);
    console.log(`Secret:    ${secret}`);
    console.log('--------------------------------------------------');
    console.log('IMPORTANT: Store this secret securely now. It will never be displayed again.');
    console.log('--------------------------------------------------');
  });
  await disconnectDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
