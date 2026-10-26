'use client';

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { CheckIcon, CloseIcon } from './Icons';

type Tone = 'success' | 'error' | 'info';
interface ToastItem {
  id: number;
  message: string;
  tone: Tone;
}

const ToastContext = createContext<(message: string, tone?: Tone) => void>(() => {});

/** Shows a short, dismissible message. Announced politely to screen readers. */
export function useToast() {
  return useContext(ToastContext);
}

let nextId = 1;

export function ToastProvider({ children, dismissLabel }: { children: ReactNode; dismissLabel: string }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);
  const push = useCallback(
    (message: string, tone: Tone = 'success') => {
      const id = nextId++;
      setItems((xs) => [...xs.slice(-2), { id, message, tone }]);
      setTimeout(() => dismiss(id), tone === 'error' ? 8000 : 4000);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-28 z-50 flex flex-col items-center gap-2 px-4"
      >
        {items.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto flex max-w-md items-center gap-3 rounded-full py-2 ps-4 pe-2 text-sm shadow-[var(--shadow-lift)] motion-safe:animate-fade-up ${
              t.tone === 'error' ? 'bg-danger text-white' : 'bg-night text-paper'
            }`}
          >
            {t.tone === 'success' && <CheckIcon className="size-4 text-glow" />}
            <span>{t.message}</span>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              className="grid size-7 place-items-center rounded-full hover:bg-white/15"
              aria-label={dismissLabel}
            >
              <CloseIcon className="size-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
