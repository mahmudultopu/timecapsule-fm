export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly headers: Record<string, string> = {},
  ) {
    super(message);
  }
}

// Unpublished and non-existent recordings both return 404, so the API never
// confirms that an unpublished ID exists.
export const notFound = () => new HttpError(404, 'not_found', 'Not found');
export const unauthorized = () => new HttpError(401, 'unauthorized', 'Sign in required');
export const forbidden = () => new HttpError(403, 'forbidden', 'Not allowed');
