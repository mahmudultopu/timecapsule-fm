'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useId } from 'react';
import { signInWithEmail, type SignInState } from './actions';

export function EmailSignInForm({ returnTo }: { returnTo: string }) {
  const t = useTranslations('auth');
  const [state, action, pending] = useActionState<SignInState, FormData>(signInWithEmail, {});
  const id = useId();
  const errorId = `${id}-error`;

  return (
    <form action={action} className="mt-6 space-y-3" noValidate>
      <input type="hidden" name="returnTo" value={returnTo} />
      <div>
        <label htmlFor={id} className="label">
          {t('email')}
        </label>
        <input
          id={id}
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder={t('emailPlaceholder')}
          className="field"
          aria-invalid={state.error === 'invalid'}
          aria-describedby={state.error ? errorId : undefined}
        />
      </div>
      {state.error && (
        <p id={errorId} role="alert" className="text-sm text-danger">
          {state.error === 'invalid' ? t('invalidEmail') : state.error === 'rate_limited' ? t('rateLimited') : t('errorDefault')}
        </p>
      )}
      <button type="submit" className="btn btn-primary w-full" disabled={pending} aria-busy={pending}>
        {pending ? t('sending') : t('sendLink')}
      </button>
    </form>
  );
}
