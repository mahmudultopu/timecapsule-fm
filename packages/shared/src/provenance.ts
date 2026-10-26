import type { SourceType } from './enums.js';
import { Provenance } from './schemas.js';

/**
 * The UI must never show a recording without complete provenance.
 * Returns the validated provenance, or null if anything is missing/invalid.
 */
export function completeProvenance(value: unknown): Provenance | null {
  const parsed = Provenance.safeParse(value);
  if (!parsed.success) return null;
  const p = parsed.data;
  if (p.sourceType === 'community_reconstruction' && !p.syntheticDisclosure?.trim()) return null;
  if (p.capturedFrom > p.capturedTo) return null;
  return p;
}

/** Anything not captured in the era it depicts must be labelled as synthetic. */
export function isSynthetic(sourceType: SourceType): boolean {
  return sourceType === 'community_reconstruction';
}
