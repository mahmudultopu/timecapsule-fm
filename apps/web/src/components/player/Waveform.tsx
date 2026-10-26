'use client';

import { useEffect, useRef } from 'react';
import { useReducedMotion } from '@/lib/use-reduced-motion';

interface Props {
  peaks: number[] | null;
  duration: number;
  /** Used when no live audio element is available, and under reduced motion. */
  currentTime: number;
  audio: HTMLAudioElement | null;
  playing: boolean;
}

// Tuned for the dark player bar: warm glow for what you've heard.
const PLAYED = '#e8946a';
const UNPLAYED = 'rgba(183, 191, 211, 0.38)';

/**
 * Canvas waveform drawn from precomputed peaks, so it renders before the
 * audio has downloaded. Decorative (aria-hidden): the seek slider is the
 * accessible control. With reduced motion it redraws only on timeupdate
 * (~4 Hz) instead of every animation frame.
 */
export function Waveform({ peaks, duration, currentTime, audio, playing }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const draw = (time: number) => {
      const dpr = window.devicePixelRatio || 1;
      const { width, height } = canvas.getBoundingClientRect();
      if (canvas.width !== Math.round(width * dpr)) canvas.width = Math.round(width * dpr);
      if (canvas.height !== Math.round(height * dpr)) canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const bars = Math.max(1, Math.floor(width / 3));
      const progress = duration > 0 ? time / duration : 0;
      // RTL documents read the waveform right-to-left, like the slider.
      const rtl = getComputedStyle(canvas).direction === 'rtl';
      for (let i = 0; i < bars; i++) {
        const peak = peaks?.length ? peaks[Math.floor((i / bars) * peaks.length)]! : 0.04;
        const h = Math.max(2, peak * height);
        const x = rtl ? width - (i + 1) * 3 : i * 3;
        ctx.fillStyle = i / bars < progress ? PLAYED : UNPLAYED;
        // Bars are centred vertically with rounded caps where supported.
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(x, (height - h) / 2, 2, h, 1);
        else ctx.rect(x, (height - h) / 2, 2, h);
        ctx.fill();
      }
    };

    if (!audio || !playing || reducedMotion) {
      draw(audio?.currentTime ?? currentTime);
      return;
    }
    let raf = 0;
    const loop = () => {
      draw(audio.currentTime);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [peaks, duration, currentTime, audio, playing, reducedMotion]);

  return <canvas ref={canvasRef} aria-hidden="true" className="block h-10 w-full" />;
}
