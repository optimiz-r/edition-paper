#!/usr/bin/env node
// edition-paper: Edition's morning paper, printed. See README.md.

const major = Number(process.versions.node.split('.')[0]);
if (major < 20) {
  console.error(`edition-paper needs Node 20 or newer; this is Node ${process.versions.node}.`);
  process.exit(1);
}

// Playwright's debug streams can include request URLs, headers and page data.
// Set the exclusion before Playwright reads DEBUG for the first time.
if (process.env.DEBUG) process.env.DEBUG += ',-pw:*';
delete process.env.DEBUG_FILE;

const { diagnosticLine } = await import('./lib/errors.mjs');
const { main } = await import('./lib/main.mjs');
try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  // Expected failures are already reported in words; this is the rest, kept
  // to one line so the launchd log stays readable.
  console.error(`edition-paper: ${diagnosticLine(error)}`);
  process.exitCode = 1;
}
