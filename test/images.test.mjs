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
  assert.deepEqual(printedImages(undefined, page), {
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
  assert.deepEqual(sent(undefined, root([img()])), { loaded: 1, pending: [], broken: [] });
});

const fakePage = (status) => ({
  evaluate: async (fn, wait) => {
    assert.equal(fn, printedImages);
    assert.equal(wait.timeout, IMAGES_TIMEOUT_MS);
    return status;
  },
});

test('waits for the last picture, then says nothing', async () => {
  const warnings = [];
  const lead = Object.assign(new EventTarget(), img({ complete: false }));
  const page = { evaluate: (fn, wait) => fn(wait, root([lead, img()])) };
  const ready = waitForImages(page, { warn: (m) => warnings.push(m) });
  lead.complete = true;
  lead.naturalWidth = 896;
  lead.dispatchEvent(new Event('load'));
  assert.deepEqual(await ready, { loaded: 2, pending: [], broken: [] });
  assert.deepEqual(warnings, []);
});

test('rescans after pending pictures are removed without a load event', async () => {
  const pending = Object.assign(new EventTarget(), img({ complete: false }));
  const children = [pending];
  const ready = printedImages({ timeout: 1000, interval: 1 }, root(children));
  children.pop();
  assert.deepEqual(await ready, { loaded: 0, pending: [], broken: [] });
});

test('the observer returns unresolved pictures at its deadline', async () => {
  const lead = Object.assign(new EventTarget(), img({ complete: false }));
  const result = await printedImages({ timeout: 5, interval: 250 }, root([lead]));
  assert.deepEqual(result, { loaded: 0, pending: [lead.src], broken: [] });
});

test('gives up after 20 seconds and names every picture that never loaded', async () => {
  const warnings = [];
  const page = fakePage({ loaded: 4, pending: ['https://dead.example/photo.jpg'], broken: ['https://cdn.example/404.png'] });
  await waitForImages(page, { warn: (m) => warnings.push(m) });
  assert.equal(IMAGES_TIMEOUT_MS, 20_000);
  assert.deepEqual(warnings, [
    'Printing without 2 pictures that never loaded: https://dead.example/photo.jpg (still loading after 20s), https://cdn.example/404.png (failed to load)',
  ]);
});

test('a data: URL is cut short in the log', async () => {
  const warnings = [];
  await waitForImages(fakePage({ loaded: 0, pending: [], broken: [`data:image/png;base64,${'A'.repeat(5000)}`] }), {
    warn: (m) => warnings.push(m),
  });
  assert.match(warnings[0], /^Printing without 1 picture that never loaded: data:image\/png;base64,A+\.\.\. \(failed to load\)$/);
  assert.ok(warnings[0].length < 200);
});

test("a page that can't be asked still gets printed", async () => {
  const warnings = [];
  const page = { evaluate: async () => Promise.reject(new Error('page.evaluate: Execution context was destroyed\nCall log: …')) };
  assert.equal(await waitForImages(page, { warn: (m) => warnings.push(m) }), null);
  assert.deepEqual(warnings, ["Could not check the paper's pictures (page.evaluate: Execution context was destroyed); printing anyway."]);
});

test('renderPaper prints after the pictures, and says which never came', async () => {
  const log = [];
  const warnings = [];
  const page = {
    goto: async () => {},
    waitForSelector: async () => {},
    emulateMedia: async ({ media }) => log.push(`media ${media}`),
    evaluate: async () => {
      log.push('look');
      return { loaded: 1, pending: [], broken: ['https://dead.example/thumb.jpg'] };
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
  assert.deepEqual(log, ['media print', 'look', 'pdf']);
  assert.deepEqual(warnings, ['Printing without 1 picture that never loaded: https://dead.example/thumb.jpg (failed to load)']);
});
