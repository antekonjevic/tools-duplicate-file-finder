/** @import { Report } from './report/model.js' */

/**
 * @typedef {object} PathsResult
 * @property {number} printed
 * @property {number} undecidedGroups Groups whose paths were all printed.
 * @property {number} skippedNewline Paths left out because they contain a newline.
 * @property {boolean} interrupted The reader closed the pipe early (e.g. `| head`).
 */

/**
 * The paths `--paths-only` prints: every path of every duplicate (all of its
 * hardlinked paths too, since removing only one link frees nothing), and
 * every path in undecided groups. Keepers are never included.
 *
 * @param {Report} report
 */
export function selectPaths(report) {
  /** @type {string[]} */
  const paths = [];
  let undecidedGroups = 0;
  for (const group of report.groups) {
    if (group.undecided) undecidedGroups += 1;
    for (const file of group.files) {
      if (file.status !== 'keeper') paths.push(file.path, ...file.links);
    }
  }
  return { paths, undecidedGroups };
}

const BATCH_BYTES = 64 * 1024;

/**
 * Prints the selected paths to `stream`, one per line or NUL-terminated.
 *
 * In newline mode, a path containing a newline would read as two paths to
 * whatever consumes the list, so it is left out and counted instead; `-0`
 * prints every path safely.
 *
 * @param {NodeJS.WritableStream} stream
 * @param {Report} report
 * @param {{ nul: boolean }} options
 * @returns {Promise<PathsResult>}
 */
export async function writePaths(stream, report, { nul }) {
  const { paths, undecidedGroups } = selectPaths(report);
  const terminator = nul ? '\0' : '\n';
  const result = { printed: 0, undecidedGroups, skippedNewline: 0, interrupted: false };

  /** @type {Error | null} */
  let failure = null;
  // Stays attached: an EPIPE can arrive after the last write returns.
  stream.on('error', (error) => {
    failure ??= error;
  });

  const flush = async (/** @type {string} */ chunk) => {
    if (failure) return;
    const accepted = stream.write(chunk);
    if (!accepted) {
      await new Promise((resolve) => {
        const done = () => {
          stream.off('drain', done);
          stream.off('error', done);
          resolve(undefined);
        };
        stream.on('drain', done);
        stream.on('error', done);
      });
    }
  };

  let batch = '';
  for (const p of paths) {
    if (!nul && p.includes('\n')) {
      result.skippedNewline += 1;
      continue;
    }
    batch += p + terminator;
    result.printed += 1;
    if (batch.length >= BATCH_BYTES) {
      await flush(batch);
      batch = '';
    }
  }
  if (batch) await flush(batch);
  // Wait until everything written so far has been handed to the OS.
  if (!failure) await new Promise((resolve) => stream.write('', () => resolve(undefined)));

  const error = /** @type {(Error & { code?: string }) | null} */ (failure);
  if (error) {
    if (error.code !== 'EPIPE') throw error;
    result.interrupted = true;
  }
  return result;
}
