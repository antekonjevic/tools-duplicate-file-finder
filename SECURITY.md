# Security

dff reads whole folders, and with `--system` a whole machine's user data, so
security problems matter even though it never changes a file.

## Reporting a vulnerability

Please report it privately, not in a public issue: use **Report a
vulnerability** on the repository's
[Security tab](https://github.com/antekonjevic/tools-duplicate-file-finder/security/advisories/new).
Include the dff version (`dff --version`), your OS, the command you ran and
what happened.

Examples of what counts:

- dff changing, moving or deleting a scanned file, or writing anywhere other
  than its report.
- A crafted file name that injects lines or terminal escape sequences into the
  summary or the text report.
- dff reading outside the folders it was given, for example by following a
  symlink.
- A report that other users on the machine can read.

## Supported versions

Fixes go into the latest release only.
