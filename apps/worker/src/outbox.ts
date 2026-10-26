import type { Db } from '@timecapsule/db';
import { sql } from 'kysely';
import type { Logger } from 'pino';

export interface Mailer {
  send(message: { to: string; subject: string; text: string }): Promise<void>;
}

const SUBJECTS: Record<string, string> = {
  submission_published: 'Your recording is live on TimeCapsule.fm',
  submission_rejected: 'Your TimeCapsule.fm submission needs changes',
  recording_unpublished: 'Your TimeCapsule.fm recording was unpublished',
  processing_failed: 'We could not process your TimeCapsule.fm upload',
};

const MAX_ATTEMPTS = 5;

/**
 * Sends pending notification emails. In-app notifications are the source of
 * truth; email is a best-effort copy with a few retries. Plain text only,
 * no tracking pixels or tracked links.
 */
export async function flushOutbox(db: Db, mailer: Mailer, appOrigin: string, log: Logger): Promise<number> {
  const pending = await db
    .selectFrom('notifications')
    .where('emailed_at', 'is', null)
    .where('email_attempts', '<', MAX_ATTEMPTS)
    .select(['id', 'kind', 'message'])
    .orderBy('created_at')
    .limit(20)
    .execute();

  let sent = 0;
  for (const n of pending) {
    // SECURITY DEFINER lookup: the worker can't read users directly, and this
    // returns nothing when the user has turned email off.
    const recipient = (
      await sql<{ email: string; display_name: string | null }>`SELECT * FROM app.notification_recipient(${n.id})`.execute(db)
    ).rows[0];

    if (!recipient) {
      await db.updateTable('notifications').set({ emailed_at: new Date() }).where('id', '=', n.id).execute();
      continue;
    }
    try {
      await mailer.send({
        to: recipient.email,
        subject: SUBJECTS[n.kind] ?? 'TimeCapsule.fm',
        text: [
          `Hello${recipient.display_name ? ` ${recipient.display_name}` : ''},`,
          '',
          n.message,
          '',
          `See your submissions: ${appOrigin}/contribute`,
          `Turn these emails off: ${appOrigin}/account`,
        ].join('\n'),
      });
      await db.updateTable('notifications').set({ emailed_at: new Date() }).where('id', '=', n.id).execute();
      sent++;
    } catch (err) {
      await db
        .updateTable('notifications')
        .set((eb) => ({ email_attempts: eb('email_attempts', '+', 1) }))
        .where('id', '=', n.id)
        .execute();
      // Never log the address.
      log.warn({ err, notificationId: n.id }, 'notification email failed');
    }
  }
  return sent;
}
