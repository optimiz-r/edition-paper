import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseCliArgs, scheduledArgs, UsageError } from '../lib/args.mjs';
import { MAX_SETUP_LENGTH, paperUrl, readSetup } from '../lib/setup.mjs';

// Exactly what "Copy 8am command" put on the clipboard on live
// edition.cafe/paper, 2026-10-16 (GitHub hidden; Hacker News, Product Hunt,
// Design Milk).
const COPIED = readFileSync(new URL('./fixtures/copied-command.txt', import.meta.url), 'utf8');
const LIVE_SETUP = COPIED.slice(COPIED.indexOf('--setup ') + '--setup '.length);

// Same steps as encodeSetup in the app's src/lib/edition.ts.
const encodeLikeTheApp = (channels) => Buffer.from(JSON.stringify(channels), 'utf8').toString('base64url');

test('the copied command is npm run paper -- --setup <param>', () => {
  assert.match(COPIED, /^npm run paper -- --setup [A-Za-z0-9_-]+$/);
});

test('the live parameter is accepted and passed through untouched', () => {
  assert.deepEqual(readSetup(LIVE_SETUP), { setup: LIVE_SETUP, sources: 3 });
  const options = parseCliArgs(['--setup', LIVE_SETUP], { home: '/h', cwd: '/h' });
  assert.equal(options.setup, LIVE_SETUP);

  const url = paperUrl(options.url, options.setup);
  assert.equal(url, `https://edition.cafe/paper?setup=${LIVE_SETUP}`);
  assert.equal(new URL(url).searchParams.get('setup'), LIVE_SETUP);

  // And into the schedule, as one argument, byte for byte.
  assert.deepEqual(scheduledArgs(options).slice(0, 2), ['--setup', LIVE_SETUP]);
});

test('paperUrl does not double the slash after a custom origin', () => {
  assert.equal(paperUrl('http://localhost:5199/', 'W3t9XQ'), 'http://localhost:5199/paper?setup=W3t9XQ');
});

test('anything the app can encode passes, including non-ASCII names', () => {
  const setup = encodeLikeTheApp([
    { id: 'rss-1', name: 'Café ☕ 新聞', type: 'rss', config: { url: 'https://example.com/feed.xml' } },
    { id: 'reddit-1', name: 'r/printing', type: 'reddit', config: { subreddit: 'printing' } },
  ]);
  assert.deepEqual(readSetup(setup), { setup, sources: 2 });
  // Unpadded base64url can end on any length but 4n+1; all of them pass.
  for (let n = 1; n <= 8; n++) {
    const padded = encodeLikeTheApp([{ id: 'x'.repeat(n) }]);
    assert.equal(readSetup(padded).setup, padded);
  }
});

test('a mangled paste fails here, in words, not as an empty paper', () => {
  const bad = [
    '',
    `${LIVE_SETUP}=`, // padding: the app never pads
    `${LIVE_SETUP.slice(0, 8)}+/${LIVE_SETUP.slice(10)}`, // standard base64
    `${LIVE_SETUP.slice(0, 13)}`, // 4n+1 characters
    `'${LIVE_SETUP}'`,
    encodeLikeTheApp({ id: 'x' }), // not a list
    encodeLikeTheApp([]),
    Buffer.from('not json').toString('base64url'),
    Buffer.from([0xff, 0xfe, 0xfd]).toString('base64url'), // not UTF-8
    'A'.repeat(MAX_SETUP_LENGTH + 4),
  ];
  for (const value of bad) {
    assert.throws(() => readSetup(value), (error) => error instanceof UsageError && /not one Edition made/.test(error.message), value.slice(0, 20));
  }
});
