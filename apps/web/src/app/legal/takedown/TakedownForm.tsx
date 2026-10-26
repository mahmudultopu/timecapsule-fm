'use client';

import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { CheckboxField, SelectField, TextArea, TextField } from '@/components/contribute/fields';
import { ApiRequestError, api } from '@/lib/client-api';

type Basis = 'copyright' | 'privacy' | 'other';

/** Public takedown request. Works signed in or not; rate limited by the API. */
export function TakedownForm({ prefillUrl }: { prefillUrl: string }) {
  const t = useTranslations('legal');
  const emailId = useId();
  // A relative path is enough: the API finds the recording ID anywhere in the text.
  const [url, setUrl] = useState<string | null>(prefillUrl || null);
  const [name, setName] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [basis, setBasis] = useState<Basis | null>(null);
  const [statement, setStatement] = useState<string | null>(null);
  const [goodFaith, setGoodFaith] = useState(false);
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error' | 'limited'>('idle');

  if (state === 'sent') {
    return (
      <div role="status" className="mt-6 rounded-2xl bg-success-bg p-5 text-success motion-safe:animate-fade-up">
        <p className="font-semibold">{t('sentTitle')}</p>
        <p className="mt-1 text-sm">{t('sentBody')}</p>
      </div>
    );
  }

  const ready = !!name?.trim() && /\S+@\S+/.test(email) && !!basis && (statement?.trim().length ?? 0) >= 20 && goodFaith;

  return (
    <form
      className="mt-5 space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!ready) return;
        setState('sending');
        try {
          await api('/v1/takedowns', {
            method: 'POST',
            body: {
              recordingUrl: url ?? undefined,
              claimantName: name,
              claimantEmail: email.trim(),
              basis,
              statement,
              goodFaith: true,
            },
          });
          setState('sent');
        } catch (err) {
          setState(err instanceof ApiRequestError && err.status === 429 ? 'limited' : 'error');
        }
      }}
    >
      <TextField label={t('fieldUrl')} help={t('fieldUrlHelp')} maxLength={500} value={url} onChange={setUrl} />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label={t('fieldName')} required maxLength={200} value={name} onChange={setName} />
        <div>
          <label htmlFor={emailId} className="label">
            {t('fieldEmail')}
            <span className="ms-1 text-accent" aria-hidden="true">*</span>
          </label>
          <input id={emailId} type="email" autoComplete="email" className="field" value={email} maxLength={254} required onChange={(e) => setEmail(e.target.value)} />
        </div>
      </div>
      <SelectField
        label={t('fieldBasis')}
        required
        placeholder={t('choose')}
        value={basis}
        onChange={setBasis}
        options={[
          { value: 'copyright', label: t('basis.copyright') },
          { value: 'privacy', label: t('basis.privacy') },
          { value: 'other', label: t('basis.other') },
        ]}
      />
      <TextArea label={t('fieldStatement')} help={t('fieldStatementHelp')} required maxLength={10000} rows={5} value={statement} onChange={setStatement} />
      <CheckboxField label={t('goodFaith')} checked={goodFaith} onChange={setGoodFaith} />
      {(state === 'error' || state === 'limited') && (
        <p role="alert" className="text-sm text-danger">
          {state === 'limited' ? t('limited') : t('sendFailed')}
        </p>
      )}
      <button type="submit" className="btn btn-primary w-full" disabled={!ready || state === 'sending'} aria-busy={state === 'sending'}>
        {t('send')}
      </button>
      <p className="text-xs text-muted">{t('formPrivacy')}</p>
    </form>
  );
}
