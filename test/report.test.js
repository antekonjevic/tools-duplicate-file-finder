import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import { describe, test } from 'node:test';
import { csvField, renderCsv } from '../src/report/csv.js';
import { renderJson } from '../src/report/json.js';
import { buildReport, SCHEMA_VERSION } from '../src/report/model.js';
import { renderText } from '../src/report/text.js';
import { renderSummary } from '../src/summary.js';
import { TOOL, sampleResult } from './fixtures.js';

/**
 * Compares output with a golden file. Run with UPDATE_GOLDEN=1 to rewrite
 * the golden files after an intended change, then review the diff.
 *
 * @param {string} name
 * @param {string} actual
 */
async function golden(name, actual) {
  const file = new URL(`./golden/${name}`, import.meta.url);
  if (process.env.UPDATE_GOLDEN) {
    await fsp.writeFile(file, actual);
    return;
  }
  assert.equal(actual, await fsp.readFile(file, 'utf8'));
}

const report = buildReport(sampleResult(), TOOL);

describe('report model', () => {
  test('schema and summary', () => {
    assert.equal(report.schema, SCHEMA_VERSION);
    assert.deepEqual(
      { ...report.summary, skipped: undefined },
      {
        filesScanned: 1234,
        bytesScanned: 20_000_000_000,
        candidates: 40,
        groups: 4,
        undecidedGroups: 1,
        duplicateFiles: 5,
        wastedBytes: 2 * 4_200_000_000 + 12_000_000 + 52_000 + 2_000,
        hardlinkSets: 1,
        birthtimeUnavailable: 1,
        errors: 3,
        permissionErrors: 2,
        skipped: undefined,
      },
    );
  });

  test('groups are sorted by wasted space and numbered from 1', () => {
    assert.deepEqual(
      report.groups.map((g) => [g.id, g.wastedBytes]),
      [
        [1, 8_400_000_000],
        [2, 12_000_000],
        [3, 52_000],
        [4, 2_000],
      ],
    );
  });

  test('keeper first, hardlinked paths listed as links', () => {
    const [movies] = report.groups;
    assert.deepEqual(
      movies.files.map((f) => [f.status, f.path, f.links]),
      [
        ['keeper', '/Users/x/Movies/trip-link.mov', ['/Users/x/Movies/trip.mov']],
        ['duplicate', '/Volumes/Backup/Movies/trip.mov', []],
        ['duplicate', '/Users/x/Downloads/trip (1).mov', []],
      ],
    );
  });

  test('identical dates make an undecided group with no keeper', () => {
    const photos = report.groups[1];
    assert.equal(photos.undecided, true);
    assert.deepEqual(photos.files.map((f) => f.status), ['undecided', 'undecided']);
  });

  test('a missing created date switches the group to modified dates', () => {
    const docs = report.groups[2];
    assert.equal(docs.keeperBasis, 'mtime');
    assert.equal(docs.files[0].path, '/srv/share/report, "final".pdf');
    assert.equal(docs.files[0].birthtime, null);
  });

  test('device and inode numbers beyond 2^53 become strings', () => {
    const result = sampleResult();
    result.groups[0].files[0].inode = 2n ** 60n;
    const big = buildReport(result, TOOL);
    const inodes = big.groups.flatMap((g) => g.files.map((f) => f.inode));
    assert.ok(inodes.includes(String(2n ** 60n)));
  });
});

describe('golden files', () => {
  test('JSON', () => golden('report.json', renderJson(report)));
  test('CSV', () => golden('report.csv', renderCsv(report)));
  test('text', () => golden('report.txt', renderText(report, { timeZone: 'UTC' })));
  test('terminal summary', () =>
    golden(
      'summary.txt',
      renderSummary(report, {
        reportPath: '/Users/x/dff-report-20261121-140211.json',
        paths: { printed: 6, undecidedGroups: 1, skippedNewline: 1, interrupted: false },
      }),
    ));
});

test('the JSON report round-trips', () => {
  assert.deepEqual(JSON.parse(renderJson(report)), JSON.parse(JSON.stringify(report)));
});

test('csvField quotes only when RFC 4180 requires it', () => {
  assert.equal(csvField('plain'), 'plain');
  assert.equal(csvField('a,b'), '"a,b"');
  assert.equal(csvField('say "hi"'), '"say ""hi"""');
  assert.equal(csvField('line\nbreak'), '"line\nbreak"');
  assert.equal(csvField(null), '');
  assert.equal(csvField(false), 'false');
});

test('text and summary never print raw control characters', () => {
  const text = renderText(report, { timeZone: 'UTC' });
  assert.ok(text.includes('/srv/share/report\\nfinal.pdf'));
  // eslint-disable-next-line no-control-regex
  assert.doesNotMatch(text.replace(/\n/g, ''), /[\u0000-\u001f]/);
});
