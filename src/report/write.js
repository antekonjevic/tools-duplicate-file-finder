import fsp from 'node:fs/promises';
import path from 'node:path';
import { renderCsv } from './csv.js';
import { renderJson } from './json.js';
import { renderText } from './text.js';

/** @import { Report } from './model.js' */

/**
 * @param {Report} report
 * @param {'json' | 'csv' | 'text'} format
 */
export function renderReport(report, format) {
  switch (format) {
    case 'json':
      return renderJson(report);
    case 'csv':
      return renderCsv(report);
    case 'text':
      return renderText(report);
    default:
      throw new Error(`unknown report format: ${format}`);
  }
}

/**
 * Writes the report through a temporary file and a rename, so the target is
 * either the complete new report or untouched; never half-written.
 *
 * The file is readable by its owner only (0600): a report lists every
 * scanned path, which is private on a shared machine.
 *
 * @param {string} target
 * @param {string} content
 */
export async function writeReportFile(target, content) {
  const temp = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.tmp`);
  try {
    await fsp.writeFile(temp, content, { flag: 'wx', mode: 0o600 });
    await fsp.rename(temp, target);
  } catch (error) {
    await fsp.rm(temp, { force: true });
    throw error;
  }
}
