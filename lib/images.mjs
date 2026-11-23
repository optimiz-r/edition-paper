// The paper's pictures, waited for before page.pdf. The page's ready flag says
// the edition is composed; a picture can still be on its way, and one that
// hasn't arrived prints as an empty frame (Design Milk's lead photo, seen
// 2026-10-16). The app's own scripts/paper-images.mjs does the same.

/** How long the pictures get, all together, once the page says it's ready. */
export const IMAGES_TIMEOUT_MS = 20_000;
const POLL_MS = 250;

/**
 * Runs in the page (page.evaluate sends its source, so it must stay
 * self-contained). Finds every <img> in the document, in every shadow root
 * too since the app is Lit components, keeps the ones the printed page shows,
 * and says which have arrived. Call it with print media emulated, or the
 * screen copy's pictures count and the printed copy's don't.
 *
 * A lazy picture waits to be scrolled near, and a PDF never scrolls: it is
 * told to load now. An edition from before the app loaded its printed
 * pictures eagerly has only lazy ones.
 */
export function printedImages(wait, root = document) {
  const scan = () => {
    const status = { loaded: 0, pending: [], broken: [] };
    const unfinished = [];
    const walk = (node) => {
      for (const element of node.querySelectorAll('*')) {
        if (element.localName === 'img') inspect(element);
        if (element.shadowRoot) walk(element.shadowRoot);
      }
    };
    const inspect = (img) => {
      if (typeof img.checkVisibility === 'function' && !img.checkVisibility()) return;
      if (!img.getAttribute('src') && !img.getAttribute('srcset')) return;
      if (img.loading === 'lazy') img.loading = 'eager';
      const name = img.currentSrc || img.src || img.getAttribute('srcset');
      if (!img.complete) {
        unfinished.push(img);
        status.pending.push(name);
      } else if (img.naturalWidth > 0) status.loaded += 1;
      else status.broken.push(name);
    };
    walk(root);
    return { status, unfinished };
  };
  if (!wait) return scan().status;

  // Wake promptly when the last pending image fires load/error. Keep polling
  // as well, since scripts can replace images or change which ones print.
  const deadline = performance.now() + wait.timeout;
  return new Promise((resolve, reject) => {
    const listeners = new AbortController();
    const seen = new WeakSet();
    let waiting;
    let timer;
    const settled = ({ currentTarget }) => {
      if (waiting.delete(currentTarget) && waiting.size === 0) check();
    };
    const check = () => {
      clearTimeout(timer);
      try {
        const { status, unfinished } = scan();
        const remaining = deadline - performance.now();
        if (unfinished.length === 0 || remaining <= 0) {
          listeners.abort();
          resolve(status);
          return;
        }
        waiting = new Set(unfinished);
        for (const img of unfinished) {
          if (seen.has(img)) continue;
          seen.add(img);
          img.addEventListener('load', settled, { signal: listeners.signal });
          img.addEventListener('error', settled, { signal: listeners.signal });
        }
        timer = setTimeout(check, Math.min(remaining, wait.interval));
      } catch (error) {
        listeners.abort();
        reject(error);
      }
    };
    check();
  });
}

const shorten = (url) => (url.length > 120 ? `${url.slice(0, 117)}...` : url);

/**
 * Waits until every printed picture has loaded or failed, or `timeout` runs
 * out, then names any that never loaded in one warning. Never throws: the
 * paper prints either way, and a missing picture is no reason to lose it.
 * Resolves to the last status, or null if the page couldn't be asked.
 */
export async function waitForImages(
  page,
  {
    timeout = IMAGES_TIMEOUT_MS,
    interval = POLL_MS,
    warn = console.warn,
  } = {}
) {
  let status;
  try {
    status = await page.evaluate(printedImages, { timeout, interval });
  } catch (error) {
    const reason = String(error instanceof Error ? error.message : error).split('\n')[0];
    warn(`Could not check the paper's pictures (${reason}); printing anyway.`);
    return null;
  }
  const missing = [
    ...status.pending.map((url) => `${shorten(url)} (still loading after ${timeout / 1000}s)`),
    ...status.broken.map((url) => `${shorten(url)} (failed to load)`),
  ];
  if (missing.length > 0) {
    warn(`Printing without ${missing.length} picture${missing.length === 1 ? '' : 's'} that never loaded: ${missing.join(', ')}`);
  }
  return status;
}
