import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import { selectPaths, writePaths } from '../src/paths-only.js';
import { buildReport } from '../src/report/model.js';
import { TOOL, sampleResult } from './fixtures.js';
import { MemoryStream } from './helpers.js';

const report = buildReport(sampleResult(), TOOL);

test('keepers are never selected; duplicates with all their links and every undecided path are', () => {
  const { paths, undecidedGroups } = selectPaths(report);
  assert.equal(undecidedGroups, 1);
  assert.deepEqual(paths, [
    '/Volumes/Backup/Movies/trip.mov',
    '/Users/x/Downloads/trip (1).mov',
    '/Users/x/Pictures/a/IMG_0001.jpg',
    '/Users/x/Pictures/b/IMG_0001.jpg',
    '/srv/share/report\nfinal.pdf',
    '/Users/x/notes/b.md',
  ]);
  for (const keeper of ['/Users/x/Movies/trip-link.mov', '/Users/x/Movies/trip.mov', '/Users/x/notes/a.md']) {
    assert.ok(!paths.includes(keeper), keeper);
  }
});

test('a hardlinked duplicate is printed with every path', () => {
  const result = sampleResult();
  const movies = result.groups.find((g) => g.files.some((f) => f.paths.length === 2));
  assert.ok(movies);
  // Make the backup copy the keeper, so the hardlinked file is a duplicate.
  movies.keeper = movies.files.find((f) => f.paths[0].startsWith('/Volumes/Backup')) ?? null;
  const { paths } = selectPaths(buildReport(result, TOOL));
  assert.ok(paths.includes('/Users/x/Movies/trip.mov'));
  assert.ok(paths.includes('/Users/x/Movies/trip-link.mov'));
});

test('newline mode leaves out paths containing a newline; -0 prints them', async () => {
  const lines = new MemoryStream();
  const byLine = await writePaths(lines, report, { nul: false });
  assert.equal(byLine.printed, 5);
  assert.equal(byLine.skippedNewline, 1);
  assert.ok(!lines.text().includes('report\nfinal'));
  assert.equal(lines.text().split('\n').filter(Boolean).length, 5);

  const nul = new MemoryStream();
  const byNul = await writePaths(nul, report, { nul: true });
  assert.equal(byNul.printed, 6);
  assert.equal(byNul.skippedNewline, 0);
  assert.deepEqual(nul.text().split('\0').slice(0, -1), selectPaths(report).paths);
});

test('a reader that closes early (| head) is not an error', async () => {
  const stream = new PassThrough();
  stream.destroy = /** @type {any} */ (() => stream);
  const pending = writePaths(stream, report, { nul: false });
  stream.emit('error', Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }));
  const result = await pending;
  assert.equal(result.interrupted, true);
});
