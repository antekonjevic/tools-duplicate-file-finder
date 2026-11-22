import fsp from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { UsageError, describeError } from './errors.js';
import { neverScannedReason } from './filters.js';
import { formatFileTimestamp, parseSize } from './format.js';

/** @import { Platform } from './platform.js' */

/**
 * Options that shape a scan, after validation.
 *
 * @typedef {object} ScanOptions
 * @property {string[]} roots Folder arguments as typed; resolved by `resolveRoots`.
 * @property {boolean} system
 * @property {number | null} minSize Bytes.
 * @property {string[] | null} ext Lowercase extensions without dots.
 * @property {string[]} excludes Globs matched against absolute paths.
 * @property {boolean} hiddenFiles
 * @property {boolean} hiddenDirs
 * @property {boolean} defaultExcludes
 * @property {boolean} includeDataless
 * @property {boolean} crossMounts
 * @property {string | null} report The `--report` value as typed.
 * @property {boolean} pathsOnly
 * @property {boolean} nullSeparated
 */

/**
 * @typedef {{ command: 'help' } | { command: 'version' } | { command: 'scan', options: ScanOptions }} Command
 */

/** @type {ReadonlyMap<string, 'json' | 'csv' | 'text'>} */
export const REPORT_FORMATS = new Map([
  ['.json', 'json'],
  ['.csv', 'csv'],
  ['.txt', 'text'],
]);

export const HELP = `Usage: dff [options] <dir> [<dir> ...]
       dff [options] --system

Find files with identical content and write a report about them.
dff is read-only: it never changes, moves or deletes the files it scans.

Filters
  --min-size <size>      skip files smaller than <size>: 500, 1k, 10M (k = 1024)
  --ext <list>           only these extensions: jpg,png (repeatable)
  --exclude <glob>       skip paths matching <glob>, matched against the
                         absolute path: '**/Downloads/**' (repeatable)

Scope
  --hidden-files         include hidden files
  --hidden-dirs          include hidden folders
  --no-default-excludes  include node_modules, .git, caches and similar
  --include-dataless     include cloud placeholder files (this downloads them)
  --cross-mounts         follow into other drives found inside a folder
  --system               scan the user-data locations of this system

Output
  --report <file>        where to write the report, replacing any file already
                         there; the format comes from the extension: .json,
                         .csv or .txt (default: ./dff-report-<timestamp>.json)
  --paths-only           also print duplicate paths to standard output;
                         keepers are never printed
  -0, --null             with --paths-only, end each path with NUL instead
                         of a newline

  -h, --help             show this help
  -v, --version          show the version

Exit codes: 0 scan completed, 1 fatal error, 2 usage error.
`;

const OPTIONS = /** @type {const} */ ({
  'min-size': { type: 'string' },
  ext: { type: 'string', multiple: true },
  exclude: { type: 'string', multiple: true },
  'hidden-files': { type: 'boolean' },
  'hidden-dirs': { type: 'boolean' },
  'no-default-excludes': { type: 'boolean' },
  'include-dataless': { type: 'boolean' },
  'cross-mounts': { type: 'boolean' },
  system: { type: 'boolean' },
  report: { type: 'string' },
  'paths-only': { type: 'boolean' },
  null: { type: 'boolean', short: '0' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
});

/**
 * Parses and validates the command line. Touches nothing on disk; folders and
 * the report path are checked later by `resolveRoots` and `resolveReportPath`.
 *
 * @param {string[]} argv Arguments after the program name.
 * @returns {Command}
 */
export function parseCli(argv) {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true });
  } catch (error) {
    // Node's messages carry a long hint after the first sentence; keep the
    // part that names the problem.
    throw new UsageError(describeError(error).message.split('. ')[0]);
  }
  const { values, positionals } = parsed;

  if (values.help) return { command: 'help' };
  if (values.version) return { command: 'version' };

  if (positionals.length === 0 && !values.system) {
    throw new UsageError('no folders given; name at least one folder or use --system');
  }
  if (values.null && !values['paths-only']) {
    throw new UsageError('-0/--null only works together with --paths-only');
  }

  return {
    command: 'scan',
    options: {
      roots: positionals,
      system: values.system ?? false,
      minSize: values['min-size'] === undefined ? null : parseMinSize(values['min-size']),
      ext: values.ext === undefined ? null : parseExtensions(values.ext),
      excludes: (values.exclude ?? []).map(validateExclude),
      hiddenFiles: values['hidden-files'] ?? false,
      hiddenDirs: values['hidden-dirs'] ?? false,
      defaultExcludes: !(values['no-default-excludes'] ?? false),
      includeDataless: values['include-dataless'] ?? false,
      crossMounts: values['cross-mounts'] ?? false,
      report: values.report === undefined ? null : validateReportName(values.report),
      pathsOnly: values['paths-only'] ?? false,
      nullSeparated: values.null ?? false,
    },
  };
}

/** @param {string} text */
function parseMinSize(text) {
  const bytes = parseSize(text);
  if (bytes === null) {
    throw new UsageError(`invalid --min-size "${text}"; use bytes or a k, M, G or T suffix, e.g. 500, 1k, 10M`);
  }
  return bytes;
}

/** @param {string[]} lists */
function parseExtensions(lists) {
  const extensions = new Set();
  for (const list of lists) {
    for (const raw of list.split(',')) {
      const ext = raw.trim().replace(/^\./, '').toLowerCase();
      if (ext === '') throw new UsageError(`invalid --ext "${list}"; it contains an empty extension`);
      extensions.add(ext);
    }
  }
  return [...extensions];
}

/** @param {string} glob */
function validateExclude(glob) {
  // Patterns are matched against absolute paths, so one that starts with
  // anything other than "/" or "**" can never match. Saying so beats a scan
  // that silently excludes nothing.
  if (!glob.startsWith('/') && !glob.startsWith('**')) {
    throw new UsageError(
      `--exclude "${glob}" can never match: patterns are matched against absolute paths; ` +
        `use "**/${glob}" to match anywhere`,
    );
  }
  try {
    path.matchesGlob('/', glob);
  } catch (error) {
    throw new UsageError(`invalid --exclude "${glob}": ${describeError(error).message}`);
  }
  return glob;
}

/** @param {string} name */
function validateReportName(name) {
  const ext = path.extname(name).toLowerCase();
  if (!REPORT_FORMATS.has(ext)) {
    throw new UsageError(`unsupported report format "${ext || name}"; use a .json, .csv or .txt file name`);
  }
  return name;
}

/**
 * Turns folder arguments (and `--system`) into the absolute, real folders to
 * scan. Fails fast on anything that can't be scanned, so a long scan never
 * starts with a typo in it.
 *
 * @param {Pick<ScanOptions, 'roots' | 'system'>} options
 * @param {Platform} platform
 * @param {string} cwd
 * @returns {Promise<string[]>}
 */
export async function resolveRoots({ roots, system }, platform, cwd) {
  /** @type {string[]} */
  const resolved = [];
  const add = (/** @type {string} */ root) => {
    if (!resolved.includes(root)) resolved.push(root);
  };

  for (const raw of roots) {
    add(await resolveFolder(raw, platform, cwd));
  }

  if (system) {
    for (const location of platform.systemRoots) {
      try {
        const real = await fsp.realpath(location);
        if ((await fsp.stat(real)).isDirectory()) add(real);
      } catch {
        // Locations that don't exist on this machine are ignored.
      }
    }
    if (resolved.length === 0) {
      throw new UsageError('nothing to scan: none of the --system locations exist on this machine');
    }
  }
  return resolved;
}

/**
 * @param {string} raw
 * @param {Platform} platform
 * @param {string} cwd
 */
async function resolveFolder(raw, platform, cwd) {
  let real;
  try {
    real = await fsp.realpath(path.resolve(cwd, raw));
  } catch (error) {
    const { code, message } = describeError(error);
    if (code === 'ENOENT' || code === 'ENOTDIR') throw new UsageError(`no such folder: ${raw}`);
    throw new UsageError(`cannot access ${raw}: ${message}`);
  }
  if (!(await fsp.stat(real)).isDirectory()) throw new UsageError(`not a folder: ${raw}`);

  const reason = neverScannedReason(real, platform);
  if (reason) throw new UsageError(`${raw}: dff never scans this location (${reason})`);

  // Opening the folder is the only reliable test: on macOS, privacy
  // protection can block a folder that file permissions say is readable.
  try {
    const dir = await fsp.opendir(real);
    await dir.close();
  } catch (error) {
    throw new UsageError(`cannot read folder ${raw}: ${describeError(error).message}`);
  }
  return real;
}

/**
 * Works out where the report goes, and checks that it can be written there
 * before the scan starts rather than after it finishes.
 *
 * @param {string | null} report The `--report` value, or null for the default.
 * @param {string} cwd
 * @param {Date} startedAt Used in the default file name.
 * @returns {Promise<{ path: string, format: 'json' | 'csv' | 'text' }>}
 */
export async function resolveReportPath(report, cwd, startedAt) {
  const target = report
    ? path.resolve(cwd, report)
    : path.join(cwd, `dff-report-${formatFileTimestamp(startedAt)}.json`);
  const folder = path.dirname(target);

  try {
    if (!(await fsp.stat(folder)).isDirectory()) throw new Error();
  } catch {
    throw new UsageError(`cannot write the report: folder does not exist: ${folder}`);
  }
  try {
    await fsp.access(folder, fsConstants.W_OK);
  } catch {
    throw new UsageError(`cannot write the report: folder is not writable: ${folder}`);
  }
  try {
    if ((await fsp.stat(target)).isDirectory()) {
      throw new UsageError(`cannot write the report: ${target} is a folder`);
    }
  } catch (error) {
    if (error instanceof UsageError) throw error;
    // Doesn't exist yet: that's the normal case.
  }

  const format = REPORT_FORMATS.get(path.extname(target).toLowerCase());
  if (!format) throw new UsageError(`unsupported report format for ${target}`);
  return { path: target, format };
}
