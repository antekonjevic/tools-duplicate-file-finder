#!/usr/bin/env node
import { main } from '../src/main.js';

process.exitCode = await main({
  argv: process.argv.slice(2),
  stdout: process.stdout,
  stderr: process.stderr,
  cwd: process.cwd(),
});
