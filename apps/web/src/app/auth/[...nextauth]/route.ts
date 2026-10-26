import { NextResponse, type NextRequest } from 'next/server';
import { handlers } from '@/auth';
import { allow, clientIp } from '@/lib/server/rate-limit';
import { securityEvent } from '@/lib/server/security-log';

// Auth.js endpoints (callbacks, sign-out, CSRF). Sign-in itself starts from a
// server action, which is limited separately; this caps everything else.
export const { GET } = handlers;

export async function POST(request: NextRequest) {
  const ip = clientIp(request.headers);
  if (!(await allow(`rl:auth:ip:${ip}`, 30, 60))) {
    await securityEvent({ action: 'auth.rate_limited', ip });
    return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { 'retry-after': '60' } });
  }
  return handlers.POST(request);
}
