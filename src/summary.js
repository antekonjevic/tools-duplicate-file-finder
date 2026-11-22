import { displayPath, formatBytes, formatDuration } from './format.js';
import { SKIP_LABELS, plural } from './report/labels.js';

/**
 * @import { Report } from './report/model.js'
 * @import { PathsResult } from './paths-only.js'
 */

const TOP_GROUPS = 10;

/**
 * The summary printed to standard error when a scan finishes: enough to
 * decide whether the report is worth opening, and where to find it.
 *
 * @param {Report} report
 * @param {{ reportPath: string, paths: PathsResult | null }} context
 */
export function renderSummary(report, { reportPath, paths }) {
  const { summary } = report;
  const elapsed = new Date(report.scan.finishedAt).getTime() - new Date(report.scan.startedAt).getTime();

  const lines = [
    `dff finished in ${formatDuration(elapsed)}.`,
    '',
    `${plural(summary.filesScanned, 'file')} scanned (${formatBytes(summary.bytesScanned)})`,
  ];

  if (summary.groups === 0) {
    lines.push('No duplicates found.');
  } else {
    lines.push(
      `${plural(summary.groups, 'duplicate group')} · ${plural(summary.duplicateFiles, 'duplicate file')}` +
        ` · ${formatBytes(summary.wastedBytes)} wasted`,
    );
    if (summary.undecidedGroups > 0) {
      lines.push(
        `${plural(summary.undecidedGroups, 'group')} undecided: the copies have identical dates, ` +
          'so no keeper is suggested; you decide',
      );
    }

    lines.push('', 'Top groups by wasted space');
    const top = report.groups.slice(0, TOP_GROUPS);
    const copiesOf = (/** @type {typeof top[number]} */ g) => `${formatBytes(g.size)} × ${g.copies}`;
    const wastedWidth = Math.max(...top.map((g) => formatBytes(g.wastedBytes).length));
    const copiesWidth = Math.max(...top.map((g) => copiesOf(g).length));
    for (const group of top) {
      const label = `[${group.id}]`.padEnd(`[${top.length}]`.length);
      const shown = displayPath(group.files[0].path);
      const tail = group.undecided ? `${shown}  (undecided)` : shown;
      lines.push(
        `  ${label} ${formatBytes(group.wastedBytes).padStart(wastedWidth)} wasted` +
          `  ${copiesOf(group).padStart(copiesWidth)}  ${tail}`,
      );
    }
    const more = report.groups.length - top.length;
    if (more > 0) lines.push(`  … ${plural(more, 'more group')} in the report`);
  }

  const skipped = SKIP_LABELS.filter(([key]) => summary.skipped[key] > 0).map(([key, , singular, pluralForm]) =>
    plural(summary.skipped[key], singular, pluralForm),
  );
  if (skipped.length > 0) lines.push('', `Skipped: ${skipped.join(' · ')}`);

  if (report.mounts.skipped.length > 0) {
    lines.push('', 'Mount points not followed (add --cross-mounts to follow them):');
    for (const p of report.mounts.skipped) lines.push(`  ${displayPath(p)}`);
  }
  if (report.mounts.found.length > 0) {
    lines.push('', 'External drives found but not scanned (add one as a folder argument to include it):');
    for (const p of report.mounts.found) lines.push(`  ${displayPath(p)}`);
  }

  if (summary.permissionErrors > 0) {
    lines.push('', `Warning: ${plural(summary.permissionErrors, 'item')} could not be read: permission denied.`);
    if (report.scan.platform === 'darwin') {
      lines.push(
        '  macOS protects some folders (Mail, Photos, Desktop, …) even from their owner. To include them,',
        '  grant your terminal app Full Disk Access: System Settings › Privacy & Security › Full Disk Access.',
      );
    }
  }
  if (summary.errors > 0) {
    lines.push(`${plural(summary.errors, 'error')} in total; details are in the report.`);
  }

  if (paths) {
    // After an early close the count is what was handed to the pipe, not what
    // the reader took, so no number is claimed.
    let line = paths.interrupted
      ? 'Standard output was closed early, so not every path was printed.'
      : `Printed ${plural(paths.printed, 'path')} to standard output.`;
    if (paths.undecidedGroups > 0) {
      line += ` Every path of the ${plural(paths.undecidedGroups, 'undecided group')} is included; check those first.`;
    }
    lines.push('', line);
    if (paths.skippedNewline > 0) {
      const verb = paths.skippedNewline === 1 ? 'was' : 'were';
      lines.push(
        `  ${plural(paths.skippedNewline, 'path')} containing a newline ${verb} not printed; use -0 to print every path.`,
      );
    }
  }

  lines.push('', `Report: ${displayPath(reportPath)}`);
  return `${lines.join('\n')}\n`;
}
