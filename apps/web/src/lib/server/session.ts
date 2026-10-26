import 'server-only';
import type { Session } from 'next-auth';
import { notFound, redirect } from 'next/navigation';
import { cache } from 'react';
import { auth } from '@/auth';

export type Viewer = Session['user'];

/**
 * The signed-in user, or null. Memoised per request, so the header and the
 * page share one session lookup and can never disagree.
 */
export const getViewer = cache(async (): Promise<Viewer | null> => {
  const session = await auth();
  return session?.user?.id ? session.user : null;
});

/**
 * For pages that need an account. Sends visitors to sign in, and first-time
 * users through onboarding (public name + age confirmation), then back here.
 */
export async function requireViewer(returnTo: string): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer) redirect(`/signin?returnTo=${encodeURIComponent(returnTo)}`);
  if (!viewer.onboarded) redirect(`/welcome?returnTo=${encodeURIComponent(returnTo)}`);
  return viewer;
}

/**
 * Moderator pages 404 for everyone else, so their existence isn't advertised.
 * The API enforces the same rule independently.
 */
export async function requireModerator(returnTo: string): Promise<Viewer> {
  const viewer = await requireViewer(returnTo);
  if (viewer.role !== 'moderator' && viewer.role !== 'admin') notFound();
  return viewer;
}

export { safeReturnTo } from '../return-to';
