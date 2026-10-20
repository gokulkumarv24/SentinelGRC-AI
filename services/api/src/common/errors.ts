/**
 * Application error with a stable, documented error code (spec §13.2).
 * Messages are safe to show to users; never put secrets, SQL or paths in them.
 */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

/** 404 is used for both "missing" and "other tenant's record" so existence never leaks (spec §14.5). */
export const notFound = (entity: string) => new AppError(404, 'not_found', `${entity} not found`);

export const conflict = (message: string, details?: Record<string, unknown>) =>
  new AppError(409, 'conflict', message, details);

export const versionConflict = () =>
  new AppError(409, 'version_conflict', 'This record was changed by someone else. Reload and try again.');

export const badRequest = (code: string, message: string, details?: Record<string, unknown>) =>
  new AppError(400, code, message, details);

export const forbidden = (message = 'You do not have permission to perform this action', code = 'forbidden') =>
  new AppError(403, code, message);

export const invalidTransition = (from: string, to: string) =>
  new AppError(409, 'invalid_transition', `Cannot move from "${from}" to "${to}"`, { from, to });

export const separationOfDuties = (message = 'You cannot approve your own request') =>
  new AppError(403, 'separation_of_duties', message);
