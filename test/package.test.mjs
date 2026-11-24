import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const json = (name) => JSON.parse(readFileSync(new URL(name, import.meta.url)));

test('the installed Playwright driver is a pinned production dependency', () => {
  const pkg = json('../package.json');
  const lock = json('../package-lock.json').packages;
  const version = pkg.dependencies?.['playwright-core'];
  assert.match(version ?? '', /^\d+\.\d+\.\d+$/);
  assert.equal(lock[''].dependencies['playwright-core'], version);
  assert.equal(lock['node_modules/playwright-core'].version, version);
  assert.ok(!lock['node_modules/playwright-core'].dev);
  assert.ok(!pkg.files.some((file) => file.startsWith('vendor/')));
  assert.equal(pkg.scripts.prepack, undefined);
});
