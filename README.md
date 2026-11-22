# dff — duplicate file finder

`dff` scans folders, or the user-data areas of a whole system, finds files with
identical content, and writes a report you can read or feed to other tools.

```console
$ dff ~/Pictures /Volumes/Backup
dff finished in 41.2s.

182,340 files scanned (912.0 GB)
412 duplicate groups · 1,033 duplicate files · 48.2 GB wasted
9 groups undecided: the copies have identical dates, so no keeper is suggested; you decide

Top groups by wasted space
  [1]  8.4 GB wasted   4.2 GB × 3  /Users/x/Movies/trip.mov
  …

Report: /Users/x/dff-report-20261121-140211.json
```

**dff is read-only.** It never moves, deletes, renames, links or changes any
file it scans. The only file it writes is its own report. What to do about
duplicates is always your decision.

- **Exact:** duplicates are byte-identical, confirmed by a full SHA-256. No
  false positives.
- **Fast:** files with a unique size are never read, and large files are
  checked at both ends before being read in full.
- **Sensible defaults:** system folders, app libraries, hidden files,
  `node_modules`, caches and cloud placeholders are skipped. Each skip can be
  turned off, except system folders and app libraries.
- **No dependencies:** Node.js built-ins only.
- **macOS and Linux.**

## Install

Requires Node.js 22.22 or later. dff isn't published to npm; install it
straight from GitHub:

```sh
npm install --global github:antekonjevic/tools-duplicate-file-finder
```

To stay on released versions instead of the latest commit, install the newest
1.x release:

```sh
npm install --global github:antekonjevic/tools-duplicate-file-finder#semver:^1
```

Or run it from a clone:

```sh
git clone https://github.com/antekonjevic/tools-duplicate-file-finder.git
cd tools-duplicate-file-finder
node bin/dff.js --help
npm link          # optional: puts dff on your PATH
```

## Usage

```
dff [options] <dir> [<dir> ...]
dff [options] --system
```

| Option | Description |
|---|---|
| `--min-size <size>` | Skip files smaller than `<size>`: `500`, `1k`, `10M`, `2G` (k = 1024). |
| `--ext <list>` | Only these extensions: `jpg,png,heic`. Case-insensitive, repeatable. |
| `--exclude <glob>` | Skip paths matching the glob, matched against the absolute path. Repeatable. |
| `--hidden-files` | Include hidden files. |
| `--hidden-dirs` | Include hidden folders. |
| `--no-default-excludes` | Include `node_modules`, `.git`, `.cache`, `.Trash`, `.DS_Store`, `Caches`. |
| `--include-dataless` | Include cloud placeholder files. **This downloads them.** |
| `--cross-mounts` | Follow into other drives found inside a folder. |
| `--system` | Scan this system's user-data locations (`/Users` on macOS; `/home`, `/srv`, `/opt` on Linux). |
| `--report <file>` | Where to write the report; the format comes from the extension: `.json`, `.csv` or `.txt`. A file already at that path is replaced. Default: `./dff-report-<timestamp>.json`. |
| `--paths-only` | Also print duplicate paths to standard output (keepers are never printed). |
| `-0`, `--null` | With `--paths-only`, end each path with NUL instead of a newline. |
| `-h`, `--help` | Show the help. |
| `-v`, `--version` | Show the version. |

### Examples

Find duplicates between your laptop and a backup drive:

```sh
dff ~ /Volumes/Backup
```

Photos only, at least 100 kB, with a report to open in a spreadsheet:

```sh
dff ~/Pictures --ext jpg,jpeg,heic,png,raw --min-size 100k --report photos.csv
```

Leave out folders by pattern:

```sh
dff ~ --exclude '**/build/**' --exclude '**/Downloads/**' --exclude '/Users/x/VMs/**'
```

Hand the duplicate list to another tool. dff doesn't delete anything, but the
list is ready for whatever you decide to do. **Check undecided groups in the
report first:** every one of their paths is in the list, because dff doesn't
know which copy to keep.

```sh
# Review the list
dff ~/Downloads --paths-only | less

# NUL-separated, safe for any file name, into the tool of your choice
dff ~/Downloads --paths-only -0 | xargs -0 ls -l
```

## How it works

1. **Walk.** Every folder is walked depth-first without following symlinks.
   Other drives found inside a folder are skipped unless `--cross-mounts` is
   given; folders you name are always scanned, wherever they are.
2. **Group by size.** Only files whose size another file shares can be
   duplicates. The rest are never read.
3. **Merge hardlinks.** Paths that are hardlinks to the same file are one
   file: read once, never counted as wasted space, and listed in the report's
   `hardlinks` section.
4. **Pre-check.** For files over 128 KB, the first and last 64 KB are hashed.
   Files that differ there are dropped. Same-size files that differ almost
   always differ in their headers or trailing bytes, so non-duplicates are
   rarely read in full. The pre-check only ever rules files out.
5. **Full hash.** Whatever is left gets a full SHA-256. Same size and same
   hash make a duplicate group. Two different files sharing a SHA-256 is
   effectively impossible (around 10⁻⁵⁸ even across billions of files).
6. **Suggest a keeper.** The oldest created date wins; if created dates tie,
   the oldest modified date. If both tie, the group is **undecided** and you
   choose. If any copy has no created date (common on Linux), the group is
   compared by modified date only.

Files that are replaced, grow or shrink while dff is running are detected and
reported as errors instead of being misdescribed.

## What is skipped

| Skipped by default | Include with |
|---|---|
| `node_modules`, `.git`, `.cache`, `.Trash`, `.DS_Store`, `Caches` | `--no-default-excludes` |
| Hidden files (name starts with `.`) | `--hidden-files` |
| Hidden folders | `--hidden-dirs` |
| Cloud placeholders (iCloud "Optimize Storage", Dropbox/OneDrive/Google Drive online-only) | `--include-dataless` |
| Other drives found inside a folder | `--cross-mounts` |
| Empty files | — |

**Never scanned**, whatever the options:

- **macOS:** `/System`, `/private` (except `/private/tmp`, where `/tmp`
  lives), `/Library`, `/usr`, `/bin`, `/sbin`, `/cores`, `/dev`, `/.vol`,
  `~/Library` in every home folder, and the inside of app libraries and bundles:
  `.photoslibrary`, `.app`, `.musiclibrary`, `.tvlibrary`, `.fcpbundle`,
  `.imovielibrary`, `.aplibrary`, `.photolibrary`. Duplicates inside a Photos
  library are real, but removing them by hand breaks the library.
- **Linux:** `/proc`, `/sys`, `/dev`, `/run` (except drives under
  `/run/media`), `/boot`, `/etc`, `/usr`, `/bin`, `/sbin`, `/lib`, `/lib32`,
  `/lib64`, `/snap`,
  the Snap, Flatpak, Docker and container stores under `/var/lib`, and
  `~/.var/app`, `~/.local/share/flatpak`, `~/.local/share/containers`,
  `~/.local/share/Steam`, `~/.steam` in every home folder.

## Output

dff writes a **report file** every time, prints a short **summary** to
standard error, and with `--paths-only` prints a **path list** to standard
output.

| Format | For | Contents |
|---|---|---|
| JSON (default) | scripts and tools | Everything: scan details, summary, skip counts, mounts, groups, hardlinks, errors. Versioned with a `schema` field. |
| CSV | spreadsheets, `grep` | One row per path: `group,hash,size,status,undecided,keeper_basis,birthtime,mtime,device,inode,path` |
| Text | reading | The JSON content, laid out for people. |

Reports are created readable by you only (`0600`), because they list every
scanned path. For a full example of each format, see
[test/golden/](test/golden/); the JSON fields are typed in
[src/report/model.js](src/report/model.js).

### Exit codes

| Code | Meaning |
|---|---|
| `0` | The scan completed and the report was written, whether or not duplicates were found. |
| `1` | Fatal error: the scan couldn't complete or the report couldn't be written. |
| `2` | Usage error: a bad option or value, or a folder that doesn't exist or can't be scanned. |

Unreadable files and permission problems never stop a scan. They are listed in
the report and summarized at the end.

## Known limitations

- **APFS clones count as duplicates.** On macOS, copies made by Finder,
  `cp -c` and many build tools can be clones that share storage until one is
  changed. Node.js can't tell a clone from a copy, so the space reported as
  wasted can be higher than what deleting would free.
- **Fully sparse files look like cloud placeholders.** A file that reports a
  size but uses no disk blocks is treated as a placeholder and skipped. Such a
  file is all zeros, so little is lost.
- **Hidden means "starts with a dot".** macOS's separate hidden flag isn't
  visible to Node.js and is ignored. `~/Library`, the main folder it hides, is
  on the never-scanned list instead.
- **Globs don't match hidden names by default.** `**` and `*` skip names
  starting with `.`, so write `**/.cache/**` to exclude a hidden folder.
- **Created dates on Linux.** Where the file system has no creation time,
  dff uses modified dates. A few file systems report the change time instead,
  which dff can't detect.
- **Temporary folders on macOS.** `/tmp` can be scanned, and its paths are
  reported as `/private/tmp/...`. The per-user temp folder (`$TMPDIR`) can't.
- **Same-size edits during a scan aren't detected.** A file that is edited in
  place while dff reads it, without changing size, is hashed as whatever was
  read. For exact results, scan folders that nothing is writing to.

## Development

```sh
npm test                     # node:test, no dependencies
UPDATE_GOLDEN=1 npm test     # rewrite the report golden files after an intended change
```

Read [CONTRIBUTING.md](CONTRIBUTING.md) before changing behavior.

## License

[MIT](LICENSE)
