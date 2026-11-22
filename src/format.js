/**
 * Formatting and parsing helpers shared by the CLI, the reports and the
 * terminal summary. Everything here is pure and locale-independent, so output
 * is identical on every machine.
 */

const SIZE_MULTIPLIERS = { '': 1, k: 1024, m: 1024 ** 2, g: 1024 ** 3, t: 1024 ** 4 };

/**
 * Parses a size such as `500`, `1k`, `1.5M` or `10G`. Suffixes are powers of
 * 1024 and case-insensitive.
 *
 * @param {string} text
 * @returns {number | null} bytes, or null when the text isn't a valid size
 */
export function parseSize(text) {
  const match = /^(\d+(?:\.\d+)?)([kmgt])?$/i.exec(text.trim());
  if (!match) return null;
  const multiplier = SIZE_MULTIPLIERS[/** @type {keyof typeof SIZE_MULTIPLIERS} */ ((match[2] ?? '').toLowerCase())];
  const bytes = Math.floor(Number(match[1]) * multiplier);
  return Number.isSafeInteger(bytes) ? bytes : null;
}

const BYTE_UNITS = ['B', 'kB', 'MB', 'GB', 'TB', 'PB'];

/**
 * Formats a byte count for people, in decimal units: `4.2 GB`.
 *
 * @param {number} bytes
 */
export function formatBytes(bytes) {
  if (bytes < 1000) return `${bytes} B`;
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < BYTE_UNITS.length - 1) {
    value /= 1000;
    unit += 1;
  }
  // 999,950 bytes would otherwise print as "1000.0 kB".
  if (value.toFixed(1) === '1000.0' && unit < BYTE_UNITS.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return `${value.toFixed(1)} ${BYTE_UNITS[unit]}`;
}

const COUNT_FORMAT = new Intl.NumberFormat('en-US');

/** @param {number} count */
export function formatCount(count) {
  return COUNT_FORMAT.format(count);
}

/** @param {number} ms */
export function formatDuration(ms) {
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const whole = Math.round(seconds);
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m ${s}s`;
}

/** @type {Map<string, Intl.DateTimeFormat>} */
const dateFormats = new Map();

/**
 * @param {Date} date
 * @param {string | undefined} timeZone IANA zone; undefined means local time
 */
function dateParts(date, timeZone) {
  const key = timeZone ?? '';
  let format = dateFormats.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    dateFormats.set(key, format);
  }
  /** @type {Record<string, string>} */
  const parts = {};
  for (const part of format.formatToParts(date)) parts[part.type] = part.value;
  return parts;
}

/**
 * `2026-11-21 14:02:11`; `2026-11-21 14:02` without seconds;
 * `2026-11-21 14:02:11.482` with milliseconds.
 *
 * @param {Date} date
 * @param {{ timeZone?: string, seconds?: boolean, ms?: boolean }} [options]
 */
export function formatDateTime(date, { timeZone, seconds = true, ms = false } = {}) {
  const p = dateParts(date, timeZone);
  let time = `${p.hour}:${p.minute}`;
  if (seconds) time += `:${p.second}`;
  if (seconds && ms) time += `.${String(date.getUTCMilliseconds()).padStart(3, '0')}`;
  return `${p.year}-${p.month}-${p.day} ${time}`;
}

/**
 * `20261121-140211`, for the default report file name.
 *
 * @param {Date} date
 * @param {string} [timeZone]
 */
export function formatFileTimestamp(date, timeZone) {
  const p = dateParts(date, timeZone);
  return `${p.year}${p.month}${p.day}-${p.hour}${p.minute}${p.second}`;
}

// Control characters, plus the Unicode direction overrides that can make a
// file name display as something it isn't.
const UNSAFE_CHARS = /[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/gu;
/** @type {Record<string, string>} */
const NAMED_ESCAPES = { '\n': '\\n', '\r': '\\r', '\t': '\\t' };

/**
 * Makes a path safe to print to a terminal or a text report. File names can
 * contain newlines and escape sequences; printed raw they could fake report
 * lines or send commands to the terminal. Only for display: the JSON and CSV
 * reports and `--paths-only` always carry the real path.
 *
 * @param {string} text
 */
export function displayPath(text) {
  return text.replace(UNSAFE_CHARS, (char) => {
    return NAMED_ESCAPES[char] ?? `\\u{${(char.codePointAt(0) ?? 0).toString(16).padStart(4, '0')}}`;
  });
}

/**
 * Converts nanoseconds since the epoch to an ISO 8601 UTC string, or null.
 *
 * @param {bigint | null} ns
 */
export function isoFromNs(ns) {
  return ns === null ? null : new Date(Number(ns / 1_000_000n)).toISOString();
}
