import { NextResponse } from 'next/server';
import { publicRoute } from '@/lib/auth';

export const GET = publicRoute(async () => {
  return NextResponse.json({ status: 'ok', timestamp: new Date().toISOString() });
});
