import { NextResponse } from 'next/server';
import { publicRoute } from '@/lib/auth';
import { clock } from '@/lib/clock';

export const GET = publicRoute(async () => {
  return NextResponse.json({ status: 'ok', timestamp: clock.now().toISOString() });
});
