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
  const { loaded, pending, broken } = printedImages(undefined, page);
  assert.deepEqual({ loaded, pending, broken }, {
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
  assert.deepEqual(sent(undefined, root([img()])), {
    loaded: 1, pending: [], broken: [], sources: [[img().src, img().src, null]], fontsReady: true,
  });
});

const snapshot = (status) => ({ sources: [], fontsReady: true, ...status });
const fakePage = (status) => ({
  evaluate: async (fn, frame) => {
    assert.equal(fn, printedImages);
    assert.equal(frame, true);
    return snapshot(status);
  },
});

test('waits for a complete scan and two matching frames while requests settle', async () => {
  const warnings = [];
  const lead = img({ complete: false });
  let scans = 0;
  const page = {
    evaluate: (fn) => {
      if (++scans === 2) {
        lead.complete = true;
        lead.naturalWidth = 896;
        lead.currentSrc = lead.src;
      }
      return fn(false, root([lead, img()]));
    },
  };
  const { loaded, pending, broken } = await waitForImages(page, {
    networkQuiet: () => scans > 2,
    warn: (m) => warnings.push(m),
  });
  assert.deepEqual({ loaded, pending, broken }, { loaded: 2, pending: [], broken: [] });
  assert.deepEqual(warnings, []);
});

test('the deadline also bounds a browser frame that never arrives', async () => {
  const warnings = [];
  const page = { evaluate: () => new Promise(() => {}) };
  assert.equal(await waitForImages(page, { timeout: 5, warn: (message) => warnings.push(message) }), null);
  assert.deepEqual(warnings, ["The paper's resources were still loading after 0.005s; printing what settled."]);
});

test('gives up after 20 seconds and names every picture that never loaded', async () => {
  const warnings = [];
  const page = fakePage({ loaded: 4, pending: ['https://dead.example/photo.jpg'], broken: ['https://cdn.example/404.png'] });
  await waitForImages(page, { timeout: 5, warn: (m) => warnings.push(m) });
  assert.equal(IMAGES_TIMEOUT_MS, 20_000);
  assert.deepEqual(warnings, [
    'Printing without 2 pictures that never loaded: https://dead.example/photo.jpg (still loading after 0.005s), https://cdn.example/404.png (failed to load)',
  ]);
});

test('an inline image is named without including its contents', async () => {
  const warnings = [];
  await waitForImages(fakePage({ loaded: 0, pending: [], broken: [`data:image/png;base64,${'A'.repeat(5000)}`] }), {
    warn: (m) => warnings.push(m),
  });
  assert.deepEqual(warnings, ['Printing without 1 picture that never loaded: inline image (failed to load)']);
});

test('picture warnings name the image without logging its HTTP credentials or query', async () => {
  const warnings = [];
  await waitForImages(fakePage({
    loaded: 0, pending: [], broken: ['https://example:placeholder@cdn.example/photo.jpg?signature=synthetic'],
  }), { warn: (message) => warnings.push(message) });
  assert.deepEqual(warnings, ['Printing without 1 picture that never loaded: https://cdn.example/photo.jpg (failed to load)']);
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
    on() {},
    goto: async () => {},
    waitForSelector: async () => {},
    emulateMedia: async ({ media }) => log.push(`media ${media}`),
    evaluate: async () => {
      if (!log.includes('look')) log.push('look');
      return snapshot({ loaded: 1, pending: [], broken: ['https://dead.example/thumb.jpg'] });
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
