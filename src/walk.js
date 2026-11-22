import fsp from 'node:fs/promises';
import path from 'node:path';

/**
 * @import { SkipReason } from './filters.js'
 * @import { createFilters } from './filters.js'
 */

/**
 * A regular file that passed every filter.
 *
 * @typedef {object} FileEntry
 * @property {string} path
 * @property {number} size
 * @property {bigint} device
 * @property {bigint} inode
 * @property {bigint | null} birthtimeNs Null when the file system doesn't record it.
 * @property {bigint} mtimeNs
 */

/**
 * Entries skipped for reasons that aren't filters.
 *
 * @typedef {SkipReason | 'mountPoints' | 'symlinks' | 'special'} SkipCounter
 */

/**
 * @typedef {object} WalkHooks
 * @property {ReturnType<typeof createFilters>} filters
 * @property {boolean} crossMounts
 * @property {(reason: SkipCounter) => void} onSkip
 * @property {(path: string, error: unknown) => void} onError
 * @property {(path: string) => void} onMountSkipped
 * @property {Pick<typeof fsp, 'lstat' | 'readdir'>} [fs] Injected in tests.
 */

/**
 * Walks every root and yields the regular files that pass the filters.
 *
 * - Depth-first with an explicit stack, as an async generator: memory stays
 *   flat however deep or wide the tree is.
 * - Uses lstat, so symlinks are never followed.
 * - Folders are visited at most once (by device and inode). That handles
 *   overlapping roots, the same folder named twice, and bind-mount loops.
 * - A root inside another root is walked on its own, with its own rules: it
 *   was named, so it is always scanned.
 * - Errors are reported through `onError`; one unreadable entry never ends
 *   the walk.
 *
 * @param {readonly string[]} roots Absolute, real folder paths.
 * @param {WalkHooks} hooks
 * @returns {AsyncGenerator<FileEntry>}
 */
export async function* walk(roots, { filters, crossMounts, onSkip, onError, onMountSkipped, fs = fsp }) {
  const visited = new Set();
  const rootSet = new Set(roots);

  for (const root of roots) {
    let rootStat;
    try {
      rootStat = await fs.lstat(root, { bigint: true });
    } catch (error) {
      onError(root, error);
      continue;
    }
    const rootKey = `${rootStat.dev}:${rootStat.ino}`;
    if (visited.has(rootKey)) continue;
    visited.add(rootKey);

    const stack = [root];
    while (stack.length > 0) {
      const dir = /** @type {string} */ (stack.pop());

      let names;
      try {
        names = (await fs.readdir(dir)).sort();
      } catch (error) {
        onError(dir, error);
        continue;
      }

      /** @type {string[]} */
      const subdirs = [];
      for (const name of names) {
        const absPath = path.join(dir, name);

        let stat;
        try {
          stat = await fs.lstat(absPath, { bigint: true });
        } catch (error) {
          onError(absPath, error);
          continue;
        }

        if (stat.isSymbolicLink()) {
          onSkip('symlinks');
          continue;
        }

        if (stat.isDirectory()) {
          if (rootSet.has(absPath)) continue;
          const reason = filters.directory(absPath, name);
          if (reason) {
            onSkip(reason);
            continue;
          }
          if (stat.dev !== rootStat.dev && !crossMounts) {
            onSkip('mountPoints');
            onMountSkipped(absPath);
            continue;
          }
          const key = `${stat.dev}:${stat.ino}`;
          if (visited.has(key)) continue;
          visited.add(key);
          subdirs.push(absPath);
          continue;
        }

        if (!stat.isFile()) {
          onSkip('special');
          continue;
        }

        const size = Number(stat.size);
        const reason = filters.file(absPath, name, { size, blocks: Number(stat.blocks) });
        if (reason) {
          onSkip(reason);
          continue;
        }

        yield {
          path: absPath,
          size,
          device: stat.dev,
          inode: stat.ino,
          // Node reports 0 when the file system has no creation time.
          birthtimeNs: stat.birthtimeNs === 0n ? null : stat.birthtimeNs,
          mtimeNs: stat.mtimeNs,
        };
      }

      // Pushed in reverse so folders come off the stack in name order, which
      // keeps the order of errors and mount points stable between runs.
      for (let i = subdirs.length - 1; i >= 0; i -= 1) stack.push(subdirs[i]);
    }
  }
}
