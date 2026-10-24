import readline from 'readline';
import { connectDb, disconnectDb } from '../src/lib/db';
import { Clinic } from '../src/models/Clinic';
import { User } from '../src/models/User';
import { hashPassword, validatePasswordStrength } from '../src/lib/passwords';
import { systemScope } from '../src/lib/tenancy';

function question(rl: readline.Interface, prompt: string): Promise<string> {
  return new Promise((resolve) => rl.question(prompt, resolve));
}

async function main() {
  await connectDb();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log('=== Create Initial Clinic and Doctor Administrator ===\n');

  try {
    const existingClinic = await Clinic.findOne();
    if (existingClinic) {
      console.log(`Clinic already exists: "${existingClinic.name}".`);
      const proceed = await question(rl, 'Create another user or override doctor? (y/N): ');
      if (proceed.trim().toLowerCase() !== 'y') {
        console.log('Aborted.');
        rl.close();
        await disconnectDb();
        return;
      }
    }

    const clinicName = (await question(rl, 'Clinic Name (e.g. Dr. Susheel\'s Advanced Dental Clinic): ')).trim();
    const address = (await question(rl, 'Clinic Address: ')).trim();
    const phone = (await question(rl, 'Clinic Phone Number (10 digits): ')).trim();
    const registrationNo = (await question(rl, 'Clinic Registration No: ')).trim();
    const kioskPin = (await question(rl, 'Set 4-digit Kiosk PIN (e.g. 1234): ')).trim();

    const doctorName = (await question(rl, 'Doctor Name (e.g. Dr. Susheel Chauthmal): ')).trim();
    const email = (await question(rl, 'Doctor Login Email: ')).trim().toLowerCase();

    let password = '';
    while (true) {
      password = (await question(rl, 'Doctor Password (min 12 characters): ')).trim();
      const check = validatePasswordStrength(password);
      if (!check.valid) {
        console.error(`✗ ${check.error}`);
      } else {
        break;
      }
    }

    rl.close();

    console.log('\nCreating Clinic and Doctor account...');
    const pinHash = await hashPassword(kioskPin || '1234');
    const passwordHash = await hashPassword(password);

    let clinic = existingClinic;
    if (!clinic) {
      clinic = await Clinic.create({
        name: clinicName || "Dr. Susheel's Advanced Dental Clinic & Implant Center",
        address: address || 'City Pride Complex, Jalna Road, Chhatrapati Sambhajinagar',
        phone: phone || '9822000000',
        email,
        registrationNo: registrationNo || 'MH-CS-DEN-2024-001',
        timezone: 'Asia/Kolkata',
        paperSize: 'A5',
        kioskPinHash: pinHash,
        createdBy: { type: 'SYSTEM', id: 'admin:create' },
      });
    }

    const clinicId = clinic._id;

    await systemScope(clinicId, async () => {
      let user = await User.findOne({ clinicId, email });
      if (user) {
        user.name = doctorName;
        user.passwordHash = passwordHash;
        await user.save();
        console.log(`✓ Updated existing Doctor account (${email})`);
      } else {
        user = await User.create({
          clinicId,
          name: doctorName || 'Dr. Susheel Chauthmal',
          email,
          passwordHash,
          role: 'DOCTOR',
          totpEnabled: false,
          recoveryCodes: [],
          createdBy: { type: 'SYSTEM', id: 'admin:create' },
        });
        console.log(`✓ Doctor account created successfully (${email})`);
      }
    });

    console.log('\nSetup completed successfully! You can now log in at /login.');
  } finally {
    await disconnectDb();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Fatal error during admin:create:', err);
    process.exit(1);
  });
}
