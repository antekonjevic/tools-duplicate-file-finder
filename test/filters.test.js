import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { compileExclude, createFilters, extensionOf, isDataless, isUnder, neverScannedReason } from '../src/filters.js';
import { getPlatform } from '../src/platform.js';
import { scanOptions, testPlatform } from './helpers.js';

const mac = getPlatform('darwin', { homes: ['/Users/x'] });
const linux = getPlatform('linux', { homes: ['/root', '/home/x'] });

test('isUnder matches whole path segments only', () => {
  assert.ok(isUnder('/usr', '/usr'));
  assert.ok(isUnder('/usr/bin', '/usr'));
  assert.ok(!isUnder('/usrlocal', '/usr'));
  assert.ok(isUnder('/a/b', '/a/'));
});

test('extensionOf', () => {
  assert.equal(extensionOf('IMG_1.JPG'), 'jpg');
  assert.equal(extensionOf('archive.tar.gz'), 'gz');
  assert.equal(extensionOf('.bashrc'), '');
  assert.equal(extensionOf('README'), '');
});

test('isDataless: a size but no blocks on disk', () => {
  assert.ok(isDataless({ size: 10, blocks: 0 }));
  assert.ok(!isDataless({ size: 10, blocks: 8 }));
  assert.ok(!isDataless({ size: 0, blocks: 0 }));
});

describe('neverScannedReason on macOS', () => {
  test('system paths', () => {
    assert.equal(neverScannedReason('/System/Library', mac), 'system path /System');
    assert.equal(neverScannedReason('/private/var', mac), 'system path /private');
    assert.equal(neverScannedReason('/private/etc/hosts', mac), 'system path /private');
    assert.equal(neverScannedReason('/Library', mac), 'system path /Library');
    assert.equal(neverScannedReason('/Users/x', mac), null);
    assert.equal(neverScannedReason('/Volumes/Backup', mac), null);
  });

  test('/private/tmp is the one scannable place under /private', () => {
    assert.equal(neverScannedReason('/private/tmp', mac), null);
    assert.equal(neverScannedReason('/private/tmp/photos', mac), null);
    assert.equal(neverScannedReason('/private/tmpfoo', mac), 'system path /private');
  });

  test('~/Library is never scanned, in any home folder', () => {
    assert.equal(neverScannedReason('/Users/x/Library', mac), 'app-managed store ~/Library');
    assert.equal(neverScannedReason('/Users/other/Library/Mail', mac), 'app-managed store ~/Library');
    assert.equal(neverScannedReason('/Users/x/Documents/Library', mac), null);
    assert.equal(neverScannedReason('/Users/x/LibraryBooks', mac), null);
  });

  test('bundles, at any depth and in any case', () => {
    assert.equal(
      neverScannedReason('/Users/x/Pictures/Photos Library.photoslibrary', mac),
      'inside app bundle Photos Library.photoslibrary',
    );
    assert.equal(
      neverScannedReason('/Users/x/Pictures/Photos Library.photoslibrary/originals/A', mac),
      'inside app bundle Photos Library.photoslibrary',
    );
    assert.equal(neverScannedReason('/Users/x/Movies/Edit.FCPBUNDLE', mac), 'inside app bundle Edit.FCPBUNDLE');
    assert.match(String(neverScannedReason('/Volumes/Backup/Apps/Safari.app', mac)), /Safari\.app/);
  });

  test('a folder named exactly like an extension is not a bundle', () => {
    assert.equal(neverScannedReason('/Users/x/.app', mac), null);
    assert.equal(neverScannedReason('/Users/x/apps', mac), null);
  });
});

describe('neverScannedReason on Linux', () => {
  test('system paths', () => {
    assert.equal(neverScannedReason('/proc/1', linux), 'system path /proc');
    assert.equal(neverScannedReason('/var/lib/docker/overlay2', linux), 'system path /var/lib/docker');
    assert.equal(neverScannedReason('/snap/core', linux), 'system path /snap');
    assert.equal(neverScannedReason('/var/lib/mysql', linux), null);
    assert.equal(neverScannedReason('/home/x', linux), null);
  });

  test('drives under /run/media stay scannable although /run is a system path', () => {
    assert.equal(neverScannedReason('/run/user/1000', linux), 'system path /run');
    assert.equal(neverScannedReason('/run/media/x/USB', linux), null);
  });

  test('app-managed stores in any home folder', () => {
    assert.equal(neverScannedReason('/home/x/.var/app/org.gimp.GIMP', linux), 'app-managed store ~/.var/app');
    assert.equal(neverScannedReason('/home/other/.steam', linux), 'app-managed store ~/.steam');
    assert.equal(
      neverScannedReason('/root/.local/share/containers/storage', linux),
      'app-managed store ~/.local/share/containers',
    );
    assert.equal(neverScannedReason('/home/x/.local/share/Steam', linux), 'app-managed store ~/.local/share/Steam');
    assert.equal(neverScannedReason('/home/x/.local/share/other', linux), null);
    assert.equal(neverScannedReason('/srv/.steam', linux), null);
  });
});

describe('compileExclude', () => {
  test('a glob ending in /** also matches the folder itself', () => {
    const exclude = compileExclude('**/Downloads/**');
    assert.ok(exclude.matchesDirectory('/Users/x/Downloads'));
    assert.ok(exclude.matchesFile('/Users/x/Downloads/a.zip'));
    assert.ok(!exclude.matchesFile('/Users/x/Downloads.txt'));
  });

  test('other globs match what they say', () => {
    const exclude = compileExclude('**/*.tmp');
    assert.ok(exclude.matchesFile('/a/b/c.tmp'));
    assert.ok(!exclude.matchesDirectory('/a/b'));
  });
});

describe('createFilters', () => {
  const platform = testPlatform();
  const file = { size: 100, blocks: 8 };

  /** @param {Partial<import('../src/cli.js').ScanOptions>} overrides */
  const filters = (overrides = {}) => createFilters(scanOptions(overrides), platform);

  test('hidden files and hidden folders are controlled separately', () => {
    assert.equal(filters().file('/a/.env', '.env', file), 'hiddenFiles');
    assert.equal(filters().directory('/a/.config', '.config'), 'hiddenDirs');

    const filesOnly = filters({ hiddenFiles: true });
    assert.equal(filesOnly.file('/a/.env', '.env', file), null);
    assert.equal(filesOnly.directory('/a/.config', '.config'), 'hiddenDirs');

    const dirsOnly = filters({ hiddenDirs: true });
    assert.equal(dirsOnly.file('/a/.env', '.env', file), 'hiddenFiles');
    assert.equal(dirsOnly.directory('/a/.config', '.config'), null);
  });

  test('a hidden name on the default list needs both options', () => {
    assert.equal(filters().directory('/a/.git', '.git'), 'defaultExcludes');
    assert.equal(filters({ hiddenDirs: true }).directory('/a/.git', '.git'), 'defaultExcludes');
    assert.equal(filters({ defaultExcludes: false }).directory('/a/.git', '.git'), 'hiddenDirs');
    assert.equal(filters({ defaultExcludes: false, hiddenDirs: true }).directory('/a/.git', '.git'), null);
    assert.equal(filters({ defaultExcludes: false }).directory('/a/node_modules', 'node_modules'), null);
    assert.equal(filters().file('/a/.DS_Store', '.DS_Store', file), 'defaultExcludes');
  });

  test('never-scanned folders come first and cannot be turned off', () => {
    const blocked = createFilters(
      scanOptions({ defaultExcludes: false, hiddenDirs: true }),
      testPlatform({ systemPaths: ['/sys'] }),
    );
    assert.equal(blocked.directory('/sys', 'sys'), 'neverScanned');
  });

  test('size, extension and dataless rules', () => {
    assert.equal(filters().file('/a/e', 'e', { size: 0, blocks: 0 }), 'empty');
    assert.equal(filters({ minSize: 200 }).file('/a/f', 'f', file), 'belowMinSize');
    assert.equal(filters({ minSize: 100 }).file('/a/f', 'f', file), null);
    assert.equal(filters({ ext: ['jpg'] }).file('/a/f.PNG', 'f.PNG', file), 'extFiltered');
    assert.equal(filters({ ext: ['jpg'] }).file('/a/f.JPG', 'f.JPG', file), null);
    assert.equal(filters().file('/a/cloud', 'cloud', { size: 100, blocks: 0 }), 'dataless');
    assert.equal(filters({ includeDataless: true }).file('/a/cloud', 'cloud', { size: 100, blocks: 0 }), null);
  });

  test('user excludes apply to folders and files', () => {
    const f = filters({ excludes: ['**/cache/**', '**/*.tmp'] });
    assert.equal(f.directory('/a/cache', 'cache'), 'userExcludes');
    assert.equal(f.file('/a/b.tmp', 'b.tmp', file), 'userExcludes');
    assert.equal(f.file('/a/b.txt', 'b.txt', file), null);
  });
});
