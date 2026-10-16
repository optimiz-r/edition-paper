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
        "Install Google Chrome, or run this once to fetch Playwright's Chromium (about 150 MB):",
        '  npx playwright@1.64.1 install chromium',
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

test('the hint names the installed playwright-core version', () => {
  assert.match(playwrightVersion(), /^\d+\.\d+\.\d+/);
  assert.equal(installHint(), `npx playwright@${playwrightVersion()} install chromium`);
});
