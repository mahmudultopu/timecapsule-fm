/** Concentric rings: sound spreading out from a place, through time. */
export function LogoMark({ className = 'size-7' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <circle cx="16" cy="16" r="15" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1.5" />
      <circle cx="16" cy="16" r="10.5" fill="none" stroke="currentColor" strokeOpacity="0.5" strokeWidth="1.5" />
      <circle cx="16" cy="16" r="6" fill="none" stroke="var(--color-glow)" strokeWidth="2" />
      <circle cx="16" cy="16" r="2.25" fill="var(--color-glow)" />
    </svg>
  );
}
