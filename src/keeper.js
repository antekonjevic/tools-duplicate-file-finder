/**
 * @import { PhysicalFile } from './group.js'
 */

/**
 * @typedef {'birthtime' | 'mtime'} KeeperBasis
 *
 * @typedef {object} KeeperDecision
 * @property {KeeperBasis} basis Which dates the decision started from.
 * @property {PhysicalFile | null} keeper Null when the group is undecided.
 */

/**
 * The items with the smallest key.
 *
 * @template T
 * @param {readonly T[]} items
 * @param {(item: T) => bigint} key
 */
function oldest(items, key) {
  let min = key(items[0]);
  let result = [items[0]];
  for (const item of items.slice(1)) {
    const value = key(item);
    if (value < min) {
      min = value;
      result = [item];
    } else if (value === min) {
      result.push(item);
    }
  }
  return result;
}

/**
 * Suggests which copy to keep:
 *
 * 1. The oldest created date wins.
 * 2. If several files tie for it, the oldest modified date among them wins.
 * 3. If they still tie, there is no keeper: the copies are indistinguishable
 *    and the user decides.
 *
 * If any file in the group has no created date (common on Linux), created
 * dates can't be compared fairly, so the whole group is compared by modified
 * date only.
 *
 * Dates are compared in nanoseconds. There is deliberately no path-based
 * tie-break: a path says nothing about which copy is the original.
 *
 * @param {readonly PhysicalFile[]} files At least two.
 * @returns {KeeperDecision}
 */
export function chooseKeeper(files) {
  const basis = files.every((file) => file.birthtimeNs !== null) ? 'birthtime' : 'mtime';
  let tied = files;
  if (basis === 'birthtime') tied = oldest(tied, (file) => /** @type {bigint} */ (file.birthtimeNs));
  tied = oldest(tied, (file) => file.mtimeNs);
  return { basis, keeper: tied.length === 1 ? tied[0] : null };
}
