/** @import { Report } from './model.js' */

/**
 * The canonical report: everything dff knows about the scan.
 *
 * @param {Report} report
 */
export function renderJson(report) {
  return `${JSON.stringify(report, null, 2)}\n`;
}
