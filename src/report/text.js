import { displayPath, formatBytes, formatCount, formatDateTime, formatDuration } from '../format.js';
import { SKIP_LABELS, plural, shortHash } from './labels.js';

/** @import { Report, ReportGroup } from './model.js' */

const MARKERS = { keeper: '*', undecided: '?', duplicate: ' ' };

/** Paths longer than this aren't padded, so one long path can't push every column off screen. */
const MAX_PATH_COLUMN = 72;

/**
 * Lines of `label  value`, with labels padded to the same width.
 *
 * @param {[string, string | string[]][]} rows Multi-line values are indented under the first line.
 * @param {string} [indent]
 */
function table(rows, indent = '  ') {
  const width = Math.max(...rows.map(([label]) => label.length));
  const lines = [];
  for (const [label, value] of rows) {
    const values = Array.isArray(value) ? value : [value];
    const [first, ...rest] = values.length > 0 ? values : ['none'];
    lines.push(`${indent}${label.padEnd(width)}  ${first}`);
    for (const more of rest) lines.push(`${indent}${' '.repeat(width)}  ${more}`);
  }
  return lines;
}

/**
 * @param {string | null} iso
 * @param {string | undefined} timeZone
 * @param {boolean} ms
 */
function date(iso, timeZone, ms) {
  return iso === null ? '—'.padEnd(ms ? 23 : 19) : formatDateTime(new Date(iso), { timeZone, ms });
}

/**
 * Copies made in the same second look tied when shown to the second, even
 * though the keeper was chosen on finer timestamps. If the keeper's dates
 * would look the same as another copy's, the group is shown in milliseconds
 * so the reason for the choice stays visible.
 *
 * @param {ReportGroup} group
 * @param {string | undefined} timeZone
 */
function needsMilliseconds(group, timeZone) {
  const keeper = group.files.find((file) => file.status === 'keeper');
  if (!keeper) return false;
  const shown = (/** @type {ReportGroup['files'][number]} */ file) =>
    `${date(file.birthtime, timeZone, false)} ${date(file.mtime, timeZone, false)}`;
  const keeperShown = shown(keeper);
  return group.files.some((file) => file !== keeper && shown(file) === keeperShown);
}

/**
 * @param {ReportGroup} group
 * @param {string | undefined} timeZone
 */
export function renderGroup(group, timeZone) {
  let header =
    `[${group.id}] ${formatBytes(group.size)} × ${plural(group.copies, 'copy', 'copies')}` +
    ` — ${formatBytes(group.wastedBytes)} wasted   ${shortHash(group.hash)}`;
  if (group.undecided) header += '   UNDECIDED — your call';

  const lines = [header];
  if (group.keeperBasis === 'mtime') {
    lines.push('    compared by modified date only: some copies have no created date');
  }

  const ms = needsMilliseconds(group, timeZone);
  const paths = group.files.map((file) => displayPath(file.path));
  const width = Math.min(MAX_PATH_COLUMN, Math.max(...paths.map((p) => p.length)));
  group.files.forEach((file, i) => {
    const note = file.status === 'keeper' ? '  (keeper)' : '';
    lines.push(
      `  ${MARKERS[file.status]} ${paths[i].padEnd(width)}` +
        `  created ${date(file.birthtime, timeZone, ms)}  modified ${date(file.mtime, timeZone, ms)}${note}`,
    );
    for (const link of file.links) lines.push(`      = ${displayPath(link)}`);
  });
  return lines;
}

/**
 * The report for reading: scan details, summary, skip counts, mounts,
 * groups, hardlinks and errors, in that order. Paths are escaped for display;
 * the JSON and CSV reports carry them unchanged.
 *
 * @param {Report} report
 * @param {{ timeZone?: string }} [options] Defaults to local time.
 */
export function renderText(report, { timeZone } = {}) {
  const { scan, summary } = report;
  const started = new Date(scan.startedAt);
  const finished = new Date(scan.finishedAt);
  const roots = scan.roots.map(displayPath);
  /** @type {Record<string, any>} */
  const options = scan.options;

  const lines = [
    `dff report — ${formatDateTime(started, { timeZone, seconds: false })}  (roots: ${roots.join(', ')})`,
    `${plural(summary.filesScanned, 'file')} scanned · ${plural(summary.groups, 'duplicate group')}` +
      ` · ${formatBytes(summary.wastedBytes)} wasted`,
    `${plural(summary.undecidedGroups, 'group')} undecided · ${plural(summary.errors, 'error')}` +
      ` (${formatCount(summary.permissionErrors)} permission)`,
    '',
    'Scan',
    ...table([
      ['tool', `${report.tool.name} ${report.tool.version} on ${scan.platform}`],
      ['started', formatDateTime(started, { timeZone })],
      ['finished', `${formatDateTime(finished, { timeZone })}  (${formatDuration(finished.getTime() - started.getTime())})`],
      ['roots', roots],
      ['--system', scan.system ? 'yes' : 'no'],
      [
        'min size',
        options.minSize === null ? 'none' : `${formatBytes(options.minSize)} (${plural(options.minSize, 'byte')})`,
      ],
      ['extensions', options.ext === null ? 'all' : options.ext.join(', ')],
      ['excludes', options.excludes.map(displayPath)],
      ['hidden files', options.hiddenFiles ? 'included' : 'skipped'],
      ['hidden folders', options.hiddenDirs ? 'included' : 'skipped'],
      ['default excludes', options.defaultExcludes ? 'skipped' : 'included'],
      ['cloud placeholders', options.includeDataless ? 'included' : 'skipped'],
      ['other drives', options.crossMounts ? 'followed' : 'not followed'],
    ]),
    '',
    'Summary',
    ...table([
      ['files scanned', `${formatCount(summary.filesScanned)} (${formatBytes(summary.bytesScanned)})`],
      ['size candidates', formatCount(summary.candidates)],
      ['duplicate groups', `${formatCount(summary.groups)} (${formatCount(summary.undecidedGroups)} undecided)`],
      ['duplicate files', formatCount(summary.duplicateFiles)],
      ['space wasted', formatBytes(summary.wastedBytes)],
      ['hardlink sets', formatCount(summary.hardlinkSets)],
      ['no created date', formatCount(summary.birthtimeUnavailable)],
      ['errors', `${formatCount(summary.errors)} (${formatCount(summary.permissionErrors)} permission)`],
    ]),
    '',
    'Skipped',
    ...table(SKIP_LABELS.map(([key, label]) => [label, formatCount(summary.skipped[key])])),
    '',
    'Mounts',
    ...table([
      ['not followed', report.mounts.skipped.map(displayPath)],
      ['found, not scanned', report.mounts.found.map(displayPath)],
    ]),
    '',
    'Duplicate groups',
  ];

  if (report.groups.length === 0) lines.push('  none');
  for (const group of report.groups) lines.push('', ...renderGroup(group, timeZone));

  lines.push('', 'Hardlinks');
  if (report.hardlinks.length === 0) lines.push('  none');
  for (const set of report.hardlinks) {
    lines.push(`  ${formatBytes(set.size)} · ${plural(set.paths.length, 'path')} · device ${set.device} inode ${set.inode}`);
    for (const p of set.paths) lines.push(`    ${displayPath(p)}`);
  }

  lines.push('', 'Errors');
  if (report.errors.length === 0) lines.push('  none');
  const codeWidth = Math.max(0, ...report.errors.map((e) => e.code.length));
  for (const error of report.errors) {
    lines.push(`  ${error.code.padEnd(codeWidth)}  ${displayPath(error.path)}  ${error.message}`);
  }

  return `${lines.join('\n')}\n`;
}
