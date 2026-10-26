import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { oauthProviders } from '@/auth';
import { LogoMark } from '@/components/ui/Logo';
import { getViewer, safeReturnTo } from '@/lib/server/session';
import { signInWithProvider } from './actions';
import { EmailSignInForm } from './EmailSignInForm';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('auth'))('title') };
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const returnTo = safeReturnTo(params.returnTo, '/contribute');
  if (await getViewer()) redirect(returnTo);
  const t = await getTranslations('auth');
  if (process.env.DEMO_MODE === 'true') {
    const td = await getTranslations('demo');
    return (
      <div className="mx-auto max-w-lg py-10 text-center motion-safe:animate-fade-up">
        <LogoMark className="mx-auto size-14" />
        <h1 className="mt-5 font-display text-3xl font-semibold">{td('signInTitle')}</h1>
        <p className="mt-3 text-muted">{td('signInBody')}</p>
        <Link href="/" className="btn btn-primary mt-8">
          {td('explore')}
        </Link>
      </div>
    );
  }
  // Auth.js redirects here with ?error=… for expired links, denied OAuth, etc.
  const authError = typeof params.error === 'string' ? params.error : null;

  return (
    <div className="mx-auto grid w-full max-w-4xl items-center gap-10 py-6 md:grid-cols-2">
      <section className="hidden space-y-4 md:block motion-safe:animate-fade-up">
        <LogoMark className="size-14" />
        <h1 className="font-display text-4xl font-semibold leading-tight">{t('heroTitle')}</h1>
        <p className="text-lg text-muted">{t('heroLead')}</p>
      </section>

      <section className="card p-6 sm:p-8 motion-safe:animate-fade-up" aria-labelledby="signin-title">
        <h2 id="signin-title" className="font-display text-2xl font-semibold">
          {t('title')}
        </h2>
        <p className="mt-1 text-sm text-muted">{t('lead')}</p>

        {authError && (
          <p role="alert" className="mt-4 rounded-xl bg-danger-bg p-3 text-sm text-danger">
            {authError === 'rate_limited' ? t('rateLimited') : authError === 'Verification' ? t('errorVerification') : t('errorDefault')}
          </p>
        )}

        <EmailSignInForm returnTo={returnTo} />

        {oauthProviders.length > 0 && (
          <>
            <div className="my-5 flex items-center gap-3 text-xs uppercase tracking-wider text-muted">
              <span className="h-px flex-1 bg-line" />
              {t('or')}
              <span className="h-px flex-1 bg-line" />
            </div>
            <div className="space-y-2">
              {oauthProviders.map((p) => (
                <form key={p.id} action={signInWithProvider}>
                  <input type="hidden" name="provider" value={p.id} />
                  <input type="hidden" name="returnTo" value={returnTo} />
                  <button type="submit" className="btn btn-secondary w-full">
                    {t('continueWith', { provider: p.name })}
                  </button>
                </form>
              ))}
            </div>
          </>
        )}

        <p className="mt-6 text-xs text-muted">{t('privacy')}</p>
      </section>
    </div>
  );
}
