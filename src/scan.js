import { describeError } from './errors.js';
import { createFilters } from './filters.js';
import { FileIndex, findDuplicates } from './group.js';
import { chooseKeeper } from './keeper.js';
import { findExternalDrives } from './mounts.js';
import { walk } from './walk.js';

/**
 * @import { ScanOptions } from './cli.js'
 * @import { DuplicateGroup, PhysicalFile } from './group.js'
 * @import { KeeperDecision } from './keeper.js'
 * @import { Platform } from './platform.js'
 * @import { SkipCounter } from './walk.js'
 */

/** How many files are hashed at once. Enough to keep an SSD busy without thrashing a spinning disk. */
export const HASH_CONCURRENCY = 4;

/** @typedef {Record<SkipCounter, number>} SkipCounts */

/** @returns {SkipCounts} */
export function emptySkipCounts() {
  return {
    dataless: 0,
    hiddenFiles: 0,
    hiddenDirs: 0,
    defaultExcludes: 0,
    neverScanned: 0,
    userExcludes: 0,
    mountPoints: 0,
    symlinks: 0,
    special: 0,
    belowMinSize: 0,
    extFiltered: 0,
    empty: 0,
  };
}

/**
 * Everything a scan found, before it's shaped into a report.
 *
 * @typedef {object} ScanResult
 * @property {string[]} roots
 * @property {ScanOptions} options
 * @property {Platform['name']} platform
 * @property {Date} startedAt
 * @property {Date} finishedAt
 * @property {number} filesScanned Paths that passed every filter.
 * @property {number} bytesScanned Total size of those paths.
 * @property {number} candidates Physical files that share their size with another.
 * @property {SkipCounts} skipped
 * @property {{ skipped: string[], found: string[] }} mounts
 * @property {(DuplicateGroup & KeeperDecision)[]} groups
 * @property {PhysicalFile[]} hardlinks
 * @property {{ path: string, code: string, message: string }[]} errors
 */

/**
 * Runs a complete scan: walk, group by size and hardlink, hash, pick keepers.
 * Reads files and never changes them.
 *
 * @param {object} params
 * @param {string[]} params.roots Resolved folders from `resolveRoots`.
 * @param {ScanOptions} params.options
 * @param {Platform} params.platform
 * @param {Date} params.startedAt
 * @param {() => Date} [params.now]
 * @param {number} [params.concurrency]
 * @returns {Promise<ScanResult>}
 */
export async function scan({ roots, options, platform, startedAt, now = () => new Date(), concurrency = HASH_CONCURRENCY }) {
  const skipped = emptySkipCounts();
  /** @type {ScanResult['errors']} */
  const errors = [];
  /** @type {string[]} */
  const mountsSkipped = [];
  const onError = (/** @type {string} */ path, /** @type {unknown} */ error) => {
    errors.push({ path, ...describeError(error) });
  };

  const index = new FileIndex();
  let filesScanned = 0;
  let bytesScanned = 0;

  const entries = walk(roots, {
    filters: createFilters(options, platform),
    crossMounts: options.crossMounts,
    onSkip: (reason) => {
      skipped[reason] += 1;
    },
    onError,
    onMountSkipped: (path) => mountsSkipped.push(path),
  });
  for await (const entry of entries) {
    filesScanned += 1;
    bytesScanned += entry.size;
    index.add(entry);
  }
  index.finish();

  const { candidates, groups } = await findDuplicates(index, { concurrency, onError });
  const found = options.system ? await findExternalDrives(platform, roots) : [];

  return {
    roots,
    options,
    platform: platform.name,
    startedAt,
    finishedAt: now(),
    filesScanned,
    bytesScanned,
    candidates,
    skipped,
    mounts: { skipped: mountsSkipped, found },
    groups: groups.map((group) => ({ ...group, ...chooseKeeper(group.files) })),
    hardlinks: index.hardlinkSets(),
    errors,
  };
}
