import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { describe, test } from 'node:test';
import { PARTIAL_CHUNK, PARTIAL_THRESHOLD } from '../src/hash.js';
import { groupPaths, isRoot, runScan, tempDir, testPlatform, writeTree } from './helpers.js';

const LARGE = PARTIAL_THRESHOLD + 5000;

/** @param {Buffer} buffer @param {number} index */
function flipByte(buffer, index) {
  const copy = Buffer.from(buffer);
  copy[index] ^= 0xff;
  return copy;
}

describe('finding duplicates', () => {
  test('exact duplicates of small and large files are grouped', async (t) => {
    const dir = await tempDir(t);
    const big = randomBytes(LARGE);
    await writeTree(dir, {
      'a/small.txt': 'same content',
      'b/small copy.txt': 'same content',
      'a/big.bin': big,
      'b/big.bin': big,
      'c/big.bin': big,
      'unique.txt': 'only one of these',
    });
    const result = await runScan([dir]);
    assert.deepEqual(groupPaths(result, dir), [
      ['a/big.bin', 'b/big.bin', 'c/big.bin'],
      ['a/small.txt', 'b/small copy.txt'],
    ]);
    assert.equal(result.filesScanned, 6);
    assert.equal(result.candidates, 5);
  });

  test('same size but different content is never a duplicate, wherever the difference is', async (t) => {
    const dir = await tempDir(t);
    const base = randomBytes(2 * PARTIAL_CHUNK + 8192);
    await writeTree(dir, {
      base: base,
      start: flipByte(base, 0),
      end: flipByte(base, base.length - 1),
      middle: flipByte(base, PARTIAL_CHUNK + 4096),
      'small-a': 'abcd',
      'small-b': 'abce',
    });
    const result = await runScan([dir]);
    assert.deepEqual(result.groups, []);
    assert.equal(result.candidates, 6);
  });

  test('hardlinks are one physical file, reported separately', async (t) => {
    const dir = await tempDir(t);
    await writeTree(dir, { 'a.txt': 'linked' });
    await fsp.link(path.join(dir, 'a.txt'), path.join(dir, 'b.txt'));
    const result = await runScan([dir]);
    assert.deepEqual(result.groups, []);
    assert.equal(result.hardlinks.length, 1);
    assert.deepEqual(result.hardlinks[0].paths, [path.join(dir, 'a.txt'), path.join(dir, 'b.txt')]);
  });

  test('a hardlinked set that duplicates a separate copy counts as one copy', async (t) => {
    const dir = await tempDir(t);
    await writeTree(dir, { 'a.txt': 'payload', 'copy.txt': 'payload' });
    await fsp.link(path.join(dir, 'a.txt'), path.join(dir, 'b.txt'));
    const result = await runScan([dir]);
    assert.equal(result.groups.length, 1);
    const [group] = result.groups;
    assert.equal(group.files.length, 2, 'two physical files');
    const linked = group.files.find((f) => f.paths.length === 2);
    assert.deepEqual(linked?.paths, [path.join(dir, 'a.txt'), path.join(dir, 'b.txt')]);
  });

  test('symlinks are never followed', async (t) => {
    const dir = await tempDir(t);
    await writeTree(dir, { 'real/a.txt': 'content' });
    await fsp.symlink(path.join(dir, 'real/a.txt'), path.join(dir, 'link.txt'));
    await fsp.symlink(path.join(dir, 'real'), path.join(dir, 'linkdir'));
    const result = await runScan([dir]);
    assert.deepEqual(result.groups, []);
    assert.equal(result.filesScanned, 1);
    assert.equal(result.skipped.symlinks, 2);
  });

  test('the older copy is suggested as the keeper', async (t) => {
    const dir = await tempDir(t);
    await writeTree(dir, { 'z-original.txt': 'x' });
    await new Promise((resolve) => setTimeout(resolve, 25));
    await writeTree(dir, { 'a-copy.txt': 'x' });
    const [group] = (await runScan([dir])).groups;
    assert.deepEqual(group.keeper?.paths, [path.join(dir, 'z-original.txt')]);
  });
});

describe('what gets scanned', () => {
  test('hidden files and hidden folders are skipped by default and included independently', async (t) => {
    const dir = await tempDir(t);
    await writeTree(dir, {
      'visible.txt': 'v',
      '.hidden-file': 'v',
      '.hidden-dir/inside.txt': 'v',
    });

    const plain = await runScan([dir]);
    assert.equal(plain.filesScanned, 1);
    assert.equal(plain.skipped.hiddenFiles, 1);
    assert.equal(plain.skipped.hiddenDirs, 1);

    const files = await runScan([dir], { hiddenFiles: true });
    assert.deepEqual(groupPaths(files, dir), [['.hidden-file', 'visible.txt']]);

    const dirs = await runScan([dir], { hiddenDirs: true });
    assert.deepEqual(groupPaths(dirs, dir), [['.hidden-dir/inside.txt', 'visible.txt']]);
  });

  test('default excludes, and turning them off', async (t) => {
    const dir = await tempDir(t);
    await writeTree(dir, { 'a.js': 'module', 'node_modules/pkg/a.js': 'module', 'Caches/a.js': 'module' });
    const plain = await runScan([dir]);
    assert.equal(plain.filesScanned, 1);
    assert.equal(plain.skipped.defaultExcludes, 2);
    const all = await runScan([dir], { defaultExcludes: false });
    assert.equal(all.groups[0].files.length, 3);
  });

  test('--exclude skips matching folders without walking them, and matching files', async (t) => {
    const dir = await tempDir(t);
    await writeTree(dir, { 'keep.txt': 'x', 'skip/a.txt': 'x', 'skip/b.txt': 'x', 'c.tmp': 'x' });
    const result = await runScan([dir], { excludes: ['**/skip/**', '**/*.tmp'] });
    assert.equal(result.filesScanned, 1);
    assert.equal(result.skipped.userExcludes, 2, 'the folder once and the .tmp file once');
  });

  test('bundle folders are never scanned', async (t) => {
    const dir = await tempDir(t);
    await writeTree(dir, {
      'photo.jpg': 'img',
      'Photos Library.photoslibrary/originals/photo.jpg': 'img',
      'Tool.app/Contents/photo.jpg': 'img',
    });
    const platform = testPlatform({ name: 'darwin', bundleExtensions: ['.photoslibrary', '.app'] });
    const result = await runScan([dir], { hiddenDirs: true, defaultExcludes: false }, platform);
    assert.equal(result.filesScanned, 1);
    assert.equal(result.skipped.neverScanned, 2);
  });

  test('empty files, --min-size and --ext', async (t) => {
    const dir = await tempDir(t);
    await writeTree(dir, {
      'empty-a': '',
      'empty-b': '',
      'small.jpg': 'ab',
      'small-copy.jpg': 'ab',
      'big.JPG': 'abcdefgh',
      'big.png': 'abcdefgh',
    });
    const plain = await runScan([dir]);
    assert.equal(plain.skipped.empty, 2);
    assert.equal(plain.groups.length, 2);

    const min = await runScan([dir], { minSize: 5 });
    assert.equal(min.skipped.belowMinSize, 2);
    assert.deepEqual(groupPaths(min, dir), [['big.JPG', 'big.png']]);

    const ext = await runScan([dir], { ext: ['jpg'] });
    assert.equal(ext.skipped.extFiltered, 1);
    assert.deepEqual(groupPaths(ext, dir), [['small-copy.jpg', 'small.jpg']]);
  });

  test('cloud placeholders (no blocks on disk) are skipped unless included', async (t) => {
    const dir = await tempDir(t);
    // A fully sparse file reports a size but uses no blocks, exactly like a
    // cloud placeholder.
    for (const name of ['cloud-a', 'cloud-b']) {
      const handle = await fsp.open(path.join(dir, name), 'w');
      await handle.truncate(1024 * 1024);
      await handle.close();
    }
    const blocks = (await fsp.stat(path.join(dir, 'cloud-a'))).blocks;
    if (blocks !== 0) {
      t.skip('this file system does not create sparse files');
      return;
    }
    const plain = await runScan([dir]);
    assert.equal(plain.skipped.dataless, 2);
    assert.equal(plain.filesScanned, 0);
    const included = await runScan([dir], { includeDataless: true });
    assert.equal(included.groups.length, 1);
  });

  test('overlapping roots are scanned once', async (t) => {
    const dir = await tempDir(t);
    await writeTree(dir, { 'a.txt': 'x', 'sub/b.txt': 'x' });
    const result = await runScan([path.join(dir, 'sub'), dir, dir]);
    assert.equal(result.filesScanned, 2);
    assert.deepEqual(groupPaths(result, dir), [['a.txt', 'sub/b.txt']]);
  });

  test('a named root is scanned even if it is hidden', async (t) => {
    const dir = await tempDir(t);
    await writeTree(dir, { '.config/a.txt': 'x', '.config/b.txt': 'x' });
    const result = await runScan([path.join(dir, '.config')]);
    assert.equal(result.groups.length, 1);
  });

  test('unreadable folders and files are recorded and the scan carries on', { skip: isRoot && 'running as root' }, async (t) => {
    const dir = await tempDir(t);
    await writeTree(dir, { 'ok/a.txt': 'x', 'ok/b.txt': 'x', 'locked/c.txt': 'x', 'secret.txt': 'y', 'secret-copy.txt': 'y' });
    await fsp.chmod(path.join(dir, 'locked'), 0o000);
    await fsp.chmod(path.join(dir, 'secret.txt'), 0o000);
    let result;
    try {
      result = await runScan([dir]);
    } finally {
      // Restored here rather than in t.after: after-hooks run in the order
      // they were added, and the temp folder's removal was added first.
      await fsp.chmod(path.join(dir, 'locked'), 0o755);
      await fsp.chmod(path.join(dir, 'secret.txt'), 0o644);
    }
    assert.deepEqual(groupPaths(result, dir), [['ok/a.txt', 'ok/b.txt']]);
    const codes = result.errors.map((e) => [path.relative(dir, e.path), e.code]).sort();
    assert.deepEqual(codes, [
      ['locked', 'EACCES'],
      ['secret.txt', 'EACCES'],
    ]);
  });
});
