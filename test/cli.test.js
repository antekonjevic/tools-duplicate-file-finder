import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { describe, test } from 'node:test';
import { parseCli, resolveReportPath, resolveRoots } from '../src/cli.js';
import { UsageError } from '../src/errors.js';
import { getPlatform } from '../src/platform.js';
import { tempDir, testPlatform } from './helpers.js';

/** @param {string[]} argv */
function options(argv) {
  const command = parseCli(argv);
  assert.equal(command.command, 'scan');
  return command.options;
}

describe('parseCli', () => {
  test('defaults', () => {
    assert.deepEqual(options(['/data']), {
      roots: ['/data'],
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
    });
  });

  test('every option', () => {
    const parsed = options([
      '--min-size', '10M',
      '--ext', 'JPG,.png', '--ext', 'heic,jpg',
      '--exclude', '**/Downloads/**', '--exclude', '/tmp/**',
      '--hidden-files', '--hidden-dirs', '--no-default-excludes', '--include-dataless', '--cross-mounts',
      '--system', '--report', 'out.csv', '--paths-only', '-0',
      'a', 'b',
    ]);
    assert.deepEqual(parsed, {
      roots: ['a', 'b'],
      system: true,
      minSize: 10 * 1024 ** 2,
      ext: ['jpg', 'png', 'heic'],
      excludes: ['**/Downloads/**', '/tmp/**'],
      hiddenFiles: true,
      hiddenDirs: true,
      defaultExcludes: false,
      includeDataless: true,
      crossMounts: true,
      report: 'out.csv',
      pathsOnly: true,
      nullSeparated: true,
    });
  });

  test('--system alone is enough', () => {
    assert.deepEqual(options(['--system']).roots, []);
  });

  test('help and version need no folders and ignore other arguments', () => {
    assert.deepEqual(parseCli(['--help']), { command: 'help' });
    assert.deepEqual(parseCli(['-h', '--min-size', 'nonsense']), { command: 'help' });
    assert.deepEqual(parseCli(['-v', 'x']), { command: 'version' });
  });

  /** @type {[string, string[], RegExp][]} */
  const usageErrors = [
    ['no folders', [], /no folders given/],
    ['unknown option', ['--frobnicate', 'x'], /Unknown option '--frobnicate'$/],
    ['missing value', ['x', '--report'], /--report/],
    ['bad size', ['--min-size', '10 MB', 'x'], /invalid --min-size/],
    ['empty extension', ['--ext', 'jpg,,png', 'x'], /empty extension/],
    ['relative exclude', ['--exclude', 'node_modules', 'x'], /can never match.*\*\*\/node_modules/],
    ['bad report extension', ['--report', 'out.html', 'x'], /unsupported report format "\.html"/],
    ['report without extension', ['--report', 'out', 'x'], /unsupported report format "out"/],
    ['-0 without --paths-only', ['-0', 'x'], /only works together with --paths-only/],
  ];
  for (const [name, argv, message] of usageErrors) {
    test(`usage error: ${name}`, () => {
      assert.throws(() => parseCli(argv), (error) => error instanceof UsageError && message.test(error.message));
    });
  }

  test('report extensions are case-insensitive', () => {
    assert.equal(options(['--report', 'R.JSON', 'x']).report, 'R.JSON');
  });
});

describe('resolveRoots', () => {
  test('resolves relative folders against cwd and merges repeats', async (t) => {
    const dir = await tempDir(t);
    await fsp.mkdir(path.join(dir, 'a'));
    const roots = await resolveRoots({ roots: ['a', './a', path.join(dir, 'a')], system: false }, testPlatform(), dir);
    assert.deepEqual(roots, [path.join(dir, 'a')]);
  });

  test('resolves symlinked folder arguments to their real path', async (t) => {
    const dir = await tempDir(t);
    await fsp.mkdir(path.join(dir, 'real'));
    await fsp.symlink(path.join(dir, 'real'), path.join(dir, 'link'));
    assert.deepEqual(await resolveRoots({ roots: ['link'], system: false }, testPlatform(), dir), [
      path.join(dir, 'real'),
    ]);
  });

  test('rejects missing folders, files and never-scanned locations', async (t) => {
    const dir = await tempDir(t);
    await fsp.writeFile(path.join(dir, 'file.txt'), 'x');
    const platform = testPlatform();
    await assert.rejects(resolveRoots({ roots: ['nope'], system: false }, platform, dir), /no such folder: nope/);
    await assert.rejects(resolveRoots({ roots: ['file.txt'], system: false }, platform, dir), /not a folder: file.txt/);

    const blocking = testPlatform({ systemPaths: [dir] });
    await assert.rejects(
      resolveRoots({ roots: ['.'], system: false }, blocking, dir),
      /dff never scans this location \(system path/,
    );
  });

  test('--system adds existing system roots and ignores missing ones', async (t) => {
    const dir = await tempDir(t);
    await fsp.mkdir(path.join(dir, 'home'));
    const platform = testPlatform({ systemRoots: [path.join(dir, 'home'), path.join(dir, 'missing')] });
    assert.deepEqual(await resolveRoots({ roots: [], system: true }, platform, dir), [path.join(dir, 'home')]);
  });

  test('--system with no existing locations is a usage error', async (t) => {
    const dir = await tempDir(t);
    const platform = testPlatform({ systemRoots: [path.join(dir, 'missing')] });
    await assert.rejects(resolveRoots({ roots: [], system: true }, platform, dir), /nothing to scan/);
  });
});

describe('resolveReportPath', () => {
  test('default name uses the start time, in the current folder', async (t) => {
    const dir = await tempDir(t);
    const report = await resolveReportPath(null, dir, new Date());
    assert.match(path.basename(report.path), /^dff-report-\d{8}-\d{6}\.json$/);
    assert.equal(path.dirname(report.path), dir);
    assert.equal(report.format, 'json');
  });

  test('format comes from the extension', async (t) => {
    const dir = await tempDir(t);
    assert.equal((await resolveReportPath('r.csv', dir, new Date())).format, 'csv');
    assert.equal((await resolveReportPath('r.TXT', dir, new Date())).format, 'text');
  });

  test('fails before scanning when the report folder is missing or the path is a folder', async (t) => {
    const dir = await tempDir(t);
    await fsp.mkdir(path.join(dir, 'taken.json'));
    await assert.rejects(resolveReportPath('missing/r.json', dir, new Date()), /folder does not exist/);
    await assert.rejects(resolveReportPath('taken.json', dir, new Date()), /is a folder/);
  });
});

test('getPlatform rejects unsupported systems', () => {
  assert.throws(() => getPlatform('win32'), /unsupported platform "win32"/);
});
