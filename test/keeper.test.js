import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chooseKeeper } from '../src/keeper.js';

/** @import { PhysicalFile } from '../src/group.js' */

/**
 * @param {string} name
 * @param {bigint | null} birthtimeNs
 * @param {bigint} mtimeNs
 * @returns {PhysicalFile}
 */
function file(name, birthtimeNs, mtimeNs) {
  return { device: 1n, inode: BigInt(name.charCodeAt(0)), size: 10, paths: [`/${name}`], birthtimeNs, mtimeNs };
}

test('the oldest created date wins, even when its modified date is newer', () => {
  const a = file('a', 300n, 900n);
  const b = file('b', 100n, 999n);
  const c = file('c', 200n, 100n);
  assert.deepEqual(chooseKeeper([a, b, c]), { basis: 'birthtime', keeper: b });
});

test('a created-date tie is broken by the oldest modified date', () => {
  const a = file('a', 100n, 500n);
  const b = file('b', 100n, 400n);
  const c = file('c', 200n, 1n);
  assert.deepEqual(chooseKeeper([a, b, c]), { basis: 'birthtime', keeper: b });
});

test('a tie on both dates is undecided; there is no path tie-break', () => {
  const short = file('a', 100n, 500n);
  const long = file('b', 100n, 500n);
  assert.deepEqual(chooseKeeper([long, short]), { basis: 'birthtime', keeper: null });
});

test('only the oldest files need to tie for the group to be undecided', () => {
  const a = file('a', 100n, 500n);
  const b = file('b', 100n, 500n);
  const newer = file('c', 900n, 900n);
  assert.equal(chooseKeeper([a, b, newer]).keeper, null);
});

test('if any file has no created date, the whole group is compared by modified date', () => {
  // `a` has the oldest created date, but `b` has none, so created dates are
  // ignored and `c` wins on modified date.
  const a = file('a', 1n, 500n);
  const b = file('b', null, 400n);
  const c = file('c', 300n, 100n);
  assert.deepEqual(chooseKeeper([a, b, c]), { basis: 'mtime', keeper: c });
});

test('modified-date ties are undecided too', () => {
  assert.deepEqual(chooseKeeper([file('a', null, 5n), file('b', null, 5n)]), { basis: 'mtime', keeper: null });
});

test('dates are compared to the nanosecond', () => {
  const a = file('a', 1_700_000_000_000_000_001n, 0n);
  const b = file('b', 1_700_000_000_000_000_000n, 0n);
  assert.equal(chooseKeeper([a, b]).keeper, b);
});
