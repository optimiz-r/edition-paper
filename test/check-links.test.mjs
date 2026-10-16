import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { packageLinks } from '../scripts/check-links.mjs';

test('the publish check opens the pages npm links to, as a browser would', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.deepEqual(packageLinks(pkg), [
    ['repository', 'https://github.com/optimiz-r/edition-paper'],
    ['bugs', 'https://github.com/optimiz-r/edition-paper/issues'],
    ['homepage', 'https://edition.cafe/paper'],
  ]);
  assert.match(pkg.scripts.prepublishOnly, /check-links\.mjs/);
});

test('string and object forms both count; absent fields are skipped', () => {
  assert.deepEqual(packageLinks({ repository: 'git+https://example.org/x.git', bugs: 'https://example.org/x/issues' }), [
    ['repository', 'https://example.org/x'],
    ['bugs', 'https://example.org/x/issues'],
  ]);
  assert.deepEqual(packageLinks({}), []);
});
