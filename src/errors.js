/**
 * A problem with how dff was invoked: a bad option, a bad value, or a folder
 * that can't be scanned. Reported without a stack trace and exits with code 2.
 */
export class UsageError extends Error {
  name = 'UsageError';
}

/**
 * A file that changed between the walk and hashing: it was replaced, grew or
 * shrank. Its hash would describe neither the old nor the new content, so the
 * file is left out of the results and recorded as an error.
 */
export class FileChangedError extends Error {
  name = 'FileChangedError';
  code = 'ECHANGED';

  constructor() {
    super('file changed during scan');
  }
}

/**
 * Turns any thrown value into the `{ code, message }` pair used in reports.
 * Node's file system messages look like
 * "EACCES: permission denied, scandir '/x'"; the code and path are already
 * recorded separately, so only "permission denied" is kept.
 *
 * @param {unknown} error
 * @returns {{ code: string, message: string }}
 */
export function describeError(error) {
  const err = /** @type {{ code?: unknown, message?: unknown }} */ (error ?? {});
  const code = typeof err.code === 'string' ? err.code : 'EUNKNOWN';
  let message = typeof err.message === 'string' ? err.message : String(error);
  const match = /^[A-Z0-9_]+: (.*?), \w+(?: '.*')?$/s.exec(message);
  if (match) message = match[1];
  return { code, message };
}

/** Error codes that mean "not allowed", as opposed to "broken". */
export const PERMISSION_CODES = new Set(['EACCES', 'EPERM']);
