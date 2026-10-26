'use client';

import {
  DATE_CONFIDENCES,
  LICENSES,
  SOUND_CATEGORIES,
  SOURCE_TYPES,
  SPEECH_CONSENTS,
  SubmissionDetail,
  SubmissionFields,
  type Agreement,
  type SubmissionDetail as Detail,
} from '@timecapsule/shared';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ApiRequestError, api } from '@/lib/client-api';
import { useToast } from '../ui/Toast';
import { AudioStep } from './AudioStep';
import { CheckboxField, NumberField, SelectField, Step, TextArea, TextField } from './fields';
import { LocationPicker } from './LocationPicker';
import { StatusBadge } from './StatusBadge';

type Fields = Detail['fields'];
type Key = keyof Fields;

const EDITABLE = new Set(['draft', 'processing', 'ready', 'processing_failed', 'rejected']);
const CONTRIBUTOR_RIGHTS = ['contributor_owns', 'holder_permission', 'licensed_from_archive', 'public_domain'] as const;

// Which step each "missing" key belongs to, for the progress checkmarks.
const STEP_KEYS = {
  audio: ['audio'],
  recording: ['titleEn', 'category', 'sceneDescriptionEn', 'titleLocalLang'],
  place: ['placeNameEn', 'cityEn', 'countryCode', 'location', 'locationPrecision', 'publicPlaceAttested'],
  time: ['eraYear', 'capturedFrom', 'capturedTo', 'dateConfidence', 'capturedRange', 'eraMatchesCapture'],
  rights: ['sourceType', 'syntheticDisclosure', 'license', 'rightsStatus', 'rightsHolder', 'attribution', 'speechConsent'],
} as const;
type StepId = keyof typeof STEP_KEYS;
const STEP_ORDER: StepId[] = ['audio', 'recording', 'place', 'time', 'rights'];

const stepOf = (key: string): StepId => STEP_ORDER.find((s) => (STEP_KEYS[s] as readonly string[]).includes(key)) ?? 'rights';

export function SubmissionEditor({
  initial,
  agreement,
  styleUrl,
  workerUrl,
}: {
  initial: Detail;
  agreement: Agreement | null;
  styleUrl: string;
  workerUrl: string;
}) {
  const t = useTranslations();
  const toast = useToast();
  const router = useRouter();

  const [detail, setDetail] = useState(initial);
  const [fields, setFields] = useState<Fields>(initial.fields);
  const [errors, setErrors] = useState<Partial<Record<Key, string>>>({});
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [confirm, setConfirm] = useState({ rights: false, accuracy: false, consent: false });
  const [submitting, setSubmitting] = useState(false);
  const [recorderKnown, setRecorderKnown] = useState(initial.fields.recorderName !== null);

  const fieldsRef = useRef(fields);
  useLayoutEffect(() => {
    fieldsRef.current = fields;
  }, [fields]);
  const dirty = useRef(new Set<Key>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saving = useRef<Promise<void> | null>(null);

  const locked = !EDITABLE.has(detail.status);

  const messageFor = useCallback(
    (issue: { code: string; minimum?: unknown; maximum?: unknown }) => {
      if (issue.code === 'too_small') return t('editor.errors.tooShort', { min: Number(issue.minimum ?? 1) });
      if (issue.code === 'too_big') return t('editor.errors.tooLong', { max: Number(issue.maximum ?? 0) });
      return t('editor.errors.invalid');
    },
    [t],
  );

  /** Sends the valid dirty fields. Invalid ones stay local with an inline error. */
  const flush = useCallback(async (): Promise<void> => {
    if (saving.current) await saving.current;
    if (dirty.current.size === 0) return;
    const keys = [...dirty.current];
    dirty.current.clear();

    const body: Partial<Fields> = {};
    for (const k of keys) (body as Record<string, unknown>)[k] = fieldsRef.current[k];
    const parsed = SubmissionFields.safeParse(body);
    const nextErrors: Partial<Record<Key, string>> = {};
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const k = issue.path[0] as Key;
        nextErrors[k] = messageFor(issue as never);
        delete (body as Record<string, unknown>)[k];
      }
    }
    setErrors((e) => {
      const merged = { ...e };
      for (const k of keys) delete merged[k];
      return { ...merged, ...nextErrors };
    });
    if (Object.keys(body).length === 0) return;

    setSaveState('saving');
    saving.current = (async () => {
      try {
        const next = await api(`/v1/submissions/${detail.id}`, { method: 'PATCH', body, schema: SubmissionDetail });
        setDetail(next);
        setSaveState('saved');
      } catch (err) {
        for (const k of Object.keys(body)) dirty.current.add(k as Key);
        setSaveState('error');
        if (err instanceof ApiRequestError && err.status === 409) router.refresh();
      } finally {
        saving.current = null;
      }
    })();
    await saving.current;
  }, [detail.id, messageFor, router]);

  const update = useCallback(
    (patch: Partial<Fields>) => {
      setFields((f) => ({ ...f, ...patch }));
      for (const k of Object.keys(patch)) dirty.current.add(k as Key);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), 800);
    },
    [flush],
  );

  // Save on unmount / tab close so nothing typed is lost.
  useEffect(() => {
    const onHide = () => {
      if (dirty.current.size > 0) void flush();
    };
    window.addEventListener('pagehide', onHide);
    return () => window.removeEventListener('pagehide', onHide);
  }, [flush]);

  // While the worker processes audio, check back every few seconds.
  useEffect(() => {
    if (detail.status !== 'processing') return;
    const id = setInterval(async () => {
      try {
        const next = await api(`/v1/submissions/${detail.id}`, { schema: SubmissionDetail });
        if (next.status !== 'processing') {
          setDetail(next);
          toast(next.status === 'processing_failed' ? t('editor.audio.failedToast') : t('editor.audio.readyToast'), next.status === 'processing_failed' ? 'error' : 'success');
        }
      } catch {
        /* keep polling */
      }
    }, 2500);
    return () => clearInterval(id);
  }, [detail.status, detail.id, t, toast]);

  const missing = detail.missing;
  const stepDone = (s: StepId) => !missing.some((k) => stepOf(k) === s);
  const field = (k: Key) => ({ error: errors[k], disabled: locked });
  const opts = <T extends string>(values: readonly T[], ns: string) =>
    values.map((v) => ({ value: v, label: t(`${ns}.${v}` as never) }));

  async function submit() {
    if (!agreement) return;
    setSubmitting(true);
    try {
      if (timer.current) clearTimeout(timer.current);
      await flush();
      const next = await api(`/v1/submissions/${detail.id}/submit`, {
        method: 'POST',
        body: { agreementVersion: agreement.version, confirmations: { rights: true, accuracy: true, consent: true } },
        schema: SubmissionDetail,
      });
      setDetail(next);
      toast(t('editor.submitted'));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      toast(err instanceof ApiRequestError && err.code === 'agreement_outdated' ? t('editor.agreementOutdated') : t('editor.submitFailed'), 'error');
    } finally {
      setSubmitting(false);
    }
  }

  async function withdraw() {
    try {
      setDetail(await api(`/v1/submissions/${detail.id}/withdraw`, { method: 'POST', schema: SubmissionDetail }));
      toast(t('editor.withdrawn'));
    } catch {
      toast(t('editor.actionFailed'), 'error');
    }
  }

  async function remove() {
    if (!window.confirm(t('editor.confirmDelete'))) return;
    try {
      await api(`/v1/submissions/${detail.id}`, { method: 'DELETE' });
      router.push('/contribute');
      router.refresh();
    } catch {
      toast(t('editor.actionFailed'), 'error');
    }
  }

  const canSubmit = !locked && missing.length === 0 && confirm.rights && confirm.accuracy && confirm.consent && !!agreement;

  return (
    <div className="grid gap-6 lg:grid-cols-[15rem_1fr]">
      {/* Progress rail */}
      <aside className="lg:sticky lg:top-20 lg:h-fit">
        <Link href="/contribute" className="text-sm text-muted hover:text-ink">
          ← {t('editor.back')}
        </Link>
        <div className="mt-3 flex items-center gap-2">
          <StatusBadge status={detail.status} />
          <span className="text-xs text-muted" role="status" aria-live="polite">
            {saveState === 'saving' ? t('editor.saving') : saveState === 'saved' ? t('editor.saved') : saveState === 'error' ? t('editor.saveError') : ''}
          </span>
        </div>
        <nav aria-label={t('editor.steps')} className="mt-4 hidden lg:block">
          <ol className="space-y-1">
            {[...STEP_ORDER, 'submit' as const].map((s, i) => {
              const done = s === 'submit' ? detail.status === 'pending_review' || detail.status === 'published' : stepDone(s);
              return (
                <li key={s}>
                  <a href={`#${s}`} className="flex items-center gap-3 rounded-xl px-2 py-2 text-sm hover:bg-ink/5">
                    <span
                      className={`grid size-6 place-items-center rounded-full text-xs font-semibold ${done ? 'bg-success text-white' : 'bg-line text-muted'}`}
                      aria-hidden="true"
                    >
                      {done ? '✓' : i + 1}
                    </span>
                    {t(`editor.stepNames.${s}`)}
                    {done && <span className="sr-only">({t('editor.complete')})</span>}
                  </a>
                </li>
              );
            })}
          </ol>
        </nav>
      </aside>

      <div className="min-w-0 space-y-5">
        <header>
          <h1 className="font-display text-3xl font-semibold" dir="auto">
            {fields.titleEn || t('editor.untitled')}
          </h1>
        </header>

        {detail.status === 'rejected' && detail.review?.reason && (
          <div role="alert" className="rounded-2xl border border-danger/20 bg-danger-bg p-4 text-sm text-danger">
            <p className="font-semibold">{t('editor.rejectedTitle')}</p>
            <p className="mt-1" dir="auto">{detail.review.reason}</p>
          </div>
        )}
        {detail.status === 'pending_review' && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-warn-bg p-4 text-sm text-warn-ink">
            <p>
              <span className="font-semibold">{t('editor.pendingTitle')}</span> {t('editor.pendingBody')}
            </p>
            <button type="button" className="btn btn-secondary text-sm" onClick={() => void withdraw()}>
              {t('editor.withdraw')}
            </button>
          </div>
        )}
        {detail.status === 'published' && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-success-bg p-4 text-sm text-success">
            <p className="font-semibold">{t('editor.publishedTitle')}</p>
            <Link href={`/recordings/${detail.id}`} className="btn btn-secondary text-sm">
              {t('editor.viewPublic')}
            </Link>
          </div>
        )}

        <Step id="audio" number={1} title={t('editor.stepNames.audio')} lead={t('editor.audio.lead')} done={stepDone('audio')}>
          <AudioStep detail={detail} locked={locked} onDetail={setDetail} />
        </Step>

        <Step id="recording" number={2} title={t('editor.stepNames.recording')} lead={t('editor.recordingLead')} done={stepDone('recording')}>
          <TextField label={t('editor.f.titleEn')} required maxLength={160} value={fields.titleEn} onChange={(v) => update({ titleEn: v })} {...field('titleEn')} />
          <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
            <TextField label={t('editor.f.titleLocal')} help={t('editor.h.titleLocal')} maxLength={160} lang={fields.titleLocalLang ?? undefined} value={fields.titleLocal} onChange={(v) => update({ titleLocal: v })} {...field('titleLocal')} />
            <TextField label={t('editor.f.titleLocalLang')} help={t('editor.h.titleLocalLang')} maxLength={35} placeholder="ja" value={fields.titleLocalLang} onChange={(v) => update({ titleLocalLang: v?.trim() || null })} {...field('titleLocalLang')} />
          </div>
          <SelectField label={t('editor.f.category')} required placeholder={t('editor.choose')} options={opts(SOUND_CATEGORIES, 'category')} value={fields.category} onChange={(v) => update({ category: v })} {...field('category')} />
          <TextArea label={t('editor.f.sceneDescriptionEn')} help={t('editor.h.sceneDescriptionEn')} required maxLength={2000} value={fields.sceneDescriptionEn} onChange={(v) => update({ sceneDescriptionEn: v })} {...field('sceneDescriptionEn')} />
          <TextArea label={t('editor.f.sceneDescriptionLocal')} maxLength={2000} rows={3} lang={fields.titleLocalLang ?? undefined} value={fields.sceneDescriptionLocal} onChange={(v) => update({ sceneDescriptionLocal: v })} {...field('sceneDescriptionLocal')} />
        </Step>

        <Step id="place" number={3} title={t('editor.stepNames.place')} lead={t('editor.placeLead')} done={stepDone('place')}>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label={t('editor.f.placeNameEn')} required maxLength={160} value={fields.placeNameEn} onChange={(v) => update({ placeNameEn: v })} {...field('placeNameEn')} />
            <TextField label={t('editor.f.placeNameLocal')} maxLength={160} value={fields.placeNameLocal} onChange={(v) => update({ placeNameLocal: v })} {...field('placeNameLocal')} />
            <TextField label={t('editor.f.cityEn')} required maxLength={120} value={fields.cityEn} onChange={(v) => update({ cityEn: v })} {...field('cityEn')} />
            <TextField label={t('editor.f.cityLocal')} maxLength={120} value={fields.cityLocal} onChange={(v) => update({ cityLocal: v })} {...field('cityLocal')} />
          </div>
          <div className="max-w-40">
            <TextField label={t('editor.f.countryCode')} help={t('editor.h.countryCode')} required maxLength={2} placeholder="JP" value={fields.countryCode} onChange={(v) => update({ countryCode: v?.toUpperCase() ?? null })} {...field('countryCode')} />
          </div>
          <LocationPicker
            styleUrl={styleUrl}
            workerUrl={workerUrl}
            location={fields.location}
            precision={fields.locationPrecision}
            publicPlace={fields.publicPlaceAttested}
            disabled={locked}
            onChange={(patch) =>
              update({
                ...patch,
                // Picking a point without choosing a precision uses the 1 km default.
                ...(patch.location && !fields.locationPrecision ? { locationPrecision: 'neighborhood_1km' as const } : {}),
              })
            }
          />
        </Step>

        <Step id="time" number={4} title={t('editor.stepNames.time')} lead={t('editor.timeLead')} done={stepDone('time')}>
          <div className="grid gap-4 sm:grid-cols-3">
            <NumberField label={t('editor.f.eraYear')} help={t('editor.h.eraYear')} min={1890} max={2029} value={fields.eraYear} onChange={(v) => update({ eraYear: v })} {...field('eraYear')} />
            <TextField type="date" label={t('editor.f.capturedFrom')} value={fields.capturedFrom} onChange={(v) => update({ capturedFrom: v })} {...field('capturedFrom')} />
            <TextField type="date" label={t('editor.f.capturedTo')} value={fields.capturedTo} onChange={(v) => update({ capturedTo: v })} {...field('capturedTo')} />
          </div>
          <SelectField label={t('editor.f.dateConfidence')} required placeholder={t('editor.choose')} options={opts(DATE_CONFIDENCES, 'dateConfidence')} value={fields.dateConfidence} onChange={(v) => update({ dateConfidence: v })} {...field('dateConfidence')} />
          {missing.includes('eraMatchesCapture') && <p className="rounded-xl bg-warn-bg p-3 text-sm text-warn-ink">{t('editor.missing.eraMatchesCapture')}</p>}
          {missing.includes('capturedRange') && <p className="rounded-xl bg-warn-bg p-3 text-sm text-warn-ink">{t('editor.missing.capturedRange')}</p>}
        </Step>

        <Step id="rights" number={5} title={t('editor.stepNames.rights')} lead={t('editor.rightsLead')} done={stepDone('rights')}>
          <SelectField label={t('editor.f.sourceType')} required placeholder={t('editor.choose')} options={opts(SOURCE_TYPES, 'sourceType')} value={fields.sourceType} onChange={(v) => update({ sourceType: v })} {...field('sourceType')} />
          {fields.sourceType === 'community_reconstruction' && (
            <TextArea label={t('editor.f.syntheticDisclosure')} help={t('editor.h.syntheticDisclosure')} required maxLength={2000} rows={3} value={fields.syntheticDisclosure} onChange={(v) => update({ syntheticDisclosure: v })} {...field('syntheticDisclosure')} />
          )}
          <CheckboxField label={t('editor.f.recorderUnknown')} checked={!recorderKnown} disabled={locked} onChange={(unknown) => { setRecorderKnown(!unknown); if (unknown) update({ recorderName: null }); }} />
          {recorderKnown && (
            <TextField label={t('editor.f.recorderName')} maxLength={160} value={fields.recorderName} onChange={(v) => update({ recorderName: v })} {...field('recorderName')} />
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField label={t('editor.f.license')} required placeholder={t('editor.choose')} options={opts(LICENSES, 'license')} value={fields.license} onChange={(v) => update({ license: v })} {...field('license')} />
            <SelectField label={t('editor.f.rightsStatus')} required placeholder={t('editor.choose')} options={opts(CONTRIBUTOR_RIGHTS, 'rightsStatus')} value={fields.rightsStatus} onChange={(v) => update({ rightsStatus: v })} {...field('rightsStatus')} />
            <TextField label={t('editor.f.rightsHolder')} required maxLength={200} value={fields.rightsHolder} onChange={(v) => update({ rightsHolder: v })} {...field('rightsHolder')} />
            <TextField label={t('editor.f.attribution')} help={t('editor.h.attribution')} required maxLength={300} value={fields.attribution} onChange={(v) => update({ attribution: v })} {...field('attribution')} />
          </div>
          <SelectField label={t('editor.f.speechConsent')} help={t('editor.h.speechConsent')} required placeholder={t('editor.choose')} options={opts(SPEECH_CONSENTS, 'speechConsent')} value={fields.speechConsent} onChange={(v) => update({ speechConsent: v })} {...field('speechConsent')} />
        </Step>

        <section id="submit" aria-labelledby="submit-title" className="card scroll-mt-24 p-5 sm:p-6">
          <h2 id="submit-title" className="font-display text-xl font-semibold">
            {t('editor.stepNames.submit')}
          </h2>

          {missing.length > 0 ? (
            <div className="mt-4">
              <p className="text-sm font-semibold">{t('editor.stillNeeded')}</p>
              <ul className="mt-2 flex flex-wrap gap-2">
                {missing.map((k) => (
                  <li key={k}>
                    <a href={`#${stepOf(k)}`} className="chip bg-warn-bg text-warn-ink hover:underline">
                      {t(`editor.missing.${k}` as never)}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            !locked && <p className="mt-2 text-sm text-success">{t('editor.allSet')}</p>
          )}

          {!locked && agreement && (
            <>
              <h3 className="mt-6 text-sm font-semibold">
                {t('editor.agreementTitle')} <span className="font-normal text-muted">({agreement.version})</span>
              </h3>
              {agreement.isDraft && <p className="mt-1 text-xs font-semibold text-warn-ink">{t('editor.agreementDraft')}</p>}
              {/* Plain text on purpose: the agreement is never rendered as HTML. */}
              <div className="mt-2 max-h-56 overflow-y-auto whitespace-pre-wrap rounded-xl border border-line bg-paper/60 p-4 text-sm leading-relaxed" tabIndex={0} aria-label={t('editor.agreementTitle')}>
                {agreement.bodyMd}
              </div>
              <div className="mt-4 space-y-2">
                <CheckboxField label={t('editor.confirm.rights')} checked={confirm.rights} onChange={(v) => setConfirm((c) => ({ ...c, rights: v }))} />
                <CheckboxField label={t('editor.confirm.accuracy')} checked={confirm.accuracy} onChange={(v) => setConfirm((c) => ({ ...c, accuracy: v }))} />
                <CheckboxField label={t('editor.confirm.consent')} checked={confirm.consent} onChange={(v) => setConfirm((c) => ({ ...c, consent: v }))} />
              </div>
            </>
          )}
          {!locked && !agreement && <p className="mt-4 text-sm text-danger">{t('editor.noAgreement')}</p>}

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            {EDITABLE.has(detail.status) && detail.status !== 'processing' ? (
              <button type="button" className="btn btn-ghost text-sm text-danger" onClick={() => void remove()}>
                {t('editor.delete')}
              </button>
            ) : (
              <span />
            )}
            {!locked && (
              <button type="button" className="btn btn-accent" disabled={!canSubmit || submitting} aria-busy={submitting} onClick={() => void submit()}>
                {submitting ? t('editor.submitting') : t('editor.submit')}
              </button>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
