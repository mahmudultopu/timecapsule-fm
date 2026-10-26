'use server';

import { createHash } from 'node:crypto';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { AuthError } from 'next-auth';
import { z } from 'zod';
import { signIn } from '@/auth';
import { allow, clientIp } from '@/lib/server/rate-limit';
import { securityEvent } from '@/lib/server/security-log';
import { safeReturnTo } from '@/lib/server/session';

export type SignInState = { error?: 'invalid' | 'rate_limited' | 'failed' };

const Email = z.email().max(254);

/**
 * Emails a one-time sign-in link. Limited per IP and per address so the form
 * can't be used to flood someone's inbox. Server actions get Next's built-in
 * Origin check, so this is not callable cross-site.
 */
export async function signInWithEmail(_prev: SignInState, form: FormData): Promise<SignInState> {
  if (process.env.DEMO_MODE === 'true') return { error: 'failed' };
  const email = Email.safeParse(String(form.get('email') ?? '').trim().toLowerCase());
  if (!email.success) return { error: 'invalid' };
  const returnTo = safeReturnTo(String(form.get('returnTo') ?? ''), '/contribute');

  const ip = clientIp(await headers());
  const emailKey = createHash('sha256').update(email.data).digest('hex').slice(0, 32);
  const ok = (await allow(`rl:signin:ip:${ip}`, 10, 15 * 60)) && (await allow(`rl:signin:email:${emailKey}`, 3, 15 * 60));
  if (!ok) {
    await securityEvent({ action: 'auth.rate_limited', ip, details: { method: 'email' } });
    return { error: 'rate_limited' };
  }

  try {
    await signIn('nodemailer', { email: email.data, redirectTo: returnTo, redirect: false });
  } catch (err) {
    if (err instanceof AuthError) {
      await securityEvent({ action: 'auth.sign_in_failed', ip, details: { reason: err.type } });
      return { error: 'failed' };
    }
    throw err;
  }
  redirect('/signin/check-email');
}

export async function signInWithProvider(form: FormData): Promise<void> {
  if (process.env.DEMO_MODE === 'true') return;
  const provider = String(form.get('provider') ?? '');
  if (provider !== 'github' && provider !== 'google') return;
  const ip = clientIp(await headers());
  if (!(await allow(`rl:signin:ip:${ip}`, 10, 15 * 60))) {
    redirect('/signin?error=rate_limited');
  }
  await signIn(provider, { redirectTo: safeReturnTo(String(form.get('returnTo') ?? ''), '/contribute') });
}
