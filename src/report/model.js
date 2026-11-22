import { PERMISSION_CODES } from '../errors.js';
import { isoFromNs } from '../format.js';

/**
 * @import { ScanResult } from '../scan.js'
 * @import { PhysicalFile } from '../group.js'
 */

/**
 * Increases only on breaking changes to the report format, so other tools can
 * rely on it.
 */
export const SCHEMA_VERSION = 1;

/**
 * @typedef {'keeper' | 'duplicate' | 'undecided'} FileStatus
 *
 * @typedef {object} ReportFile
 * @property {FileStatus} status
 * @property {string} path
 * @property {string[]} links Other hardlinked paths to the same file.
 * @property {string | null} birthtime
 * @property {string} mtime
 * @property {number | string} device
 * @property {number | string} inode
 *
 * @typedef {object} ReportGroup
 * @property {number} id
 * @property {string} hash `sha256:<hex>`
 * @property {number} size
 * @property {number} copies
 * @property {number} wastedBytes
 * @property {boolean} undecided
 * @property {'birthtime' | 'mtime'} keeperBasis
 * @property {ReportFile[]} files
 *
 * @typedef {object} Report The JSON report. CSV and text are views of it.
 * @property {number} schema
 * @property {{ name: string, version: string }} tool
 * @property {{ roots: string[], system: boolean, options: object, platform: string, startedAt: string, finishedAt: string }} scan
 * @property {Record<string, any>} summary
 * @property {{ skipped: string[], found: string[] }} mounts
 * @property {ReportGroup[]} groups
 * @property {{ device: number | string, inode: number | string, size: number, paths: string[] }[]} hardlinks
 * @property {{ path: string, code: string, message: string }[]} errors
 */

/**
 * Device and inode numbers are 64-bit. JSON numbers lose precision above
 * 2^53, so larger values are written as strings. On macOS and Linux in
 * practice they are always numbers.
 *
 * @param {bigint} value
 */
function jsonInteger(value) {
  return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value.toString();
}

/** @param {string} a @param {string} b */
const byString = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** @param {bigint | null} a @param {bigint | null} b Nulls sort last. */
function byTime(a, b) {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? -1 : 1;
}

/**
 * @param {PhysicalFile} file
 * @param {FileStatus} status
 * @returns {ReportFile}
 */
function reportFile(file, status) {
  return {
    status,
    path: file.paths[0],
    links: file.paths.slice(1),
    birthtime: isoFromNs(file.birthtimeNs),
    mtime: /** @type {string} */ (isoFromNs(file.mtimeNs)),
    device: jsonInteger(file.device),
    inode: jsonInteger(file.inode),
  };
}

/**
 * Shapes a scan result into the report every output is built from.
 *
 * - Groups are sorted by wasted space (largest first), then size, then hash.
 * - Within a group: keeper first, then created date, modified date and path.
 *
 * @param {ScanResult} result
 * @param {{ name: string, version: string }} tool
 * @returns {Report}
 */
export function buildReport(result, tool) {
  const groups = result.groups
    .map((group) => {
      const undecided = group.keeper === null;
      const files = [...group.files].sort((a, b) => {
        if (a === group.keeper) return -1;
        if (b === group.keeper) return 1;
        return byTime(a.birthtimeNs, b.birthtimeNs) || byTime(a.mtimeNs, b.mtimeNs) || byString(a.paths[0], b.paths[0]);
      });
      return {
        hash: `sha256:${group.hash}`,
        size: group.size,
        copies: files.length,
        wastedBytes: group.size * (files.length - 1),
        undecided,
        keeperBasis: group.basis,
        files: files.map((file) =>
          reportFile(file, undecided ? 'undecided' : file === group.keeper ? 'keeper' : 'duplicate'),
        ),
      };
    })
    .sort((a, b) => b.wastedBytes - a.wastedBytes || b.size - a.size || byString(a.hash, b.hash))
    .map((group, i) => ({ id: i + 1, ...group }));

  const hardlinks = [...result.hardlinks]
    .sort((a, b) => byString(a.paths[0], b.paths[0]))
    .map((file) => ({
      device: jsonInteger(file.device),
      inode: jsonInteger(file.inode),
      size: file.size,
      paths: file.paths,
    }));

  const { options } = result;

  return {
    schema: SCHEMA_VERSION,
    tool,
    scan: {
      roots: result.roots,
      system: options.system,
      options: {
        minSize: options.minSize,
        ext: options.ext,
        excludes: options.excludes,
        hiddenFiles: options.hiddenFiles,
        hiddenDirs: options.hiddenDirs,
        defaultExcludes: options.defaultExcludes,
        includeDataless: options.includeDataless,
        crossMounts: options.crossMounts,
      },
      platform: result.platform,
      startedAt: result.startedAt.toISOString(),
      finishedAt: result.finishedAt.toISOString(),
    },
    summary: {
      filesScanned: result.filesScanned,
      bytesScanned: result.bytesScanned,
      candidates: result.candidates,
      groups: groups.length,
      undecidedGroups: groups.filter((g) => g.undecided).length,
      duplicateFiles: groups.reduce((sum, g) => sum + g.copies - 1, 0),
      wastedBytes: groups.reduce((sum, g) => sum + g.wastedBytes, 0),
      hardlinkSets: hardlinks.length,
      birthtimeUnavailable: result.groups.reduce(
        (sum, g) => sum + g.files.filter((f) => f.birthtimeNs === null).length,
        0,
      ),
      errors: result.errors.length,
      permissionErrors: result.errors.filter((e) => PERMISSION_CODES.has(e.code)).length,
      skipped: result.skipped,
    },
    mounts: result.mounts,
    groups,
    hardlinks,
    errors: result.errors,
  };
}
