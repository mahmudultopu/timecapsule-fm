import type { Db } from '@timecapsule/db';
import type { AuthUser, SessionStore } from '../plugins/auth.js';

export class DbSessionStore implements SessionStore {
  constructor(private readonly db: Db) {}

  async findUser(sessionToken: string): Promise<AuthUser | null> {
    const row = await this.db
      .selectFrom('sessions')
      .innerJoin('users', 'users.id', 'sessions.userId')
      .where('sessions.sessionToken', '=', sessionToken)
      .where('sessions.expires', '>', new Date())
      .where('users.disabled_at', 'is', null)
      .select(['users.id', 'users.role'])
      .executeTakeFirst();
    return row ? { id: row.id, role: row.role } : null;
  }
}
