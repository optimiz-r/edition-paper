// Keep unmodified distribution files for local Chromium launch and install.
// The interactive CLI, recorder, trace/report UIs, types, and screenshots'
// WebP encoder are outside edition-paper's runtime. Recheck pack smoke tests
// when upgrading Playwright, since its internal file layout can change.
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const driver = 'playwright-core';
const sourceManifest = require.resolve(`${driver}/package.json`);
const source = dirname(sourceManifest);
const packageDir = fileURLToPath(new URL('../', import.meta.url));
const vendor = join(packageDir, 'vendor');
const target = join(vendor, driver);
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const pin = readJson(join(packageDir, 'package.json')).devDependencies[driver];
const lock = readJson(join(packageDir, 'package-lock.json')).packages;
const upstream = readJson(sourceManifest);

assert.match(pin, /^\d+\.\d+\.\d+$/, 'Pin Playwright Core to an exact release');
assert.equal(lock[''].devDependencies[driver], pin, 'Playwright Core lockfile pin');
assert.equal(lock[`node_modules/${driver}`].version, pin, 'Playwright Core lockfile resolution');
assert.equal(upstream.name, driver, 'Upstream Playwright Core package name');
assert.equal(upstream.version, pin, 'Installed Playwright Core must match the declared pin');

const files = [
  'LICENSE', 'NOTICE', 'ThirdPartyNotices.txt', 'browsers.json', 'package.json',
  'index.js', 'index.mjs', 'cli.js', 'bin',
  'lib/bootstrap.js', 'lib/coreBundle.js', 'lib/entry/oopBrowserDownload.js',
  'lib/package.js', 'lib/server/chromium/appIcon.png',
  'lib/serverRegistry.js', 'lib/serverRegistry.js.LICENSE',
  'lib/utilsBundle.js', 'lib/utilsBundle.js.LICENSE', 'lib/xdg-open',
];

function tree(root, dir = '') {
  return readdirSync(join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return tree(root, path);
    assert(entry.isFile(), `Expected a regular file: ${join(root, path)}`);
    return [path];
  });
}

function checkBundle(bundle) {
  const expected = files.flatMap((file) => file === 'bin' ? tree(source, file) : [file]);
  assert.deepEqual(tree(bundle).sort(), expected.sort(), 'Bundled Playwright file list');
  for (const file of expected) {
    assert(readFileSync(join(bundle, file)).equals(readFileSync(join(source, file))), `Bundled Playwright differs from ${pin}: ${file}`);
    const sidecar = `${file}.LICENSE`;
    if (existsSync(join(source, sidecar))) assert(expected.includes(sidecar), `Missing Playwright license: ${sidecar}`);
  }
}

const [mode, packedDir] = process.argv.slice(2);
if (mode === '--check') {
  checkBundle(packedDir ? resolve(packedDir, 'vendor', driver) : target);
} else {
  assert.equal(mode, undefined, 'Usage: node scripts/stage-playwright.mjs [--check [unpacked-package-directory]]');
  mkdirSync(vendor, { recursive: true });
  const staging = mkdtempSync(join(vendor, '.playwright-'));
  try {
    for (const file of files) {
      const to = join(staging, file);
      mkdirSync(dirname(to), { recursive: true });
      cpSync(join(source, file), to, { recursive: true });
    }
    checkBundle(staging);
    rmSync(target, { recursive: true, force: true });
    renameSync(staging, target);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}
console.log(`Verified bundled Playwright Core ${pin} against the pinned distribution.`);
