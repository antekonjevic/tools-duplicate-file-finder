import { readFileSync } from 'node:fs';
import { HELP, parseCli, resolveReportPath, resolveRoots } from './cli.js';
import { UsageError, describeError } from './errors.js';
import { writePaths } from './paths-only.js';
import { getPlatform } from './platform.js';
import { buildReport } from './report/model.js';
import { renderReport, writeReportFile } from './report/write.js';
import { scan } from './scan.js';
import { renderSummary } from './summary.js';

/** @import { Platform } from './platform.js' */

export const EXIT = Object.freeze({ OK: 0, FATAL: 1, USAGE: 2 });

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
export const TOOL = Object.freeze({ name: 'dff', version: /** @type {string} */ (pkg.version) });

/**
 * Runs dff with the given arguments and streams. Never calls process.exit, so
 * it can be tested like any other function.
 *
 * @param {object} params
 * @param {string[]} params.argv
 * @param {NodeJS.WritableStream} params.stdout
 * @param {NodeJS.WritableStream} params.stderr
 * @param {string} params.cwd
 * @param {Platform} [params.platform] Injected in tests; detected otherwise.
 * @param {() => Date} [params.now]
 * @returns {Promise<number>} The exit code.
 */
export async function main({ argv, stdout, stderr, cwd, platform, now = () => new Date() }) {
  const fail = (/** @type {number} */ code, /** @type {string} */ message) => {
    stderr.write(`dff: ${message}\n`);
    if (code === EXIT.USAGE) stderr.write("Run 'dff --help' for usage.\n");
    return code;
  };

  let command;
  try {
    command = parseCli(argv);
  } catch (error) {
    if (error instanceof UsageError) return fail(EXIT.USAGE, error.message);
    throw error;
  }
  if (command.command === 'help') {
    stdout.write(HELP);
    return EXIT.OK;
  }
  if (command.command === 'version') {
    stdout.write(`${TOOL.name} ${TOOL.version}\n`);
    return EXIT.OK;
  }
  const { options } = command;

  try {
    platform ??= getPlatform();
  } catch (error) {
    return fail(EXIT.FATAL, describeError(error).message);
  }

  const startedAt = now();
  let roots;
  let report;
  try {
    roots = await resolveRoots(options, platform, cwd);
    report = await resolveReportPath(options.report, cwd, startedAt);
  } catch (error) {
    if (error instanceof UsageError) return fail(EXIT.USAGE, error.message);
    return fail(EXIT.FATAL, describeError(error).message);
  }

  let result;
  try {
    result = await scan({ roots, options, platform, startedAt, now });
  } catch (error) {
    return fail(EXIT.FATAL, `scan failed: ${describeError(error).message}`);
  }

  const model = buildReport(result, TOOL);
  try {
    await writeReportFile(report.path, renderReport(model, report.format));
  } catch (error) {
    return fail(EXIT.FATAL, `cannot write the report to ${report.path}: ${describeError(error).message}`);
  }

  let paths = null;
  if (options.pathsOnly) {
    try {
      paths = await writePaths(stdout, model, { nul: options.nullSeparated });
    } catch (error) {
      return fail(EXIT.FATAL, `cannot print paths: ${describeError(error).message}`);
    }
  }

  stderr.write(renderSummary(model, { reportPath: report.path, paths }));
  return EXIT.OK;
}
