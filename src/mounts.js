import fsp from 'node:fs/promises';
import path from 'node:path';
import { isUnder } from './filters.js';

/** @import { Platform } from './platform.js' */

/**
 * Lists external drives mounted under the platform's mount folders
 * (`/Volumes`, `/media`, …) that the scan doesn't cover, so the summary can
 * point them out. A drive is a folder on a different device from its parent.
 * Two levels are checked, because Linux mounts drives at
 * `/media/<user>/<drive>`.
 *
 * Nothing found here is scanned: drives are only scanned when named.
 *
 * @param {Platform} platform
 * @param {readonly string[]} scannedRoots
 * @param {Pick<typeof fsp, 'lstat' | 'readdir'>} [fs]
 * @returns {Promise<string[]>}
 */
export async function findExternalDrives(platform, scannedRoots, fs = fsp) {
  /** @type {string[]} */
  const found = [];

  /**
   * @param {string} dir
   * @param {bigint} parentDevice
   * @param {number} depth
   */
  async function search(dir, parentDevice, depth) {
    let names;
    try {
      names = (await fs.readdir(dir)).sort();
    } catch {
      return;
    }
    for (const name of names) {
      const absPath = path.join(dir, name);
      let stat;
      try {
        stat = await fs.lstat(absPath, { bigint: true });
      } catch {
        continue;
      }
      // On macOS the startup disk appears in /Volumes as a symlink to "/".
      if (!stat.isDirectory()) continue;
      if (stat.dev !== parentDevice) {
        const covered = scannedRoots.some((root) => isUnder(root, absPath) || isUnder(absPath, root));
        if (!covered && !found.includes(absPath)) found.push(absPath);
      } else if (depth > 1) {
        await search(absPath, stat.dev, depth - 1);
      }
    }
  }

  for (const mountRoot of platform.mountRoots) {
    try {
      const stat = await fs.lstat(mountRoot, { bigint: true });
      if (stat.isDirectory()) await search(mountRoot, stat.dev, 2);
    } catch {
      // This mount folder doesn't exist on this machine.
    }
  }
  return found;
}
