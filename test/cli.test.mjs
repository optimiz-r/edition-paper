import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('../cli.mjs', import.meta.url));
const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const SETUP = 'W3siaWQiOiJsb2JzdGVycyIsIm5hbWUiOiJMb2JzdGVycyIsInR5cGUiOiJzdGF0aWMifV0';
const home = mkdtempSync(join(tmpdir(), 'edition-paper-cli-'));
after(() => rmSync(home, { recursive: true, force: true }));

const run = (...args) =>
  spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env: { ...process.env, HOME: home, USERPROFILE: home } });

test('--help and --version', () => {
  const help = run('--help');
  assert.equal(help.status, 0);
  assert.match(help.stdout, /--install-schedule <HHMM>/);
  // The help says what the button copies today.
  assert.match(help.stdout, /copies\s+"npx edition-paper --setup <param>"/);
  assert.doesNotMatch(help.stdout, /npm run paper/);
  assert.equal(run('--version').stdout.trim(), VERSION);
});

test('a bad call exits 1 with one line and no stack trace', () => {
  const missing = run();
  assert.equal(missing.status, 1);
  assert.equal(missing.stderr, 'Missing --setup. Open edition.cafe/paper and use "Copy 8am command".\n');
  const bad = run('--setup', 'not-a-setup!');
  assert.equal(bad.status, 1);
  assert.doesNotMatch(bad.stderr, /\n\s+at /);
});

test('--install-schedule off macOS fails politely with a hint', { skip: process.platform === 'darwin' && 'would install a real agent' }, () => {
  const result = run('--setup', SETUP, '--install-schedule', '0800');
  assert.equal(result.status, 1);
  assert.doesNotMatch(result.stderr, /ENOENT|\n\s+at /);
  assert.match(result.stderr, /The 8am schedule is built in only on macOS \(launchd\)\. Nothing was installed\./);
  assert.match(result.stderr, process.platform === 'win32' ? /Task Scheduler/ : /crontab -e/);
  assert.ok(result.stderr.includes(`edition-paper@${VERSION} --setup ${SETUP}`));
  assert.deepEqual(readdirSync(home), [], 'nothing written to HOME');
});

test('--uninstall-schedule off macOS has nothing to remove', { skip: process.platform === 'darwin' && 'would remove a real agent' }, () => {
  const result = run('--uninstall-schedule');
  assert.equal(result.status, 0);
  assert.match(result.stdout, /^Nothing to remove/);
});
