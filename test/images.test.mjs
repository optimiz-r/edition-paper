import assert from 'node:assert/strict';
import { test } from 'node:test';
import { IMAGES_TIMEOUT_MS, printedImages, waitForImages } from '../lib/images.mjs';
import { renderPaper } from '../lib/paper.mjs';

/** Just enough of an <img> for printedImages. */
const img = ({ src = 'https://design-milk.com/lead.jpg', loading = 'auto', complete = true, naturalWidth = complete ? 896 : 0, visible = true } = {}) => ({
  localName: 'img',
  loading,
  complete,
  naturalWidth,
  src: src ?? '',
  currentSrc: complete && naturalWidth > 0 ? src : '',
  getAttribute: (name) => (name === 'src' ? src : null),
  checkVisibility: () => visible,
});
const el = (children = [], shadowChildren) => ({ localName: 'div', children, shadowRoot: shadowChildren ? root(shadowChildren) : null });
// querySelectorAll('*') is every descendant, but stops at shadow roots.
function root(children) {
  return {
    querySelectorAll: () => {
      const all = [];
      const walk = (nodes) => nodes.forEach((node) => (all.push(node), walk(node.children ?? [])));
      walk(children);
      return all;
    },
  };
}

test('finds the printed pictures inside nested shadow roots, and wakes the lazy ones', () => {
  const lazy = img({ src: 'https://design-milk.com/a.jpg', loading: 'lazy', complete: false });
  const page = root([
    el([], [el([], [lazy, img({ src: 'https://design-milk.com/b.jpg' })])]),
    img({ src: 'https://cdn.example/broken.png', naturalWidth: 0 }),
    // Another route's icon, or the screen copy: not on paper.
    img({ src: '/images/channels/rss.svg', loading: 'lazy', complete: false, visible: false }),
    img({ src: null }),
  ]);
  assert.deepEqual(printedImages(page), {
    loaded: 1,
    pending: ['https://design-milk.com/a.jpg'],
    broken: ['https://cdn.example/broken.png'],
  });
  // A PDF never scrolls a lazy picture into view.
  assert.equal(lazy.loading, 'eager');
});

test('printedImages works on its own, the way page.evaluate sends it', () => {
  // Playwright sends the function's source: anything it closed over in this
  // module would be undefined in the page.
  const sent = new Function(`return (${printedImages.toString()})`)();
  assert.deepEqual(sent(root([img()])), { loaded: 1, pending: [], broken: [] });
});

const fakePage = (statuses) => {
  let looks = 0;
  return {
    looks: () => looks,
    evaluate: async (fn) => {
      assert.equal(fn, printedImages);
      return statuses[Math.min(looks++, statuses.length - 1)];
    },
  };
};
const clock = () => {
  let t = 0;
  return { now: () => t, sleep: async (ms) => void (t += ms) };
};

test('waits for the last picture, then says nothing', async () => {
  const warnings = [];
  const pending = { loaded: 1, pending: ['https://design-milk.com/a.jpg'], broken: [] };
  const page = fakePage([pending, pending, { loaded: 2, pending: [], broken: [] }]);
  assert.deepEqual(await waitForImages(page, { warn: (m) => warnings.push(m), ...clock() }), { loaded: 2, pending: [], broken: [] });
  assert.equal(page.looks(), 3);
  assert.deepEqual(warnings, []);
});

test('gives up after 20 seconds and names every picture that never loaded', async () => {
  const warnings = [];
  const time = clock();
  const page = fakePage([{ loaded: 4, pending: ['https://dead.example/photo.jpg'], broken: ['https://cdn.example/404.png'] }]);
  await waitForImages(page, { warn: (m) => warnings.push(m), ...time });
  assert.equal(IMAGES_TIMEOUT_MS, 20_000);
  assert.equal(time.now(), IMAGES_TIMEOUT_MS);
  assert.deepEqual(warnings, [
    'Printing without 2 pictures that never loaded: https://dead.example/photo.jpg (still loading after 20s), https://cdn.example/404.png (failed to load)',
  ]);
});

test('a data: URL is cut short in the log', async () => {
  const warnings = [];
  await waitForImages(fakePage([{ loaded: 0, pending: [], broken: [`data:image/png;base64,${'A'.repeat(5000)}`] }]), {
    warn: (m) => warnings.push(m),
    ...clock(),
  });
  assert.match(warnings[0], /^Printing without 1 picture that never loaded: data:image\/png;base64,A+\.\.\. \(failed to load\)$/);
  assert.ok(warnings[0].length < 200);
});

test("a page that can't be asked still gets printed", async () => {
  const warnings = [];
  const page = { evaluate: async () => Promise.reject(new Error('page.evaluate: Execution context was destroyed\nCall log: …')) };
  assert.equal(await waitForImages(page, { warn: (m) => warnings.push(m), ...clock() }), null);
  assert.deepEqual(warnings, ["Could not check the paper's pictures (page.evaluate: Execution context was destroyed); printing anyway."]);
});

test('renderPaper prints after the pictures, and says which never came', async () => {
  const log = [];
  const warnings = [];
  let looks = 0;
  const page = {
    goto: async () => {},
    waitForSelector: async () => {},
    emulateMedia: async ({ media }) => log.push(`media ${media}`),
    // The lead arrives on the second look; the thumb's host is down.
    evaluate: async () => {
      looks += 1;
      log.push('look');
      return looks === 1
        ? { loaded: 0, pending: ['https://design-milk.com/lead.jpg'], broken: ['https://dead.example/thumb.jpg'] }
        : { loaded: 1, pending: [], broken: ['https://dead.example/thumb.jpg'] };
    },
    locator: () => ({ count: async () => 0, locator: () => ({ count: async () => 0 }) }),
    pdf: async () => log.push('pdf'),
  };
  const browser = {
    newContext: async () => ({ route: async () => {}, newPage: async () => page }),
    close: async () => {},
  };
  await renderPaper({
    url: 'https://edition.cafe/paper?setup=W3s',
    outFile: '/tmp/edition.pdf',
    browser: 'auto',
    warn: (m) => warnings.push(m),
    launch: async () => ({ browser, kind: 'chrome' }),
  });
  assert.deepEqual(log, ['media print', 'look', 'look', 'pdf']);
  assert.deepEqual(warnings, ['Printing without 1 picture that never loaded: https://dead.example/thumb.jpg (failed to load)']);
});
