import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BrowserMissingError, installHint, launchBrowser, playwrightVersion } from '../lib/browser.mjs';

const fakeChromium = (available) => {
  const attempts = [];
  return {
    attempts,
    launch: async (options) => {
      const kind = options.channel ?? 'chromium';
      attempts.push(kind);
      if (!available.includes(kind)) {
        throw new Error(
          kind === 'chrome'
            ? "browserType.launch: Chromium distribution 'chrome' is not found at /opt/google/chrome/chrome\nRun \"npx playwright install chrome\""
            : 'browserType.launch: Executable doesn\'t exist at /home/ada/.cache/ms-playwright/chromium_headless_shell-1234/chrome\n╔══ banner ══╗'
        );
      }
      return { kind };
    },
  };
};

test("auto prefers the reader's Google Chrome", async () => {
  const chromium = fakeChromium(['chrome', 'chromium']);
  const { kind } = await launchBrowser('auto', { chromium });
  assert.equal(kind, 'chrome');
  assert.deepEqual(chromium.attempts, ['chrome']);
});

test("auto falls back to Playwright's Chromium", async () => {
  const chromium = fakeChromium(['chromium']);
  const { kind } = await launchBrowser('auto', { chromium });
  assert.equal(kind, 'chromium');
  assert.deepEqual(chromium.attempts, ['chrome', 'chromium']);
});

test('with neither, one instruction pinned to the Playwright version in use', async () => {
  const chromium = fakeChromium([]);
  await assert.rejects(launchBrowser('auto', { chromium, version: '1.64.1' }), (error) => {
    assert.ok(error instanceof BrowserMissingError);
    assert.equal(
      error.message,
      [
        'No browser to print with.',
        "  Google Chrome: Chromium distribution 'chrome' is not found at /opt/google/chrome/chrome",
        "  Playwright's Chromium: Executable doesn't exist at /home/ada/.cache/ms-playwright/chromium_headless_shell-1234/chrome",
        "Install Google Chrome, or run this once to fetch Playwright's Chromium (headless shell):",
        '  npx playwright@1.64.1 install chromium --only-shell',
      ].join('\n')
    );
    return true;
  });
});

test('--browser chrome tries only Chrome and says so', async () => {
  const chromium = fakeChromium(['chromium']);
  await assert.rejects(launchBrowser('chrome', { chromium }), /Install Google Chrome \(google\.com\/chrome\), or drop --browser chrome\./);
  assert.deepEqual(chromium.attempts, ['chrome']);
});

test('--browser chromium skips Chrome', async () => {
  const chromium = fakeChromium(['chrome', 'chromium']);
  assert.equal((await launchBrowser('chromium', { chromium })).kind, 'chromium');
  assert.deepEqual(chromium.attempts, ['chromium']);
});

test('a missing explicit Chromium gives a remedy for that browser', async () => {
  const chromium = fakeChromium([]);
  await assert.rejects(launchBrowser('chromium', { chromium, version: '1.64.1' }), (error) => {
    assert.match(error.message, /npx playwright@1\.64\.1 install chromium --only-shell/);
    assert.doesNotMatch(error.message, /Install Google Chrome/);
    return true;
  });
});

test('new Chromium failure paths keep private URLs out of the diagnostic', async () => {
  const failure = new Error('browserType.launch: failed at https://user:placeholder@example.com/path?key=synthetic\nCall log: hidden');
  const chromium = { launch: async () => { throw failure; } };
  await assert.rejects(launchBrowser('chromium', {
    chromium,
    systemExecutable: '/fixture/chromium',
    install: async () => { throw failure; },
  }), (error) => {
    assert.match(error.message, /System Chromium: failed at https:\/\/example\.com\/path/);
    assert.match(error.message, /Chromium after installation: failed at https:\/\/example\.com\/path/);
    assert.doesNotMatch(error.message, /placeholder|synthetic|Call log/);
    return true;
  });
});

test('opt-in installation retries Chromium only after launch fails', async () => {
  const attempts = [];
  let installed = false;
  const chromium = {
    launch: async (options) => {
      const kind = options.channel ?? 'chromium';
      attempts.push(kind);
      if (kind === 'chrome' || !installed) throw new Error('Unavailable');
      return {};
    },
  };
  const install = async () => {
    attempts.push('install');
    installed = true;
  };
  await assert.rejects(launchBrowser('chrome', { chromium, install }), BrowserMissingError);
  assert.equal((await launchBrowser('auto', { chromium, install })).kind, 'chromium');
  assert.equal((await launchBrowser('auto', { chromium, install })).kind, 'chromium');
  assert.deepEqual(attempts, ['chrome', 'chrome', 'chromium', 'install', 'chromium', 'chrome', 'chromium']);
});

test('an absolute system Chromium opt-in uses a sandbox and falls back to the managed browser', async () => {
  const calls = [];
  const systemExecutable = process.platform === 'win32' ? 'C:\\Trusted\\chrome.exe' : '/usr/bin/chromium';
  const chromium = {
    launch: async (options) => {
      calls.push(options);
      if (options.channel || options.executablePath) throw new Error('Unavailable');
      return {};
    },
  };
  assert.equal((await launchBrowser('auto', { chromium, systemExecutable })).kind, 'chromium');
  assert.deepEqual(calls, [
    { channel: 'chrome' },
    { executablePath: systemExecutable, chromiumSandbox: true },
    {},
  ]);
});

test('the hint names the installed playwright-core version', () => {
  assert.match(playwrightVersion(), /^\d+\.\d+\.\d+/);
  assert.equal(installHint(), `npx playwright@${playwrightVersion()} install chromium --only-shell`);
});
