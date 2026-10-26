import { HttpError } from '../errors.js';

interface PgError {
  code?: string;
  constraint?: string;
  message?: string;
}

/**
 * Turns the database's last-line-of-defence errors into client errors.
 * The API validates first, so reaching these usually means a race (status
 * changed underneath the request) or a rule only the database knows.
 */
export function mapDbError(err: unknown): never {
  const e = err as PgError;
  switch (e.code) {
    case '23514': // check_violation
      throw new HttpError(422, 'rule_violation', `This change breaks a rule: ${e.constraint ?? 'constraint'}`);
    case '42501': // insufficient_privilege (RLS, triggers)
      throw new HttpError(409, 'not_allowed_in_state', 'This action is not allowed right now');
    case '23503': // foreign_key_violation
      throw new HttpError(422, 'invalid_reference', 'A referenced item does not exist');
    default:
      throw err;
  }
}

export async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    return mapDbError(err);
  }
}
