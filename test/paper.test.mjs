import assert from 'node:assert/strict';
import { test } from 'node:test';
import { printedImages } from '../lib/images.mjs';
import { countStories, isAnalytics, localDate, pdfPath, printPdf, READY_SELECTOR, renderPaper } from '../lib/paper.mjs';

test('the PDF is named for the local date', () => {
  const now = new Date(2026, 0, 5, 8, 0); // 5 January 2026, 08:00 local
  assert.equal(localDate(now), '2026-01-05');
  assert.equal(pdfPath('/Users/ada/Documents/Editions', now), '/Users/ada/Documents/Editions/edition-2026-01-05.pdf');
});

test("PostHog's servers are blocked; Edition's own files and the sources are not", () => {
  for (const url of ['https://eu.i.posthog.com/e/?ip=0', 'https://us.i.posthog.com/flags/', 'https://eu-assets.i.posthog.com/static/x.js', 'https://posthog.com/']) {
    assert.ok(isAnalytics(url), url);
    assert.ok(isAnalytics(new URL(url)), url);
  }
  for (const url of [
    'https://edition.cafe/paper?setup=W3s',
    // On a dev server the app's analytics module is a first-party file. Blocking
    // it stops the whole app from booting (seen with --url http://localhost).
    'http://localhost:5199/src/lib/posthog.ts',
    'https://edition.cafe/assets/posthog-js-Bx1.js',
    'https://edition.cafe/api/feed-proxy?url=https%3A%2F%2Fposthog.com%2Ffeed',
    'https://hacker-news.firebaseio.com/v0/topstories.json',
    'https://notposthog.com/',
  ]) {
    assert.ok(!isAnalytics(url), url);
  }
});

test('renderPaper: no service worker, analytics blocked, waits for the ready flag and the pictures, A4', async () => {
  const log = [];
  const page = {
    goto: async (url, options) => log.push(['goto', url, options.waitUntil]),
    waitForSelector: async (selector) => log.push(['wait', selector]),
    emulateMedia: async (options) => log.push(['media', options.media]),
    evaluate: async (fn) => (log.push(['pictures', fn === printedImages]), { loaded: 3, pending: [], broken: [] }),
    locator: (selector) => ({
      count: async () => (log.push(['count', selector]), 1),
      locator: (inner) => ({ count: async () => (log.push(['count', `${selector} ${inner}`]), 41) }),
    }),
    pdf: async (options) => log.push(['pdf', options]),
  };
  const context = {
    route: async (matcher, handler) => {
      let aborted = false;
      await handler({ abort: async () => (aborted = true) });
      log.push(['route', matcher === isAnalytics, aborted]);
    },
    newPage: async () => page,
  };
  const browser = {
    newContext: async (options) => (log.push(['context', options]), context),
    close: async () => log.push(['close']),
  };
  const result = await renderPaper({
    url: 'https://edition.cafe/paper?setup=W3s',
    outFile: '/tmp/edition.pdf',
    browser: 'auto',
    launch: async () => ({ browser, kind: 'chrome' }),
  });
  assert.deepEqual(result, { stories: 41, browser: 'chrome' });
  assert.deepEqual(log, [
    ['context', { serviceWorkers: 'block' }],
    ['route', true, true],
    ['goto', 'https://edition.cafe/paper?setup=W3s', 'domcontentloaded'],
    ['wait', READY_SELECTOR],
    ['media', 'print'],
    ['pictures', true],
    ['count', '.print-columns'],
    ['count', '.print-columns .story, .plate'],
    ['pdf', { path: '/tmp/edition.pdf', format: 'A4', printBackground: false }],
    ['close'],
  ]);
});

test('renderPaper: an unreachable site is one sentence, and the browser still closes', async () => {
  let closed = false;
  const browser = {
    newContext: async () => ({
      route: async () => {},
      newPage: async () => ({
        goto: async () => {
          throw new Error('page.goto: net::ERR_NAME_NOT_RESOLVED at https://edition.cafe/paper\nCall log: …');
        },
      }),
    }),
    close: async () => (closed = true),
  };
  await assert.rejects(
    renderPaper({ url: 'https://edition.cafe/paper?setup=W3s', outFile: '/tmp/x.pdf', browser: 'auto', launch: async () => ({ browser, kind: 'chrome' }) }),
    { message: 'Could not reach https://edition.cafe (page.goto: net::ERR_NAME_NOT_RESOLVED at https://edition.cafe/paper). Is the site up?' }
  );
  assert.ok(closed);
});

test('printPdf: lpr, -P for a named printer, the PDF path on failure', () => {
  const calls = [];
  const ok = printPdf({ file: '/p/e.pdf', printer: 'My Printer', platform: 'darwin', exec: (cmd, args) => calls.push([cmd, ...args]) });
  assert.deepEqual(ok, { ok: true, message: 'Sent to My Printer. Enjoy the paper.' });
  printPdf({ file: '/p/e.pdf', platform: 'linux', exec: (cmd, args) => calls.push([cmd, ...args]) });
  assert.deepEqual(calls, [
    ['lpr', '-P', 'My Printer', '/p/e.pdf'],
    ['lpr', '/p/e.pdf'],
  ]);
  const failed = printPdf({ file: '/p/e.pdf', platform: 'darwin', exec: () => { throw new Error('lpr: No default destination'); } });
  assert.equal(failed.ok, false);
  assert.match(failed.message, /The PDF is at \/p\/e\.pdf\.$/);
  const windows = printPdf({ file: 'C:\\e.pdf', platform: 'win32', exec: () => assert.fail('no lpr on Windows') });
  assert.equal(windows.unsupported, true);
});

test('countStories counts the printed copy, not the screen copy too', async () => {
  const page = (printColumns) => ({
    locator: (selector) => ({
      count: async () => (selector === '.print-columns' ? printColumns : 54),
      locator: () => ({ count: async () => 27 }),
    }),
  });
  assert.equal(await countStories(page(1)), 27);
  // If the app drops .print-columns, fall back to every story rather than 0.
  assert.equal(await countStories(page(0)), 54);
  assert.equal(await countStories({ locator: () => ({ count: async () => { throw new Error('closed'); } }) }), 0);
});
