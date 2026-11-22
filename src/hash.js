import { createHash } from 'node:crypto';
import fsp from 'node:fs/promises';
import { FileChangedError } from './errors.js';

/** Bytes read from each end of a file for the pre-check. */
export const PARTIAL_CHUNK = 64 * 1024;

/** Files this size or smaller skip the pre-check: it would read them whole anyway. */
export const PARTIAL_THRESHOLD = 2 * PARTIAL_CHUNK;

const FULL_READ_CHUNK = 1024 * 1024;

/**
 * What the walk saw. Hashing checks the open file still matches it, so a file
 * replaced or resized in the meantime is reported rather than misdescribed.
 *
 * @typedef {{ size: number, device: bigint, inode: bigint }} Expected
 */

/**
 * @param {fsp.FileHandle} handle
 * @param {Expected} expected
 */
async function assertUnchanged(handle, expected) {
  const stat = await handle.stat({ bigint: true });
  if (
    !stat.isFile() ||
    Number(stat.size) !== expected.size ||
    stat.dev !== expected.device ||
    stat.ino !== expected.inode
  ) {
    throw new FileChangedError();
  }
}

/**
 * Fills `buffer` from `position`. A short read means the file shrank.
 *
 * @param {fsp.FileHandle} handle
 * @param {Buffer} buffer
 * @param {number} position
 */
async function readExactly(handle, buffer, position) {
  let offset = 0;
  while (offset < buffer.length) {
    const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, position + offset);
    if (bytesRead === 0) throw new FileChangedError();
    offset += bytesRead;
  }
}

/**
 * SHA-256 of the first and last 64 KB. Only meaningful for files larger than
 * `PARTIAL_THRESHOLD`, and only ever used to rule files out: equal partial
 * hashes are always confirmed with `fullHash`.
 *
 * @param {string} filePath
 * @param {Expected} expected
 * @returns {Promise<string>} Lowercase hex digest.
 */
export async function partialHash(filePath, expected) {
  const handle = await fsp.open(filePath, 'r');
  try {
    await assertUnchanged(handle, expected);
    const buffer = Buffer.allocUnsafe(PARTIAL_CHUNK);
    const hash = createHash('sha256');
    await readExactly(handle, buffer, 0);
    hash.update(buffer);
    await readExactly(handle, buffer, expected.size - PARTIAL_CHUNK);
    hash.update(buffer);
    return hash.digest('hex');
  } finally {
    await handle.close();
  }
}

/**
 * SHA-256 of the whole file.
 *
 * @param {string} filePath
 * @param {Expected} expected
 * @returns {Promise<string>} Lowercase hex digest.
 */
export async function fullHash(filePath, expected) {
  const handle = await fsp.open(filePath, 'r');
  try {
    await assertUnchanged(handle, expected);
    const hash = createHash('sha256');
    const buffer = Buffer.allocUnsafe(Math.min(FULL_READ_CHUNK, Math.max(expected.size, 1)));
    let position = 0;
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      if (bytesRead === 0) break;
      hash.update(bytesRead === buffer.length ? buffer : buffer.subarray(0, bytesRead));
      position += bytesRead;
      if (position > expected.size) throw new FileChangedError();
    }
    if (position !== expected.size) throw new FileChangedError();
    return hash.digest('hex');
  } finally {
    await handle.close();
  }
}
