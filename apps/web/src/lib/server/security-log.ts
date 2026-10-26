import 'server-only';
import { createHmac } from 'node:crypto';
import { authPool } from './db';

interface SecurityEvent {
  action: string;
  actorId?: string | null;
  details?: Record<string, string | number | boolean>;
  ip?: string;
}

/**
 * Writes a security event to stdout (structured) and to the audit log.
 * Same rules as the API: no email addresses, tokens or raw IPs.
 */
export async function securityEvent(e: SecurityEvent): Promise<void> {
  const key = process.env.AUDIT_IP_HMAC_KEY;
  const ipHmac = e.ip && key ? createHmac('sha256', key).update(e.ip).digest('hex') : null;
  console.info(JSON.stringify({ level: 'info', event: 'security', action: e.action, actorId: e.actorId ?? null, ...e.details }));
  try {
    await authPool().query(
      'INSERT INTO audit_log (actor_id, action, details, ip_hmac) VALUES ($1, $2, $3, $4)',
      [e.actorId ?? null, e.action, JSON.stringify(e.details ?? {}), ipHmac],
    );
  } catch (err) {
    console.error(JSON.stringify({ level: 'error', event: 'audit_write_failed', message: (err as Error).message }));
  }
}
