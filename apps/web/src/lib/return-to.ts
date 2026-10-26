/**
 * Only same-site relative paths are accepted as post-login destinations,
 * so a crafted ?returnTo= can't bounce users to another site.
 */
export function safeReturnTo(value: string | string[] | undefined, fallback = '/'): string {
  const v = Array.isArray(value) ? value[0] : value;
  return v && v.startsWith('/') && !v.startsWith('//') && !v.startsWith('/\\') ? v : fallback;
}
