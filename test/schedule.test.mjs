import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseCliArgs } from '../lib/args.mjs';
import { BrowserMissingError } from '../lib/browser.mjs';
import {
  installSchedule,
  otherPlatformHint,
  schedulePaths,
  stableNodePath,
  uninstallSchedule,
} from '../lib/schedule.mjs';

const PACKAGE_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const SETUP = 'W3siaWQiOiJsb2JzdGVycyIsIm5hbWUiOiJMb2JzdGVycyIsInR5cGUiOiJzdGF0aWMifV0';
const temps = [];
const tempHome = () => {
  const dir = mkdtempSync(join(tmpdir(), 'edition-paper-home-'));
  temps.push(dir);
  return dir;
};
after(() => temps.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const install = (home, argv) => parseCliArgs(['--setup', SETUP, '--install-schedule', '0800', ...argv], { home, cwd: home });

const fakeLaunchctl = ({ failBootstrap = 0 } = {}) => {
  const calls = [];
  let failures = failBootstrap;
  const exec = (command, args) => {
    calls.push([command, ...args]);
    if (args[0] === 'bootout') throw new Error('Boot-out failed: 3: No such process');
    if (args[0] === 'bootstrap' && failures-- > 0) throw new Error('Bootstrap failed: 5: Input/output error\nmore');
  };
  return { calls, exec };
};

test('Linux: no crash, nothing written, and a cron line that would work', async () => {
  const home = tempHome();
  const result = await installSchedule({
    options: install(home, ['--printer', "Ada's printer"]),
    platform: 'linux',
    home,
    packageDir: PACKAGE_DIR,
    version: '1.0.0',
    nodePath: '/home/ada/.nvm/versions/node/v24.13.0/bin/node',
    exec: () => assert.fail('must not call launchctl'),
    preflight: () => assert.fail('must not launch a browser'),
  });
  assert.equal(result.ok, false);
  assert.match(result.message, /built in only on macOS \(launchd\)\. Nothing was installed\./);
  assert.match(result.message, /crontab -e/);
  const cronLine = result.message.split('\n').find((line) => line.startsWith('0 8 * * * '));
  assert.equal(
    cronLine,
    `0 8 * * * PATH=/home/ada/.nvm/versions/node/v24.13.0/bin:/usr/bin:/bin npx --yes edition-paper@1.0.0 --setup ${SETUP} --printer 'Ada'\\''s printer' >> "$HOME/edition-paper.log" 2>&1`
  );
  assert.deepEqual(readdirSync(home), []);
});

test('cron gets minute then hour, and % is escaped', () => {
  const home = '/home/ada';
  const options = parseCliArgs(['--setup', SETUP, '--install-schedule', '0630', '--out', '/srv/100%'], { home, cwd: home });
  const message = otherPlatformHint({ platform: 'freebsd', options, version: '1.0.0', nodePath: '/usr/local/bin/node' });
  assert.match(message, /^30 6 \* \* \* .* --out '\/srv\/100\\%' >> /m);
});

test('Windows: a Task Scheduler recipe, PDF only', () => {
  const options = parseCliArgs(['--setup', SETUP, '--install-schedule', '0800', '--printer', 'Office', '--out', '/Papers/100% news'], { home: '/home/ada', cwd: '/' });
  const message = otherPlatformHint({ platform: 'win32', options, version: '1.0.0' });
  assert.match(message, /Task Scheduler/);
  assert.match(message, /edition-paper\.cmd/);
  assert.ok(message.includes(`npx --yes edition-paper@1.0.0 --setup ${SETUP} --no-print --out "/Papers/100%% news"\n`), message);
});

test('macOS: copies a self-contained runner, writes the agent, loads it', async () => {
  const home = tempHome();
  const { calls, exec } = fakeLaunchctl();
  let preflightBrowser;
  const result = await installSchedule({
    options: install(home, ['--printer', 'Brother']),
    platform: 'darwin',
    home,
    packageDir: PACKAGE_DIR,
    version: '1.0.0',
    nodePath: '/opt/homebrew/bin/node',
    uid: 501,
    exec,
    preflight: async (choice) => {
      preflightBrowser = choice;
    },
    sleep: async () => {},
  });
  const paths = schedulePaths(home);
  assert.equal(result.ok, true, result.message);
  assert.equal(preflightBrowser, 'auto');

  // The runner is the published files plus node_modules, nothing from the dev checkout.
  assert.deepEqual(readdirSync(paths.runnerDir).sort(), ['LICENSE', 'README.md', 'cli.mjs', 'lib', 'node_modules', 'package.json']);
  assert.ok(existsSync(join(paths.runnerDir, 'lib', 'main.mjs')));
  assert.ok(existsSync(join(paths.runnerDir, 'node_modules', 'playwright-core', 'package.json')));
  assert.ok(!existsSync(join(paths.runnerDir, 'test')));

  const plist = readFileSync(paths.plist, 'utf8');
  assert.ok(plist.includes('<string>/opt/homebrew/bin/node</string>'));
  assert.ok(plist.includes(`<string>${join(paths.runnerDir, 'cli.mjs')}</string>`));
  assert.ok(plist.includes(`<string>${SETUP}</string>`));
  assert.ok(plist.includes('<string>Brother</string>'));
  assert.ok(plist.includes(`<string>${paths.log}</string>`));
  assert.ok(existsSync(dirname(paths.log)));

  assert.deepEqual(calls, [
    ['launchctl', 'bootout', 'gui/501', paths.legacyPlist],
    ['launchctl', 'bootout', 'gui/501', paths.plist],
    ['launchctl', 'bootstrap', 'gui/501', paths.plist],
  ]);
  assert.match(result.message, /^Scheduled daily at 08:00: saves the PDF and prints it on Brother\./);
  assert.match(result.message, /launchctl kickstart gui\/501\/com\.edition\.paper/);

  // Reinstalling swaps the runner in place and leaves no staging folders.
  const again = await installSchedule({
    options: install(home, ['--no-print']),
    platform: 'darwin',
    home,
    packageDir: PACKAGE_DIR,
    version: '1.0.0',
    nodePath: '/opt/homebrew/bin/node',
    uid: 501,
    exec,
    sleep: async () => {},
  });
  assert.equal(again.ok, true);
  assert.match(again.message, /saves the PDF only/);
  assert.deepEqual(readdirSync(paths.supportDir), ['paper']);
  assert.ok(readFileSync(paths.plist, 'utf8').includes('<string>--no-print</string>'));
});

test('macOS: retries one launchd hiccup, and cleans up if loading fails for good', async () => {
  const home = tempHome();
  const flaky = fakeLaunchctl({ failBootstrap: 1 });
  const base = { platform: 'darwin', home, packageDir: PACKAGE_DIR, version: '1.0.0', nodePath: '/usr/local/bin/node', uid: 501, sleep: async () => {} };
  const ok = await installSchedule({ ...base, options: install(home, []), exec: flaky.exec });
  assert.equal(ok.ok, true);
  assert.equal(flaky.calls.filter((c) => c[1] === 'bootstrap').length, 2);

  const broken = fakeLaunchctl({ failBootstrap: 2 });
  const failed = await installSchedule({ ...base, options: install(home, []), exec: broken.exec });
  assert.equal(failed.ok, false);
  assert.equal(failed.message, 'Could not load the schedule into launchd: Bootstrap failed: 5: Input/output error');
  assert.ok(!existsSync(schedulePaths(home).plist));
});

test('macOS: no browser means no schedule', async () => {
  const home = tempHome();
  await assert.rejects(
    installSchedule({
      options: install(home, []),
      platform: 'darwin',
      home,
      packageDir: PACKAGE_DIR,
      version: '1.0.0',
      nodePath: '/usr/local/bin/node',
      uid: 501,
      exec: () => assert.fail('must not touch launchd'),
      preflight: async () => {
        throw new BrowserMissingError('No browser to print with.');
      },
    }),
    BrowserMissingError
  );
  assert.deepEqual(readdirSync(home), []);
});

test('uninstall removes the agents and the runner, and keeps the PDFs', async () => {
  const home = tempHome();
  const { calls, exec } = fakeLaunchctl();
  const paths = schedulePaths(home);
  await installSchedule({ options: install(home, []), platform: 'darwin', home, packageDir: PACKAGE_DIR, version: '1.0.0', nodePath: '/usr/local/bin/node', uid: 501, exec });
  writeFileSync(paths.legacyPlist, '<plist/>');
  mkdirSync(join(home, 'Documents', 'Editions'), { recursive: true });
  writeFileSync(join(home, 'Documents', 'Editions', 'edition-2026-10-16.pdf'), '%PDF');

  const result = uninstallSchedule({ platform: 'darwin', home, uid: 501, exec });
  assert.equal(result.ok, true);
  assert.equal(result.message, '8am paper unscheduled. Your PDFs stay where they are.');
  assert.ok(!existsSync(paths.plist));
  assert.ok(!existsSync(paths.legacyPlist));
  assert.ok(!existsSync(paths.supportDir), 'the empty Edition folder goes too');
  assert.ok(existsSync(join(home, 'Documents', 'Editions', 'edition-2026-10-16.pdf')));
  assert.deepEqual(calls.slice(-2), [
    ['launchctl', 'bootout', 'gui/501', paths.plist],
    ['launchctl', 'bootout', 'gui/501', paths.legacyPlist],
  ]);

  const elsewhere = uninstallSchedule({ platform: 'linux', home, exec: () => assert.fail('no launchctl on Linux') });
  assert.equal(elsewhere.ok, true);
  assert.match(elsewhere.message, /cron line or a Task Scheduler task/);
});

test('node: a stable PATH link beats a versioned Homebrew Cellar path', () => {
  const links = {
    '/opt/homebrew/Cellar/node/24.1.0/bin/node': '/opt/homebrew/Cellar/node/24.1.0/bin/node',
    '/opt/homebrew/bin/node': '/opt/homebrew/Cellar/node/24.1.0/bin/node',
    '/usr/local/bin/node': '/usr/local/Cellar/node/18.0.0/bin/node',
  };
  const realpath = (path) => links[path];
  assert.equal(stableNodePath('/opt/homebrew/Cellar/node/24.1.0/bin/node', '/usr/local/bin:/opt/homebrew/bin:/usr/bin', realpath), '/opt/homebrew/bin/node');
  // nvm: no other name for it, so the binary itself.
  assert.equal(stableNodePath('/Users/ada/.nvm/versions/node/v24.13.0/bin/node', 'relative:/usr/bin', realpath), '/Users/ada/.nvm/versions/node/v24.13.0/bin/node');
});
