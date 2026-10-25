import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { connectDb } from '@/lib/db';
import { verifyPassword } from '@/lib/passwords';
import { clock } from '@/lib/clock';

export const POST = withAuth(
  async (req: NextRequest, { session, user }) => {
    await connectDb();
    const body = await req.json().catch(() => ({}));
    const { password } = body;

    if (!password || typeof password !== 'string') {
      return NextResponse.json({ error: 'Password is required' }, { status: 400 });
    }

    const valid = await verifyPassword(user.passwordHash, password);
    if (!valid) {
      return NextResponse.json({ error: 'Invalid password' }, { status: 401 });
    }

    session.recentPasswordConfirmAt = clock.now();
    await session.save();

    return NextResponse.json({
      success: true,
      confirmedAt: session.recentPasswordConfirmAt.toISOString(),
    });
  },
  { roles: ['DOCTOR'] }
);
