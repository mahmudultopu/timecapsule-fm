import 'server-only';
import { cookies } from 'next/headers';
import type { z } from 'zod';

/**
 * Server-side call to the API as the current user: forwards the session
 * cookie so the API (and its row-level security) sees the same person.
 * Responses are validated against the shared schema.
 */
export async function apiAsViewer<S extends z.ZodType>(schema: S, path: string): Promise<z.infer<S> | null> {
  // Demo mode has no accounts or private data.
  if (process.env.DEMO_MODE === 'true') return null;
  const base = process.env.API_INTERNAL_URL;
  if (!base) throw new Error('API_INTERNAL_URL is not set');
  const res = await fetch(`${base.replace(/\/$/, '')}${path}`, {
    headers: { accept: 'application/json', cookie: (await cookies()).toString() },
    cache: 'no-store',
  });
  if (res.status === 404 || res.status === 401 || res.status === 403) return null;
  if (!res.ok) throw new Error(`API ${path} failed (${res.status})`);
  return schema.parse(await res.json());
}
