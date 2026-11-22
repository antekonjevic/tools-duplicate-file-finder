import { chooseKeeper } from '../src/keeper.js';
import { emptySkipCounts } from '../src/scan.js';
import { scanOptions } from './helpers.js';

/** @import { PhysicalFile } from '../src/group.js' */
/** @import { ScanResult } from '../src/scan.js' */

/** @param {string} iso */
const ns = (iso) => BigInt(Date.parse(iso)) * 1_000_000n;

/**
 * @param {number} inode
 * @param {number} size
 * @param {string[]} paths
 * @param {string | null} birth
 * @param {string} mtime
 * @returns {PhysicalFile}
 */
function physical(inode, size, paths, birth, mtime) {
  // Sorted, as FileIndex.finish leaves them.
  return { device: 16777220n, inode: BigInt(inode), size, paths: [...paths].sort(), birthtimeNs: birth === null ? null : ns(birth), mtimeNs: ns(mtime) };
}

/**
 * A hand-made scan result covering every report feature: a decided group,
 * an undecided group, a group compared by modified date, a keeper chosen on
 * milliseconds, hardlinks, awkward path characters, mounts and errors.
 *
 * @returns {ScanResult}
 */
export function sampleResult() {
  const movieLinked = physical(10, 4_200_000_000, ['/Users/x/Movies/trip.mov', '/Users/x/Movies/trip-link.mov'], '2024-06-01T10:00:00.000Z', '2024-06-01T10:00:00.000Z');
  const movieBackup = physical(11, 4_200_000_000, ['/Volumes/Backup/Movies/trip.mov'], '2024-06-03T09:12:00.000Z', '2024-06-01T10:00:00.000Z');
  const movieDownload = physical(12, 4_200_000_000, ['/Users/x/Downloads/trip (1).mov'], '2025-01-12T08:00:00.000Z', '2025-01-12T08:00:00.000Z');

  const photoA = physical(20, 12_000_000, ['/Users/x/Pictures/a/IMG_0001.jpg'], '2023-03-02T12:00:00.000Z', '2023-03-02T12:00:00.000Z');
  const photoB = physical(21, 12_000_000, ['/Users/x/Pictures/b/IMG_0001.jpg'], '2023-03-02T12:00:00.000Z', '2023-03-02T12:00:00.000Z');

  const docOld = physical(30, 52_000, ['/srv/share/report, "final".pdf'], null, '2022-01-01T00:00:00.000Z');
  const docNew = physical(31, 52_000, ['/srv/share/report\nfinal.pdf'], '2022-05-01T00:00:00.000Z', '2022-06-01T00:00:00.000Z');

  const quickA = physical(40, 2_000, ['/Users/x/notes/a.md'], '2026-01-01T00:00:00.120Z', '2026-01-01T00:00:00.120Z');
  const quickB = physical(41, 2_000, ['/Users/x/notes/b.md'], '2026-01-01T00:00:00.480Z', '2026-01-01T00:00:00.480Z');

  const groups = [
    { hash: 'b'.repeat(64), size: 52_000, files: [docNew, docOld] },
    { hash: 'a'.repeat(64), size: 4_200_000_000, files: [movieBackup, movieDownload, movieLinked] },
    { hash: 'c'.repeat(64), size: 12_000_000, files: [photoB, photoA] },
    { hash: 'd'.repeat(64), size: 2_000, files: [quickB, quickA] },
  ].map((group) => ({ ...group, ...chooseKeeper(group.files) }));

  const skipped = { ...emptySkipCounts(), hiddenFiles: 12, hiddenDirs: 3, symlinks: 2, mountPoints: 1 };

  return {
    roots: ['/Users/x', '/Volumes/Backup', '/srv/share'],
    options: scanOptions({ minSize: 1024, ext: null, excludes: ['**/Downloads/tmp/**'] }),
    platform: 'darwin',
    startedAt: new Date('2026-11-21T14:02:11.120Z'),
    finishedAt: new Date('2026-11-21T14:09:45.882Z'),
    filesScanned: 1234,
    bytesScanned: 20_000_000_000,
    candidates: 40,
    skipped,
    mounts: { skipped: ['/Users/x/mnt/nas'], found: ['/Volumes/Camera'] },
    groups,
    hardlinks: [movieLinked],
    errors: [
      { path: '/Users/x/Library/Mail', code: 'EPERM', message: 'operation not permitted' },
      { path: '/Users/x/locked.txt', code: 'EACCES', message: 'permission denied' },
      { path: '/Users/x/tmp/vanished.bin', code: 'ECHANGED', message: 'file changed during scan' },
    ],
  };
}

export const TOOL = { name: 'dff', version: '1.0.0' };
