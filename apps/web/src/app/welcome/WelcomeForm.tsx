'use client';

import { Profile } from '@timecapsule/shared';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { api } from '@/lib/client-api';

export function WelcomeForm({ returnTo, initialName }: { returnTo: string; initialName: string }) {
  const t = useTranslations('welcome');
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [age, setAge] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ids = { name: useId(), age: useId(), help: useId() };

  return (
    <form
      className="mt-6 space-y-5"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!name.trim() || !age) return setError(t('incomplete'));
        setBusy(true);
        setError(null);
        try {
          await api('/v1/me', { method: 'PATCH', body: { displayName: name.trim(), ageAttested: true }, schema: Profile });
          // A full navigation refreshes the session (and header) with the new name.
          router.replace(returnTo);
          router.refresh();
        } catch {
          setError(t('failed'));
          setBusy(false);
        }
      }}
    >
      <div>
        <label htmlFor={ids.name} className="label">
          {t('displayName')}
        </label>
        <input
          id={ids.name}
          className="field"
          value={name}
          maxLength={80}
          required
          autoComplete="nickname"
          onChange={(e) => setName(e.target.value)}
          aria-describedby={ids.help}
          dir="auto"
        />
        <p id={ids.help} className="help">
          {t('displayNameHelp')}
        </p>
      </div>
      <label htmlFor={ids.age} className="flex items-start gap-3 rounded-xl border border-line p-3">
        <input id={ids.age} type="checkbox" className="mt-0.5 size-5 accent-accent" checked={age} onChange={(e) => setAge(e.target.checked)} />
        <span className="text-sm">{t('age')}</span>
      </label>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <button type="submit" className="btn btn-primary w-full" disabled={busy} aria-busy={busy}>
        {t('continue')}
      </button>
    </form>
  );
}
