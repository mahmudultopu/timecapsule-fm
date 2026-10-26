'use client';

import { SubmissionDetail } from '@timecapsule/shared';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useToast } from '@/components/ui/Toast';
import { api } from '@/lib/client-api';

export function NewSubmissionButton() {
  const t = useTranslations('contribute');
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-accent"
      disabled={busy}
      aria-busy={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const draft = await api('/v1/submissions', { method: 'POST', body: {}, schema: SubmissionDetail });
          router.push(`/contribute/${draft.id}`);
        } catch {
          toast(t('createFailed'), 'error');
          setBusy(false);
        }
      }}
    >
      + {t('new')}
    </button>
  );
}
