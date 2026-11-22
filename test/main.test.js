import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { EXIT, main } from '../src/main.js';
import { MemoryStream, tempDir, testPlatform, writeTree } from './helpers.js';

/**
 * @param {string[]} argv
 * @param {string} cwd
 */
async function run(argv, cwd) {
  const stdout = new MemoryStream();
  const stderr = new MemoryStream();
  const code = await main({ argv, stdout, stderr, cwd, platform: testPlatform() });
  return { code, stdout: stdout.text(), stderr: stderr.text() };
}

test('a scan writes the report, prints a summary and exits 0', async (t) => {
  const dir = await tempDir(t);
  await writeTree(dir, { 'data/a.txt': 'dup', 'data/b.txt': 'dup' });
  const { code, stdout, stderr } = await run(['data'], dir);

  assert.equal(code, EXIT.OK);
  assert.equal(stdout, '');
  assert.match(stderr, /1 duplicate group · 1 duplicate file/);

  const [reportName] = (await fsp.readdir(dir)).filter((n) => n.startsWith('dff-report-'));
  assert.match(reportName, /^dff-report-\d{8}-\d{6}\.json$/);
  assert.match(stderr, new RegExp(`Report: .*${reportName}`));

  const reportPath = path.join(dir, reportName);
  const report = JSON.parse(await fsp.readFile(reportPath, 'utf8'));
  assert.equal(report.summary.groups, 1);
  assert.equal((await fsp.stat(reportPath)).mode & 0o777, 0o600);
});

test('finding no duplicates is still exit 0', async (t) => {
  const dir = await tempDir(t);
  await writeTree(dir, { 'a.txt': 'one', 'b.txt': 'two' });
  const { code, stderr } = await run(['.', '--report', 'r.txt'], dir);
  assert.equal(code, EXIT.OK);
  assert.match(stderr, /No duplicates found\./);
  assert.match(await fsp.readFile(path.join(dir, 'r.txt'), 'utf8'), /^dff report — /);
});

test('--paths-only prints duplicates to stdout and still writes the report', async (t) => {
  const dir = await tempDir(t);
  await writeTree(dir, { 'a.txt': 'dup', 'b.txt': 'dup', 'c.txt': 'dup' });
  const { code, stdout, stderr } = await run(['.', '--paths-only', '-0', '--report', 'r.csv'], dir);
  assert.equal(code, EXIT.OK);
  const printed = stdout.split('\0').filter(Boolean);
  // All three were created together; either one is the keeper and two are
  // printed, or the dates tie exactly and all three are printed.
  assert.ok(printed.length === 2 || printed.length === 3, stdout);
  assert.match(stderr, /Printed \d paths to standard output\./);
  assert.match(await fsp.readFile(path.join(dir, 'r.csv'), 'utf8'), /^group,hash,size,status/);
});

test('usage errors exit 2 and leave no report behind', async (t) => {
  const dir = await tempDir(t);
  for (const argv of [[], ['missing-folder'], ['.', '--report', 'r.html'], ['.', '-0'], ['.', '--report', 'nope/r.json']]) {
    const { code, stderr } = await run(argv, dir);
    assert.equal(code, EXIT.USAGE, argv.join(' '));
    assert.match(stderr, /^dff: .*\nRun 'dff --help' for usage\.\n$/);
  }
  assert.deepEqual(await fsp.readdir(dir), []);
});

test('--help and --version', async (t) => {
  const dir = await tempDir(t);
  const help = await run(['--help'], dir);
  assert.equal(help.code, EXIT.OK);
  assert.match(help.stdout, /^Usage: dff /);
  const version = await run(['--version'], dir);
  assert.match(version.stdout, /^dff \d+\.\d+\.\d+\n$/);
});

test('the bin script runs and passes the exit code through', async () => {
  const bin = new URL('../bin/dff.js', import.meta.url).pathname;
  const { stdout } = await promisify(execFile)(process.execPath, [bin, '--version']);
  assert.match(stdout, /^dff /);
  await assert.rejects(promisify(execFile)(process.execPath, [bin, '/definitely/not/here']), { code: 2 });
});
