import PostgresAdapter from '@auth/pg-adapter';
import NextAuth, { type NextAuthConfig } from 'next-auth';
import type { Adapter } from 'next-auth/adapters';
import GitHub from 'next-auth/providers/github';
import Google from 'next-auth/providers/google';
import Nodemailer from 'next-auth/providers/nodemailer';
import nodemailer from 'nodemailer';
import { authPool } from '@/lib/server/db';
import { securityEvent } from '@/lib/server/security-log';

// Sign-in is passwordless: an emailed magic link, or GitHub/Google when their
// credentials are configured. No password is ever stored.

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      role: 'contributor' | 'moderator' | 'admin';
      displayName: string | null;
      /** Has chosen a public name and confirmed they are 16 or older. */
      onboarded: boolean;
    };
  }
}

interface DbUser {
  id: string;
  role: 'contributor' | 'moderator' | 'admin';
  display_name: string | null;
  age_attested_at: Date | null;
  disabled_at: Date | null;
}

/**
 * The stock adapter stores OAuth access/refresh/id tokens. We only need the
 * account link for sign-in, so the tokens are dropped before they're saved.
 */
function privacyAdapter(base: Adapter): Adapter {
  return {
    ...base,
    linkAccount: (account) =>
      base.linkAccount!({
        ...account,
        access_token: undefined,
        refresh_token: undefined,
        id_token: undefined,
        session_state: undefined,
      }),
  };
}

const smtpUrl = process.env.SMTP_URL;
const transport = smtpUrl ? nodemailer.createTransport(smtpUrl) : null;

async function sendMagicLink({ identifier, url }: { identifier: string; url: string }) {
  if (!transport) {
    if (process.env.NODE_ENV === 'production') throw new Error('SMTP_URL is required to send sign-in links');
    // Local development without a mail server: print the link instead.
    console.info(`\n  Sign-in link for ${identifier}:\n  ${url}\n`);
    return;
  }
  const host = new URL(url).host;
  await transport.sendMail({
    to: identifier,
    from: process.env.MAIL_FROM ?? 'TimeCapsule.fm <no-reply@timecapsule.fm>',
    subject: `Sign in to ${host}`,
    text: `Sign in to TimeCapsule.fm:\n${url}\n\nThis link expires in 24 hours and can be used once.\nIf you didn't ask for it, you can ignore this email.\n`,
  });
}

const providers: NextAuthConfig['providers'] = [
  Nodemailer({
    server: smtpUrl ?? 'smtp://localhost:25',
    from: process.env.MAIL_FROM,
    maxAge: 24 * 60 * 60,
    sendVerificationRequest: sendMagicLink,
  }),
];
if (process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET) providers.push(GitHub);
if (process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET) providers.push(Google);

/** Provider ids shown on the sign-in page. */
export const oauthProviders = providers
  .map((p) => (typeof p === 'function' ? p() : p))
  .filter((p) => p.type === 'oauth' || p.type === 'oidc')
  .map((p) => ({ id: p.id, name: p.name }));

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: privacyAdapter(PostgresAdapter(authPool())),
  providers,
  basePath: '/auth',
  trustHost: true,
  session: { strategy: 'database', maxAge: 30 * 24 * 60 * 60, updateAge: 24 * 60 * 60 },
  pages: { signIn: '/signin', verifyRequest: '/signin/check-email', error: '/signin' },
  callbacks: {
    async signIn({ user }) {
      // Disabled accounts can't start new sessions.
      return !(user as unknown as Partial<DbUser>).disabled_at;
    },
    async session({ session, user }) {
      const u = user as unknown as DbUser;
      return {
        ...session,
        user: {
          ...session.user,
          id: u.id,
          role: u.role,
          displayName: u.display_name,
          onboarded: !!u.display_name && !!u.age_attested_at,
        },
      };
    },
  },
  events: {
    async signIn({ user, account }) {
      await securityEvent({ action: 'auth.sign_in', actorId: user.id ?? null, details: { provider: account?.provider ?? 'unknown' } });
    },
    async signOut(message) {
      const userId = 'session' in message && message.session ? (message.session as { userId?: string }).userId : null;
      await securityEvent({ action: 'auth.sign_out', actorId: userId ?? null });
    },
  },
  logger: {
    // Failed sign-ins (bad or expired links, denied OAuth) arrive here.
    error(error) {
      const type = (error as { type?: string }).type ?? error.name;
      void securityEvent({ action: 'auth.sign_in_failed', details: { reason: type } });
    },
    warn() {},
    debug() {},
  },
});
