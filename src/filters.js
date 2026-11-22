import path from 'node:path';

/**
 * @import { Platform } from './platform.js'
 * @import { ScanOptions } from './cli.js'
 */

/** Names skipped by default; `--no-default-excludes` turns this list off. */
export const DEFAULT_EXCLUDED_NAMES = Object.freeze(
  new Set(['node_modules', '.git', '.cache', '.Trash', '.DS_Store', 'Caches']),
);

/**
 * Why an entry was skipped. The names match the keys of `summary.skipped` in
 * the JSON report.
 *
 * @typedef {'neverScanned' | 'userExcludes' | 'defaultExcludes' | 'hiddenDirs' | 'hiddenFiles'
 *   | 'empty' | 'belowMinSize' | 'extFiltered' | 'dataless'} SkipReason
 */

/**
 * True when `target` is `prefix` or inside it.
 *
 * @param {string} target
 * @param {string} prefix
 */
export function isUnder(target, prefix) {
  if (target === prefix) return true;
  const base = prefix.endsWith(path.sep) ? prefix : prefix + path.sep;
  return target.startsWith(base);
}

/** @param {string} name */
export function isHidden(name) {
  return name.startsWith('.');
}

/**
 * The lowercase extension without its dot: `IMG_1.JPG` → `jpg`. Hidden files
 * without another dot (`.bashrc`) have no extension.
 *
 * @param {string} name
 */
export function extensionOf(name) {
  return path.extname(name).slice(1).toLowerCase();
}

/**
 * A cloud placeholder (iCloud "Optimize Storage", Dropbox/OneDrive/Google
 * Drive online-only): it reports a size but takes no space on disk, because
 * its content lives in the cloud. Reading it would download it.
 *
 * @param {{ size: number, blocks: number }} stat
 */
export function isDataless({ size, blocks }) {
  return size > 0 && blocks === 0;
}

/**
 * The home folders `absPath` could be inside.
 *
 * @param {string} absPath
 * @param {Platform} platform
 */
function homesContaining(absPath, platform) {
  const homes = platform.homes.filter((home) => isUnder(absPath, home));
  for (const parent of platform.homeParents) {
    if (absPath.startsWith(parent + path.sep)) {
      const user = absPath.slice(parent.length + 1).split(path.sep)[0];
      if (user) homes.push(path.join(parent, user));
    }
  }
  return homes;
}

/**
 * @param {string} absPath
 * @param {Platform} platform
 */
function isSystemPath(absPath, platform) {
  if (platform.systemPathExceptions.some((exception) => isUnder(absPath, exception))) return null;
  return platform.systemPaths.find((prefix) => isUnder(absPath, prefix)) ?? null;
}

/**
 * Explains why dff never scans `absPath`, or returns null when it may. No
 * option overrides this: these are system locations and app-managed stores
 * whose contents must not be edited by hand.
 *
 * @param {string} absPath An absolute, normalized path.
 * @param {Platform} platform
 * @returns {string | null}
 */
export function neverScannedReason(absPath, platform) {
  const systemPath = isSystemPath(absPath, platform);
  if (systemPath) return `system path ${systemPath}`;

  if (platform.bundleExtensions.length > 0) {
    for (const segment of absPath.split(path.sep)) {
      const lower = segment.toLowerCase();
      const ext = platform.bundleExtensions.find((e) => lower.endsWith(e) && lower.length > e.length);
      if (ext) return `inside app bundle ${segment}`;
    }
  }

  for (const home of homesContaining(absPath, platform)) {
    for (const store of platform.appStores) {
      if (isUnder(absPath, path.join(home, store))) return `app-managed store ~/${store}`;
    }
  }
  return null;
}

/**
 * Compiles an `--exclude` glob. Globs ending in `/**` also match the folder
 * itself, so `--exclude '**\/Downloads/**'` skips the Downloads folder without
 * walking it, instead of visiting every file inside only to skip each one.
 *
 * @param {string} glob
 */
export function compileExclude(glob) {
  const folderGlob = glob.endsWith('/**') ? glob.slice(0, -3) : null;
  return {
    /** @param {string} absPath */
    matchesFile: (absPath) => path.matchesGlob(absPath, glob),
    /** @param {string} absPath */
    matchesDirectory: (absPath) =>
      path.matchesGlob(absPath, glob) || (folderGlob !== null && path.matchesGlob(absPath, folderGlob)),
  };
}

/**
 * Builds the skip rules for one scan. Folders and files are checked
 * separately, and each check returns the first reason that applies, so every
 * skipped entry is counted exactly once.
 *
 * @param {Pick<ScanOptions, 'excludes' | 'defaultExcludes' | 'hiddenDirs' | 'hiddenFiles'
 *   | 'minSize' | 'ext' | 'includeDataless'>} options
 * @param {Platform} platform
 */
export function createFilters(options, platform) {
  const excludes = options.excludes.map(compileExclude);
  const extensions = options.ext ? new Set(options.ext) : null;

  return {
    /**
     * @param {string} absPath
     * @param {string} name
     * @returns {SkipReason | null}
     */
    directory(absPath, name) {
      if (neverScannedReason(absPath, platform)) return 'neverScanned';
      if (excludes.some((e) => e.matchesDirectory(absPath))) return 'userExcludes';
      // Checked before hidden: `.git` is on both lists and is only included
      // when both --no-default-excludes and --hidden-dirs are given.
      if (options.defaultExcludes && DEFAULT_EXCLUDED_NAMES.has(name)) return 'defaultExcludes';
      if (!options.hiddenDirs && isHidden(name)) return 'hiddenDirs';
      return null;
    },

    /**
     * @param {string} absPath
     * @param {string} name
     * @param {{ size: number, blocks: number }} stat
     * @returns {SkipReason | null}
     */
    file(absPath, name, stat) {
      if (excludes.some((e) => e.matchesFile(absPath))) return 'userExcludes';
      if (options.defaultExcludes && DEFAULT_EXCLUDED_NAMES.has(name)) return 'defaultExcludes';
      if (!options.hiddenFiles && isHidden(name)) return 'hiddenFiles';
      if (stat.size === 0) return 'empty';
      if (options.minSize !== null && stat.size < options.minSize) return 'belowMinSize';
      if (extensions && !extensions.has(extensionOf(name))) return 'extFiltered';
      if (!options.includeDataless && isDataless(stat)) return 'dataless';
      return null;
    },
  };
}
