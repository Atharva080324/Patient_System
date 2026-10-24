import readline from 'readline';
import { connectDb, disconnectDb } from '../src/lib/db';
import { User } from '../src/models/User';
import { hashPassword, validatePasswordStrength } from '../src/lib/passwords';
import { revokeAllUserSessions } from '../src/lib/auth';
import { clock } from '../src/lib/clock';

function question(rl: readline.Interface, prompt: string): Promise<string> {
  return new Promise((resolve) => rl.question(prompt, resolve));
}

async function main() {
  await connectDb();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log('=== Doctor Password Reset Utility ===\n');

  try {
    const email = (await question(rl, 'Enter Doctor Email: ')).trim().toLowerCase();
    const user = await User.findOne({ email });

    if (!user) {
      console.error(`✗ No user found with email: ${email}`);
      rl.close();
      return;
    }

    let newPassword = '';
    while (true) {
      newPassword = (await question(rl, 'Enter New Password (min 12 characters): ')).trim();
      const check = validatePasswordStrength(newPassword);
      if (!check.valid) {
        console.error(`✗ ${check.error}`);
      } else {
        break;
      }
    }

    rl.close();

    console.log('\nHashing and updating password...');
    const newHash = await hashPassword(newPassword);
    user.passwordHash = newHash;
    user.lastPasswordChangeAt = clock.now();
    await user.save();

    // Revoke all sessions
    await revokeAllUserSessions(user._id, user.clinicId);

    console.log(`✓ Password successfully reset for ${email}. All previous sessions have been revoked.`);
  } finally {
    await disconnectDb();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Fatal error during password reset:', err);
    process.exit(1);
  });
}
