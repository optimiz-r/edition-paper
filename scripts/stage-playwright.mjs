// Keep unmodified distribution files for local Chromium launch and install.
// The upstream TTY, recorder, trace/report UIs, types, and screenshots' WebP
// encoder are outside edition-paper's runtime. Recheck pack smoke tests when
// upgrading Playwright, since its internal file layout can change.
import { cpSync, mkdirSync, mkdtempSync, renameSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const source = dirname(require.resolve('playwright-core/package.json'));
const vendor = fileURLToPath(new URL('../vendor/', import.meta.url));
const target = join(vendor, 'playwright-core');
const files = [
  'LICENSE', 'NOTICE', 'ThirdPartyNotices.txt', 'browsers.json', 'package.json',
  'index.js', 'index.mjs', 'cli.js', 'bin',
  'lib/bootstrap.js', 'lib/coreBundle.js', 'lib/entry/oopBrowserDownload.js',
  'lib/package.js', 'lib/server/chromium/appIcon.png',
  'lib/serverRegistry.js', 'lib/serverRegistry.js.LICENSE',
  'lib/utilsBundle.js', 'lib/utilsBundle.js.LICENSE', 'lib/xdg-open',
];

mkdirSync(vendor, { recursive: true });
const staging = mkdtempSync(join(vendor, '.playwright-'));
try {
  for (const file of files) {
    const to = join(staging, file);
    mkdirSync(dirname(to), { recursive: true });
    cpSync(join(source, file), to, { recursive: true });
  }
  rmSync(target, { recursive: true, force: true });
  renameSync(staging, target);
} finally {
  rmSync(staging, { recursive: true, force: true });
}
