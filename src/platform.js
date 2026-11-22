import os from 'node:os';

/**
 * Everything dff needs to know about the operating system. Keeping it in one
 * plain object means tests can inject a platform instead of depending on the
 * machine they run on.
 *
 * @typedef {object} Platform
 * @property {'darwin' | 'linux'} name
 * @property {readonly string[]} systemPaths Absolute paths that are never scanned.
 * @property {readonly string[]} systemPathExceptions Paths inside `systemPaths` that may still be scanned when named.
 * @property {readonly string[]} bundleExtensions Lowercase folder extensions whose contents are never scanned.
 * @property {readonly string[]} appStores Home-relative paths that are never scanned.
 * @property {readonly string[]} homeParents Folders whose children are home folders (`/home`).
 * @property {readonly string[]} homes Home folders outside `homeParents` (`/root`, the current user's).
 * @property {readonly string[]} systemRoots Folders `--system` scans.
 * @property {readonly string[]} mountRoots Folders where external drives are mounted.
 */

/** @type {Readonly<Record<Platform['name'], Omit<Platform, 'name' | 'homes'> & { extraHomes: readonly string[] }>>} */
const PLATFORMS = {
  darwin: {
    systemPaths: ['/System', '/private', '/Library', '/usr', '/bin', '/sbin', '/cores', '/dev', '/.vol'],
    // /tmp is a symlink to /private/tmp; people keep real files there.
    systemPathExceptions: ['/private/tmp'],
    bundleExtensions: [
      '.photoslibrary',
      '.app',
      '.musiclibrary',
      '.tvlibrary',
      '.fcpbundle',
      '.imovielibrary',
      '.aplibrary',
      '.photolibrary',
    ],
    // App data: containers, mail, application support. Hidden in Finder by a
    // flag Node can't read, so it is listed here instead.
    appStores: ['Library'],
    homeParents: ['/Users'],
    extraHomes: [],
    systemRoots: ['/Users'],
    mountRoots: ['/Volumes'],
  },
  linux: {
    systemPaths: [
      '/proc',
      '/sys',
      '/dev',
      '/run',
      '/boot',
      '/etc',
      '/usr',
      '/bin',
      '/sbin',
      '/lib',
      '/lib32',
      '/lib64',
      '/var/lib/snapd',
      '/var/lib/flatpak',
      '/var/lib/docker',
      '/var/lib/containers',
      '/snap',
    ],
    // Fedora and others mount external drives at /run/media/<user>/<drive>.
    systemPathExceptions: ['/run/media'],
    bundleExtensions: [],
    appStores: ['.var/app', '.local/share/flatpak', '.local/share/containers', '.local/share/Steam', '.steam'],
    homeParents: ['/home'],
    extraHomes: ['/root'],
    systemRoots: ['/home', '/srv', '/opt'],
    mountRoots: ['/media', '/run/media', '/mnt'],
  },
};

export const SUPPORTED_PLATFORMS = Object.freeze(Object.keys(PLATFORMS));

/**
 * @param {string} name A `process.platform` value.
 * @param {Partial<Platform>} [overrides] Replacements for any field, used by tests.
 * @returns {Platform}
 */
export function getPlatform(name = process.platform, overrides = {}) {
  if (!Object.hasOwn(PLATFORMS, name)) {
    throw new Error(`unsupported platform "${name}"; dff runs on macOS and Linux`);
  }
  const { extraHomes, ...base } = PLATFORMS[/** @type {Platform['name']} */ (name)];
  const homes = [...new Set([...extraHomes, os.homedir()])];
  return Object.freeze({ name: /** @type {Platform['name']} */ (name), ...base, homes, ...overrides });
}
