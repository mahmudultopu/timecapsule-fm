import { createHmac } from 'node:crypto';
import type { Db } from '@timecapsule/db';

export interface AuditEvent {
  action: string;
  actorId?: string | null;
  targetType?: string;
  targetId?: string;
  /** Must not contain personal data, audio, or signed URLs. */
  details?: Record<string, string | number | boolean | null>;
  ip?: string;
}

export interface AuditLog {
  record(event: AuditEvent): Promise<void>;
}

/** Security events (failed logins, upload rejections, moderation, takedowns). */
export class DbAuditLog implements AuditLog {
  constructor(
    private readonly db: Db,
    private readonly ipKey: string,
  ) {}

  async record(e: AuditEvent): Promise<void> {
    // IPs are kept only as a keyed HMAC: linkable within a key period, not reversible.
    const ipHmac = e.ip ? createHmac('sha256', this.ipKey).update(e.ip).digest('hex') : null;
    await this.db
      .insertInto('audit_log')
      .values({
        action: e.action,
        actor_id: e.actorId ?? null,
        target_type: e.targetType ?? null,
        target_id: e.targetId ?? null,
        details: JSON.stringify(e.details ?? {}),
        ip_hmac: ipHmac,
      })
      .execute();
  }
}
