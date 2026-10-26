'use client';

import type { z } from 'zod';

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

let csrfToken: Promise<string> | null = null;

/** Fetches (once per page load) the CSRF token the API pairs with its cookie. */
function csrf(): Promise<string> {
  csrfToken ??= fetch('/api/v1/csrf', { credentials: 'same-origin' })
    .then((r) => r.json() as Promise<{ token: string }>)
    .then((j) => j.token)
    .catch((err) => {
      csrfToken = null;
      throw err;
    });
  return csrfToken;
}

/**
 * Browser call to the API. State-changing requests carry the CSRF header;
 * responses are validated when a schema is given.
 */
export async function api<S extends z.ZodType>(
  path: string,
  opts: { method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'; body?: unknown; schema?: S } = {},
): Promise<S extends z.ZodType ? z.infer<S> : unknown> {
  const method = opts.method ?? 'GET';
  const headers: Record<string, string> = { accept: 'application/json' };
  if (method !== 'GET') headers['x-csrf-token'] = await csrf();
  if (opts.body !== undefined) headers['content-type'] = 'application/json';

  let res = await fetch(`/api${path}`, {
    method,
    headers,
    credentials: 'same-origin',
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  // The CSRF cookie may have been rotated (e.g. another tab); refresh once.
  if (res.status === 403 && method !== 'GET') {
    const code = ((await res.clone().json().catch(() => ({}))) as { error?: { code?: string } }).error?.code;
    if (code === 'csrf_token') {
      csrfToken = null;
      headers['x-csrf-token'] = await csrf();
      res = await fetch(`/api${path}`, { method, headers, credentials: 'same-origin', body: JSON.stringify(opts.body) });
    }
  }

  if (res.status === 204) return undefined as never;
  const json = (await res.json().catch(() => null)) as { error?: { code: string; message: string } } | null;
  if (!res.ok) {
    throw new ApiRequestError(res.status, json?.error?.code ?? 'error', json?.error?.message ?? 'Request failed');
  }
  return (opts.schema ? opts.schema.parse(json) : json) as never;
}

/**
 * PUTs a file to a signed URL with upload progress (fetch can't report it).
 * Resolves when storage has accepted every byte.
 */
export function putWithProgress(
  url: string,
  file: Blob,
  headers: Record<string, string>,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status})`)));
    xhr.onerror = () => reject(new Error('Upload failed'));
    xhr.onabort = () => reject(new DOMException('Upload cancelled', 'AbortError'));
    signal?.addEventListener('abort', () => xhr.abort());
    xhr.send(file);
  });
}
