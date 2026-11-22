import { formatCount } from '../format.js';

/**
 * How each skip counter is described to people, in report order:
 * `[key, heading, singular, plural]`.
 *
 * @type {ReadonlyArray<readonly [import('../walk.js').SkipCounter, string, string, string]>}
 */
export const SKIP_LABELS = Object.freeze([
  ['dataless', 'cloud placeholders', 'cloud placeholder', 'cloud placeholders'],
  ['hiddenFiles', 'hidden files', 'hidden file', 'hidden files'],
  ['hiddenDirs', 'hidden folders', 'hidden folder', 'hidden folders'],
  ['defaultExcludes', 'default excludes', 'default exclude', 'default excludes'],
  ['neverScanned', 'never-scanned folders', 'never-scanned folder', 'never-scanned folders'],
  ['userExcludes', 'matched --exclude', 'matched --exclude', 'matched --exclude'],
  ['mountPoints', 'mount points', 'mount point', 'mount points'],
  ['symlinks', 'symlinks', 'symlink', 'symlinks'],
  ['special', 'special files', 'special file', 'special files'],
  ['belowMinSize', 'below --min-size', 'below --min-size', 'below --min-size'],
  ['extFiltered', 'filtered by --ext', 'filtered by --ext', 'filtered by --ext'],
  ['empty', 'empty files', 'empty file', 'empty files'],
]);

/**
 * `1 group`, `2 groups`.
 *
 * @param {number} count
 * @param {string} singular
 * @param {string} [pluralForm]
 */
export function plural(count, singular, pluralForm = `${singular}s`) {
  return `${formatCount(count)} ${count === 1 ? singular : pluralForm}`;
}

/**
 * `sha256:9f2c3a1b4c5d…`: enough to tell groups apart when reading. The JSON
 * and CSV reports carry the full hash.
 *
 * @param {string} hash
 */
export function shortHash(hash) {
  const [algorithm, digest] = hash.split(':');
  return `${algorithm}:${digest.slice(0, 12)}…`;
}
