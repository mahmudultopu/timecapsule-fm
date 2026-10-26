'use client';

import { Profile } from '@timecapsule/shared';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { useToast } from '@/components/ui/Toast';
import { api } from '@/lib/client-api';

export function ProfileForm({ profile }: { profile: Profile }) {
  const t = useTranslations('account');
  const toast = useToast();
  const router = useRouter();
  const [name, setName] = useState(profile.displayName ?? '');
  const [emails, setEmails] = useState(profile.emailNotifications);
  const [busy, setBusy] = useState(false);
  const ids = { name: useId(), emails: useId() };

  return (
    <form
      className="mt-4 space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await api('/v1/me', {
            method: 'PATCH',
            body: { displayName: name.trim(), emailNotifications: emails },
            schema: Profile,
          });
          toast(t('saved'));
          router.refresh();
        } catch {
          toast(t('saveFailed'), 'error');
        } finally {
          setBusy(false);
        }
      }}
    >
      <div>
        <label htmlFor={ids.name} className="label">
          {t('displayName')}
        </label>
        <input id={ids.name} className="field" value={name} maxLength={80} required onChange={(e) => setName(e.target.value)} dir="auto" />
        <p className="help">{t('displayNameHelp')}</p>
      </div>
      <label htmlFor={ids.emails} className="flex items-start gap-3">
        <input id={ids.emails} type="checkbox" className="mt-0.5 size-5 accent-accent" checked={emails} onChange={(e) => setEmails(e.target.checked)} />
        <span className="text-sm">
          <span className="font-semibold">{t('emailNotifications')}</span>
          <span className="block text-muted">{t('emailNotificationsHelp')}</span>
        </span>
      </label>
      <button type="submit" className="btn btn-primary" disabled={busy} aria-busy={busy}>
        {t('save')}
      </button>
    </form>
  );
}

export function MarkReadButton() {
  const t = useTranslations('account');
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-ghost text-sm"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await api('/v1/me/notifications/read', { method: 'POST' }).catch(() => undefined);
        router.refresh();
        setBusy(false);
      }}
    >
      {t('markAllRead')}
    </button>
  );
}
