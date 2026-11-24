// Loaded only in the harness. Emit a monotonic timestamp once the PDF's
// writeFile has completed, before Playwright closes Chromium.
const fs = require('node:fs');
const { syncBuiltinESMExports } = require('node:module');

function stamp(label) {
  fs.writeSync(2, `\n@@perf ${label} ${process.hrtime.bigint()}\n`);
}

if (process.env.EDITION_PERF_MARK_ENTRY && /[/\\]edition-paper[/\\]cli\.mjs$|[/\\]\.bin[/\\]edition-paper$/.test(process.argv[1] ?? '')) {
  stamp('entry');
}

const writeFile = fs.promises.writeFile;
fs.promises.writeFile = async function (...args) {
  const result = await writeFile.apply(this, args);
  if (typeof args[0] === 'string' && /[/\\]edition-\d{4}-\d\d-\d\d\.pdf$/.test(args[0])) stamp('pdf');
  return result;
};
syncBuiltinESMExports();
