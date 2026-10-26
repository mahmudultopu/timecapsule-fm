import { NextResponse, type NextRequest } from 'next/server';
import { handleDemoRequest, isDemoMode } from '@/lib/demo/handlers';

// Only active in demo mode. In a full deployment the reverse proxy sends
// /api/* to the real API before it ever reaches Next.js, and `next dev`
// proxies it there too (see next.config.ts).

async function handle(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  if (!isDemoMode()) {
    return NextResponse.json({ error: { code: 'not_found', message: 'Not found' } }, { status: 404 });
  }
  const { path } = await params;
  const res = handleDemoRequest(request.method, `/v1/${path.join('/')}`, request.nextUrl.searchParams, request.nextUrl.origin);
  return NextResponse.json(res.body, {
    status: res.status,
    headers: { 'cache-control': res.status === 200 ? 'public, max-age=60' : 'no-store' },
  });
}

export { handle as GET, handle as POST, handle as PATCH, handle as DELETE };
