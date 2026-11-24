import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const readJson = (name) => JSON.parse(readFileSync(new URL(`../${name}`, import.meta.url), 'utf8'));

test('a fresh npm install and the lockfile select the same browser runtime', () => {
  const manifest = readJson('package.json');
  const lock = readJson('package-lock.json');
  const lockedVersion = lock.packages['node_modules/playwright-core'].version;
  assert.equal(manifest.dependencies['playwright-core'], lockedVersion);
  assert.equal(lock.packages[''].dependencies['playwright-core'], lockedVersion);
});
