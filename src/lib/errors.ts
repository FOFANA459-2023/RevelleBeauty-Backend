export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (m: string, d?: unknown) => new AppError(400, 'bad_request', m, d);
export const unauthorized = (m = 'Unauthorized') => new AppError(401, 'unauthorized', m);
export const forbidden = (m = 'Forbidden') => new AppError(403, 'forbidden', m);
export const notFound = (m = 'Not found') => new AppError(404, 'not_found', m);
export const conflict = (m: string, d?: unknown) => new AppError(409, 'conflict', m, d);
export const unavailable = (m: string) => new AppError(503, 'unavailable', m);
