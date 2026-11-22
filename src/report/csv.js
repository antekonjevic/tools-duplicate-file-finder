/** @import { Report } from './model.js' */

export const CSV_COLUMNS = Object.freeze([
  'group',
  'hash',
  'size',
  'status',
  'undecided',
  'keeper_basis',
  'birthtime',
  'mtime',
  'device',
  'inode',
  'path',
]);

/**
 * Quotes a field when RFC 4180 requires it: commas, quotes and line breaks.
 * File names can contain all three.
 *
 * @param {string | number | boolean | null} value
 */
export function csvField(value) {
  const text = value === null ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/**
 * One row per path, so hardlinked paths each get their own row. Holds the
 * duplicate groups only; the summary, mounts, hardlinks and errors are in the
 * JSON and text reports.
 *
 * @param {Report} report
 */
export function renderCsv(report) {
  const rows = [CSV_COLUMNS.join(',')];
  for (const group of report.groups) {
    for (const file of group.files) {
      for (const filePath of [file.path, ...file.links]) {
        rows.push(
          [
            group.id,
            group.hash,
            group.size,
            file.status,
            group.undecided,
            group.keeperBasis,
            file.birthtime,
            file.mtime,
            file.device,
            file.inode,
            filePath,
          ]
            .map(csvField)
            .join(','),
        );
      }
    }
  }
  return `${rows.join('\r\n')}\r\n`;
}
