# Contributing to dff

Thanks for helping. dff aims to be a small, dependable tool and an example of
a well-made CLI, so changes are held to a few firm rules.

## Ground rules

1. **dff stays read-only.** No change may move, delete, rename, link or
   modify a scanned file. Features that do (a `--delete` flag, for example)
   won't be accepted. dff's job is the report; acting on it belongs to other
   tools.
2. **No runtime dependencies.** Node.js built-ins only.
3. **Behavior is documented.** [README.md](README.md) and the `--help` text
   in `src/cli.js` describe what dff does. A change in behavior updates both
   in the same pull request.
4. **The report format is a contract.** Adding fields is fine. Renaming or
   removing a field, or changing its meaning, is a breaking change: it bumps
   `SCHEMA_VERSION` in `src/report/model.js` and needs a major release.

## Setup

```sh
node --version   # 22.22 or later
npm test
```

There is nothing to install.

## Code layout

| Path | What it does |
|---|---|
| `bin/dff.js` | Entry point; sets the exit code. |
| `src/main.js` | Runs a whole invocation; testable with fake streams. |
| `src/cli.js` | Option parsing and validation, folder and report-path checks. |
| `src/platform.js` | Per-OS lists: system paths, bundles, app stores, `--system` roots, mount folders. |
| `src/filters.js` | Skip rules. |
| `src/walk.js` | Folder walk. |
| `src/group.js` | Size and hardlink grouping, hashing pipeline. |
| `src/hash.js` | Partial and full SHA-256, with change detection. |
| `src/keeper.js` | Keeper rule. |
| `src/mounts.js` | External drive discovery for `--system`. |
| `src/scan.js` | Ties a scan together. |
| `src/report/` | Report model and the JSON, CSV and text writers. |
| `src/summary.js` | Terminal summary. |
| `src/paths-only.js` | `--paths-only` output. |
| `src/format.js` | Size parsing, byte, date and duration formatting, `displayPath`. |
| `src/errors.js` | Error types and the `{ code, message }` form used in reports. |
| `src/concurrency.js` | Runs tasks with a concurrency limit, for hashing. |

## Tests

- Every change comes with tests. Use `node:test` and `node:assert/strict`.
- Build fixture trees in a temporary folder with the helpers in
  `test/helpers.js`; never depend on files outside the test's own folder.
- Inject the platform (`testPlatform()`) instead of reading
  `process.platform`, so tests behave the same on macOS and Linux.
- For situations a test can't create on disk (other drives, mount loops), use
  a fake file system as `test/walk.test.js` does.
- Report output is checked against golden files in `test/golden/`. After an
  intended change, run `UPDATE_GOLDEN=1 npm test` and review the diff before
  committing it.

## Style

- ES modules, `async`/`await`, no classes where a function will do.
- JSDoc types on exported functions.
- Comments explain *why*, not *what*.
- Messages to users are short and say what to do next.
- Anything printed to a terminal goes through `displayPath`, so file names
  can't inject control characters.

## Pull requests

Keep them focused: one change, its tests, and its documentation updates.
Describe what changed for users, and why.
