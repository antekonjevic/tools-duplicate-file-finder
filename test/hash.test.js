import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { PARTIAL_CHUNK, PARTIAL_THRESHOLD, fullHash, partialHash } from '../src/hash.js';
import { tempDir } from './helpers.js';

/**
 * Writes a file and returns what the walk would have recorded for it.
 *
 * @param {string} file
 * @param {Buffer} content
 */
async function place(file, content) {
  await fsp.writeFile(file, content);
  const stat = await fsp.stat(file, { bigint: true });
  return { size: Number(stat.size), device: stat.dev, inode: stat.ino };
}

/** @param {Buffer} buffer @param {number} index */
function flipByte(buffer, index) {
  const copy = Buffer.from(buffer);
  copy[index] ^= 0xff;
  return copy;
}

test('full hash is the SHA-256 of the whole file', async (t) => {
  const dir = await tempDir(t);
  const content = randomBytes(3 * 1024 * 1024 + 17);
  const file = path.join(dir, 'f');
  const expected = await place(file, content);
  assert.equal(await fullHash(file, expected), createHash('sha256').update(content).digest('hex'));
});

test('partial hash tells apart files that differ at the start or the end', async (t) => {
  const dir = await tempDir(t);
  const base = randomBytes(PARTIAL_THRESHOLD + 1000);
  const a = await place(path.join(dir, 'a'), base);
  const start = await place(path.join(dir, 'start'), flipByte(base, 0));
  const end = await place(path.join(dir, 'end'), flipByte(base, base.length - 1));

  const hashA = await partialHash(path.join(dir, 'a'), a);
  assert.notEqual(hashA, await partialHash(path.join(dir, 'start'), start));
  assert.notEqual(hashA, await partialHash(path.join(dir, 'end'), end));
});

test('files that differ only in the middle pass the pre-check and are separated by the full hash', async (t) => {
  const dir = await tempDir(t);
  const base = randomBytes(2 * PARTIAL_CHUNK + 4096);
  const a = await place(path.join(dir, 'a'), base);
  const middle = await place(path.join(dir, 'middle'), flipByte(base, PARTIAL_CHUNK + 100));

  assert.equal(await partialHash(path.join(dir, 'a'), a), await partialHash(path.join(dir, 'middle'), middle));
  assert.notEqual(await fullHash(path.join(dir, 'a'), a), await fullHash(path.join(dir, 'middle'), middle));
});

test('a file that changed since the walk is reported, not hashed', async (t) => {
  const dir = await tempDir(t);
  const file = path.join(dir, 'f');
  const expected = await place(file, randomBytes(PARTIAL_THRESHOLD + 10));
  await fsp.appendFile(file, 'more');
  await assert.rejects(fullHash(file, expected), { code: 'ECHANGED' });
  await assert.rejects(partialHash(file, expected), { code: 'ECHANGED' });
});

test('a file replaced by another one of the same size is reported', async (t) => {
  const dir = await tempDir(t);
  const file = path.join(dir, 'f');
  const expected = await place(file, randomBytes(100));
  // The replacement is written while the original still exists, so it can't
  // get the original's inode number: ext4 reuses a freed one straight away.
  await fsp.writeFile(path.join(dir, 'other'), randomBytes(100));
  await fsp.rename(path.join(dir, 'other'), file);
  await assert.rejects(fullHash(file, expected), { code: 'ECHANGED' });
});
