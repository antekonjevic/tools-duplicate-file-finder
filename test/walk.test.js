import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFilters } from '../src/filters.js';
import { findExternalDrives } from '../src/mounts.js';
import { walk } from '../src/walk.js';
import { scanOptions, testPlatform } from './helpers.js';

/**
 * A minimal in-memory file system for situations a test can't create on
 * disk: other drives, mount points and loops.
 *
 * @param {Record<string, { dev: number, ino: number, type: 'dir' | 'file' | 'symlink', children?: string[] }>} tree
 */
function fakeFs(tree) {
  /** @param {string} p */
  const node = (p) => {
    const entry = tree[p];
    if (!entry) throw Object.assign(new Error(`ENOENT: no such file or directory, lstat '${p}'`), { code: 'ENOENT' });
    return entry;
  };
  return {
    /** @param {string} p */
    async readdir(p) {
      return [...(node(p).children ?? [])];
    },
    /** @param {string} p */
    async lstat(p) {
      const entry = node(p);
      return {
        dev: BigInt(entry.dev),
        ino: BigInt(entry.ino),
        size: 10n,
        blocks: 8n,
        birthtimeNs: 1n,
        mtimeNs: 1n,
        isDirectory: () => entry.type === 'dir',
        isFile: () => entry.type === 'file',
        isSymbolicLink: () => entry.type === 'symlink',
      };
    },
  };
}

/**
 * @param {string[]} roots
 * @param {ReturnType<typeof fakeFs>} fs
 * @param {{ crossMounts?: boolean }} [options]
 */
async function collect(roots, fs, { crossMounts = false } = {}) {
  const files = [];
  const skips = [];
  const mounts = [];
  const errors = [];
  const entries = walk(roots, {
    filters: createFilters(scanOptions(), testPlatform()),
    crossMounts,
    onSkip: (reason) => skips.push(reason),
    onError: (p) => errors.push(p),
    onMountSkipped: (p) => mounts.push(p),
    fs: /** @type {any} */ (fs),
  });
  for await (const entry of entries) files.push(entry.path);
  return { files, skips, mounts, errors };
}

const withMount = {
  '/r': { dev: 1, ino: 1, type: /** @type {const} */ ('dir'), children: ['a', 'nas'] },
  '/r/a': { dev: 1, ino: 2, type: /** @type {const} */ ('file') },
  '/r/nas': { dev: 2, ino: 1, type: /** @type {const} */ ('dir'), children: ['b'] },
  '/r/nas/b': { dev: 2, ino: 2, type: /** @type {const} */ ('file') },
};

test('other drives inside a root are skipped and reported', async () => {
  const { files, mounts, skips } = await collect(['/r'], fakeFs(withMount));
  assert.deepEqual(files, ['/r/a']);
  assert.deepEqual(mounts, ['/r/nas']);
  assert.deepEqual(skips, ['mountPoints']);
});

test('--cross-mounts follows them', async () => {
  const { files, mounts } = await collect(['/r'], fakeFs(withMount), { crossMounts: true });
  assert.deepEqual(files, ['/r/a', '/r/nas/b']);
  assert.deepEqual(mounts, []);
});

test('a drive named as a root is scanned, and not reported as skipped from its parent', async () => {
  const { files, mounts } = await collect(['/r', '/r/nas'], fakeFs(withMount));
  assert.deepEqual(files, ['/r/a', '/r/nas/b']);
  assert.deepEqual(mounts, []);
});

test('a folder reachable twice (a bind-mount loop) is walked once', async () => {
  const tree = {
    '/r': { dev: 1, ino: 1, type: /** @type {const} */ ('dir'), children: ['a', 'loop'] },
    '/r/a': { dev: 1, ino: 2, type: /** @type {const} */ ('file') },
    // The same folder as /r, by device and inode.
    '/r/loop': { dev: 1, ino: 1, type: /** @type {const} */ ('dir'), children: ['a', 'loop'] },
  };
  const { files } = await collect(['/r'], fakeFs(tree));
  assert.deepEqual(files, ['/r/a']);
});

test('entries that vanish mid-walk are recorded as errors', async () => {
  const tree = {
    '/r': { dev: 1, ino: 1, type: /** @type {const} */ ('dir'), children: ['gone', 'a'] },
    '/r/a': { dev: 1, ino: 2, type: /** @type {const} */ ('file') },
  };
  const { files, errors } = await collect(['/r'], fakeFs(tree));
  assert.deepEqual(files, ['/r/a']);
  assert.deepEqual(errors, ['/r/gone']);
});

test('findExternalDrives lists drives under the mount folders that are not scanned', async () => {
  const tree = {
    '/Volumes': { dev: 1, ino: 1, type: /** @type {const} */ ('dir'), children: ['Macintosh HD', 'Backup', 'Scanned', 'empty'] },
    '/Volumes/Macintosh HD': { dev: 1, ino: 2, type: /** @type {const} */ ('symlink') },
    '/Volumes/Backup': { dev: 5, ino: 1, type: /** @type {const} */ ('dir'), children: [] },
    '/Volumes/Scanned': { dev: 6, ino: 1, type: /** @type {const} */ ('dir'), children: [] },
    '/Volumes/empty': { dev: 1, ino: 3, type: /** @type {const} */ ('dir'), children: [] },
    '/media': { dev: 1, ino: 9, type: /** @type {const} */ ('dir'), children: ['x'] },
    '/media/x': { dev: 1, ino: 10, type: /** @type {const} */ ('dir'), children: ['USB'] },
    '/media/x/USB': { dev: 7, ino: 1, type: /** @type {const} */ ('dir'), children: [] },
  };
  const platform = testPlatform({ mountRoots: ['/Volumes', '/media', '/mnt'] });
  const found = await findExternalDrives(platform, ['/Users', '/Volumes/Scanned/Photos'], /** @type {any} */ (fakeFs(tree)));
  assert.deepEqual(found, ['/Volumes/Backup', '/media/x/USB']);
});
