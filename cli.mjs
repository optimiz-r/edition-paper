#!/usr/bin/env node
// edition-paper: Edition's morning paper, printed. See README.md.

const major = Number(process.versions.node.split('.')[0]);
if (major < 20) {
  console.error(`edition-paper needs Node 20 or newer; this is Node ${process.versions.node}.`);
  process.exit(1);
}

const { main } = await import('./lib/main.mjs');
try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  // Expected failures are already reported in words; this is the rest, kept
  // to one line so the launchd log stays readable.
  console.error(`edition-paper: ${error instanceof Error ? error.message.split('\n')[0] : error}`);
  process.exitCode = 1;
}
