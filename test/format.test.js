import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  displayPath,
  formatBytes,
  formatDateTime,
  formatDuration,
  formatFileTimestamp,
  isoFromNs,
  parseSize,
} from '../src/format.js';
import { describeError } from '../src/errors.js';

describe('parseSize', () => {
  test('accepts bytes and binary suffixes, case-insensitive', () => {
    assert.equal(parseSize('500'), 500);
    assert.equal(parseSize('1k'), 1024);
    assert.equal(parseSize('1K'), 1024);
    assert.equal(parseSize('10M'), 10 * 1024 ** 2);
    assert.equal(parseSize('2g'), 2 * 1024 ** 3);
    assert.equal(parseSize('1T'), 1024 ** 4);
    assert.equal(parseSize('1.5k'), 1536);
    assert.equal(parseSize(' 0 '), 0);
  });

  test('rejects anything else', () => {
    for (const bad of ['', 'k', '-1', '1kb', '1 k', '1.2.3', '10X', 'abc']) {
      assert.equal(parseSize(bad), null, bad);
    }
  });
});

describe('formatBytes', () => {
  test('uses decimal units with one decimal', () => {
    assert.equal(formatBytes(0), '0 B');
    assert.equal(formatBytes(999), '999 B');
    assert.equal(formatBytes(1000), '1.0 kB');
    assert.equal(formatBytes(4_200_000_000), '4.2 GB');
    assert.equal(formatBytes(12_000_000), '12.0 MB');
  });

  test('never prints 1000.0 of a unit', () => {
    assert.equal(formatBytes(999_950), '1.0 MB');
  });
});

test('formatDuration', () => {
  assert.equal(formatDuration(400), '0.4s');
  assert.equal(formatDuration(454_000), '7m 34s');
  assert.equal(formatDuration(3_723_000), '1h 2m');
});

test('formatDateTime and formatFileTimestamp in a fixed zone', () => {
  const date = new Date('2026-11-21T14:02:11.482Z');
  assert.equal(formatDateTime(date, { timeZone: 'UTC' }), '2026-11-21 14:02:11');
  assert.equal(formatDateTime(date, { timeZone: 'UTC', seconds: false }), '2026-11-21 14:02');
  assert.equal(formatDateTime(date, { timeZone: 'UTC', ms: true }), '2026-11-21 14:02:11.482');
  assert.equal(formatDateTime(date, { timeZone: 'Asia/Tokyo' }), '2026-11-21 23:02:11');
  assert.equal(formatFileTimestamp(date, 'UTC'), '20261121-140211');
});

test('isoFromNs', () => {
  assert.equal(isoFromNs(null), null);
  assert.equal(isoFromNs(1_700_000_000_123_456_789n), '2023-11-14T22:13:20.123Z');
});

describe('displayPath', () => {
  test('leaves ordinary paths alone, including non-ASCII', () => {
    assert.equal(displayPath('/Users/x/Fotos/Ljeto 2024/čevapi.jpg'), '/Users/x/Fotos/Ljeto 2024/čevapi.jpg');
  });

  test('escapes line breaks, control characters and direction overrides', () => {
    assert.equal(displayPath('/a\nb'), '/a\\nb');
    assert.equal(displayPath('/a\tb\r'), '/a\\tb\\r');
    assert.equal(displayPath('/a\u001b[31mred'), '/a\\u{001b}[31mred');
    assert.equal(displayPath('/invoice‮fdp.exe'), '/invoice\\u{202e}fdp.exe');
  });
});

describe('describeError', () => {
  test('strips the code and path from Node file system messages', () => {
    const error = Object.assign(new Error("EACCES: permission denied, scandir '/x'"), { code: 'EACCES' });
    assert.deepEqual(describeError(error), { code: 'EACCES', message: 'permission denied' });
  });

  test('keeps other messages and falls back to EUNKNOWN', () => {
    assert.deepEqual(describeError(new Error('boom')), { code: 'EUNKNOWN', message: 'boom' });
    assert.deepEqual(describeError('text'), { code: 'EUNKNOWN', message: 'text' });
  });
});
