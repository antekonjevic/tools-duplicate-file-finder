import { forEachLimit } from './concurrency.js';
import { PARTIAL_THRESHOLD, fullHash, partialHash } from './hash.js';

/** @import { FileEntry } from './walk.js' */

/**
 * One file on disk, which may be reachable through several hardlinked paths.
 *
 * @typedef {object} PhysicalFile
 * @property {bigint} device
 * @property {bigint} inode
 * @property {number} size
 * @property {string[]} paths Sorted once `FileIndex.finish` has run.
 * @property {bigint | null} birthtimeNs
 * @property {bigint} mtimeNs
 */

/**
 * Files with identical content.
 *
 * @typedef {object} DuplicateGroup
 * @property {string} hash Lowercase SHA-256 hex digest.
 * @property {number} size
 * @property {PhysicalFile[]} files Two or more physical files.
 */

/**
 * Collects scanned files by size, merging hardlinked paths into one physical
 * file as they arrive. Grouping by size is what keeps dff fast: a file whose
 * size no other file shares can't have a duplicate and is never read.
 */
export class FileIndex {
  /** @type {Map<number, Map<string, PhysicalFile>>} */
  #bySize = new Map();

  /** @param {FileEntry} entry */
  add(entry) {
    let physical = this.#bySize.get(entry.size);
    if (!physical) {
      physical = new Map();
      this.#bySize.set(entry.size, physical);
    }
    const key = `${entry.device}:${entry.inode}`;
    const existing = physical.get(key);
    if (existing) {
      existing.paths.push(entry.path);
      return;
    }
    physical.set(key, {
      device: entry.device,
      inode: entry.inode,
      size: entry.size,
      paths: [entry.path],
      birthtimeNs: entry.birthtimeNs,
      mtimeNs: entry.mtimeNs,
    });
  }

  /** Sorts every file's paths, so the first path is stable between runs. */
  finish() {
    for (const physical of this.#bySize.values()) {
      for (const file of physical.values()) file.paths.sort();
    }
  }

  /** Physical files reachable through more than one path. */
  hardlinkSets() {
    /** @type {PhysicalFile[]} */
    const sets = [];
    for (const physical of this.#bySize.values()) {
      for (const file of physical.values()) if (file.paths.length > 1) sets.push(file);
    }
    return sets;
  }

  /** Sizes shared by at least two physical files: the only possible duplicates. */
  candidateGroups() {
    /** @type {PhysicalFile[][]} */
    const groups = [];
    for (const physical of this.#bySize.values()) {
      if (physical.size > 1) groups.push([...physical.values()]);
    }
    return groups;
  }
}

/**
 * Hashes every file in every group and splits the groups by digest, keeping
 * only subgroups of two or more. Files that fail to hash are reported and
 * dropped.
 *
 * @param {PhysicalFile[][]} groups
 * @param {(file: PhysicalFile) => Promise<string>} hashFile
 * @param {{ concurrency: number, onError: (path: string, error: unknown) => void }} options
 * @returns {Promise<{ digest: string, files: PhysicalFile[] }[]>}
 */
async function splitByHash(groups, hashFile, { concurrency, onError }) {
  /** @type {Map<PhysicalFile, string>} */
  const digests = new Map();
  await forEachLimit(groups.flat(), concurrency, async (file) => {
    try {
      digests.set(file, await hashFile(file));
    } catch (error) {
      onError(file.paths[0], error);
    }
  });

  const result = [];
  for (const group of groups) {
    /** @type {Map<string, PhysicalFile[]>} */
    const byDigest = new Map();
    for (const file of group) {
      const digest = digests.get(file);
      if (digest === undefined) continue;
      const bucket = byDigest.get(digest);
      if (bucket) bucket.push(file);
      else byDigest.set(digest, [file]);
    }
    for (const [digest, files] of byDigest) if (files.length > 1) result.push({ digest, files });
  }
  return result;
}

/**
 * Finds duplicate groups among the indexed files:
 *
 * 1. Only sizes shared by two or more physical files are considered.
 * 2. Files larger than 128 KB get a pre-check hash of their first and last
 *    64 KB. Files that differ there are dropped without being read in full.
 * 3. Whatever is left gets a full SHA-256. Equal size and equal full hash
 *    make a duplicate group.
 *
 * @param {FileIndex} index
 * @param {{ concurrency: number, onError: (path: string, error: unknown) => void }} options
 * @returns {Promise<{ candidates: number, groups: DuplicateGroup[] }>}
 */
export async function findDuplicates(index, options) {
  const sizeGroups = index.candidateGroups();
  const candidates = sizeGroups.reduce((sum, group) => sum + group.length, 0);

  const small = sizeGroups.filter((group) => group[0].size <= PARTIAL_THRESHOLD);
  const large = sizeGroups.filter((group) => group[0].size > PARTIAL_THRESHOLD);

  const prechecked = await splitByHash(
    large,
    (file) => partialHash(file.paths[0], file),
    options,
  );

  const confirmed = await splitByHash(
    [...small, ...prechecked.map((group) => group.files)],
    (file) => fullHash(file.paths[0], file),
    options,
  );

  return {
    candidates,
    groups: confirmed.map(({ digest, files }) => ({ hash: digest, size: files[0].size, files })),
  };
}
