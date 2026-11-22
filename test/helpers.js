import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import { getPlatform } from '../src/platform.js';
import { scan } from '../src/scan.js';

/** @import { TestContext } from 'node:test' */
/** @import { ScanOptions } from '../src/cli.js' */
/** @import { Platform } from '../src/platform.js' */

/**
 * A fresh temporary folder, removed after the test. Resolved with realpath
 * because macOS's temp folder sits behind a symlink.
 *
 * @param {TestContext} t
 */
export async function tempDir(t) {
  const dir = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), 'dff-test-')));
  t.after(() => fsp.rm(dir, { recursive: true, force: true }));
  return dir;
}

/**
 * Writes files below `root`, creating folders as needed.
 *
 * @param {string} root
 * @param {Record<string, string | Buffer>} files Relative path → content.
 */
export async function writeTree(root, files) {
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(root, relative);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, content);
  }
}

/**
 * A Linux platform with nothing excluded, so tests can scan the temp folder
 * on any machine. Tests for the real lists use `getPlatform` directly.
 *
 * @param {Partial<Platform>} [overrides]
 */
export function testPlatform(overrides = {}) {
  return getPlatform('linux', {
    systemPaths: [],
    systemPathExceptions: [],
    homes: [],
    homeParents: [],
    appStores: [],
    ...overrides,
  });
}

/**
 * Scan options with every default, as the CLI would produce them.
 *
 * @param {Partial<ScanOptions>} [overrides]
 * @returns {ScanOptions}
 */
export function scanOptions(overrides = {}) {
  return {
    roots: [],
    system: false,
    minSize: null,
    ext: null,
    excludes: [],
    hiddenFiles: false,
    hiddenDirs: false,
    defaultExcludes: true,
    includeDataless: false,
    crossMounts: false,
    report: null,
    pathsOnly: false,
    nullSeparated: false,
    ...overrides,
  };
}

/**
 * @param {string[]} roots
 * @param {Partial<ScanOptions>} [overrides]
 * @param {Platform} [platform]
 */
export function runScan(roots, overrides = {}, platform = testPlatform()) {
  return scan({ roots, options: scanOptions(overrides), platform, startedAt: new Date() });
}

/**
 * Relative paths of every file in every duplicate group, for compact asserts.
 *
 * @param {Awaited<ReturnType<typeof runScan>>} result
 * @param {string} root
 */
export function groupPaths(result, root) {
  return result.groups
    .map((group) => group.files.flatMap((file) => file.paths.map((p) => path.relative(root, p))).sort())
    .sort((a, b) => a[0].localeCompare(b[0]));
}

/** Collects everything written to it. */
export class MemoryStream extends Writable {
  /** @type {Buffer[]} */
  chunks = [];

  /**
   * @param {Buffer | string} chunk
   * @param {BufferEncoding} encoding
   * @param {(error?: Error | null) => void} callback
   */
  _write(chunk, encoding, callback) {
    this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding));
    callback();
  }

  text() {
    return Buffer.concat(this.chunks).toString('utf8');
  }
}

/** True when running as root, where permission tests can't work. */
export const isRoot = process.getuid?.() === 0;
