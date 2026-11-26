import { setTimeout as sleep } from 'node:timers/promises';
import { diagnosticLine, httpUrlForLog } from './errors.mjs';

/** How long the paper's resources get after it says it is composed. */
export const IMAGES_TIMEOUT_MS = 20_000;
const QUIET_MS = 500;
const POLL_MS = 50;

/** Requests made after print media is enabled count even if navigation has already gone idle. */
export function trackPaperRequests(page) {
  const pending = new Set();
  let activity = performance.now();
  page.on('request', (request) => {
    if (['eventsource', 'websocket'].includes(request.resourceType())) return;
    pending.add(request);
    activity = performance.now();
  });
  const finish = (request) => {
    if (pending.delete(request)) activity = performance.now();
  };
  page.on('requestfinished', finish);
  page.on('requestfailed', finish);
  return (since) => pending.size === 0 && performance.now() - Math.max(since, activity) >= QUIET_MS;
}

/**
 * Runs in the page. Scan after a frame so responsive image selections and
 * print-only fonts reflect the current layout. A PDF never scrolls, so ask
 * visible lazy images to load now, including those inside shadow roots.
 */
export function printedImages(onFrame, root = document) {
  const scan = () => {
    const status = { loaded: 0, pending: [], broken: [], sources: [], fontsReady: root.fonts?.status !== 'loading' };
    const walk = (node) => {
      for (const img of node.querySelectorAll('*')) {
        if (img.shadowRoot) walk(img.shadowRoot);
        if (img.localName !== 'img') continue;
        if (typeof img.checkVisibility === 'function' && !img.checkVisibility()) continue;
        const src = img.getAttribute('src');
        const srcset = img.getAttribute('srcset');
        if (!src && !srcset) continue;
        if (img.loading === 'lazy') img.loading = 'eager';
        status.sources.push([img.currentSrc, src, srcset]);
        const name = img.currentSrc || img.src || 'srcset image';
        if (!img.complete) status.pending.push(name);
        else if (img.naturalWidth > 0) status.loaded += 1;
        else status.broken.push(name);
      }
    };
    walk(root);
    return status;
  };
  if (!onFrame) return scan();
  return new Promise((resolve, reject) => requestAnimationFrame(() => {
    try {
      resolve(scan());
    } catch (error) {
      reject(error);
    }
  }));
}

const imageName = (value) => {
  if (/^data:/i.test(value)) return 'inline image';
  const url = httpUrlForLog(value);
  return url.length > 120 ? `${url.slice(0, 117)}...` : url;
};

/** Wait for a stable print layout and a quiet network, within the existing resource budget. */
export async function waitForImages(
  page,
  {
    timeout = IMAGES_TIMEOUT_MS,
    networkQuiet = () => true,
    warn = console.warn,
  } = {}
) {
  const started = performance.now();
  const deadline = started + timeout;
  const expired = Symbol('resource deadline');
  let timer;
  const limit = new Promise((resolve) => {
    timer = setTimeout(() => resolve(expired), timeout);
  });
  let last;
  let stableSince = started;
  let status = null;
  let settled = false;
  try {
    while (true) {
      const current = await Promise.race([page.evaluate(printedImages, true), limit]);
      if (current === expired) break;
      status = current;
      const now = performance.now();
      const state = JSON.stringify(status);
      if (state !== last) {
        stableSince = now;
        last = state;
      } else if (status.pending.length === 0 && status.fontsReady &&
        now - stableSince >= QUIET_MS && networkQuiet(started)) {
        settled = true;
        break;
      }
      const remaining = deadline - now;
      if (remaining <= 0) break;
      await sleep(Math.min(POLL_MS, remaining));
    }
  } catch (error) {
    const reason = diagnosticLine(error);
    warn(`Could not check the paper's pictures (${reason}); printing anyway.`);
    return null;
  } finally {
    clearTimeout(timer);
  }

  if (!status) {
    warn(`The paper's resources were still loading after ${timeout / 1000}s; printing what settled.`);
    return null;
  }
  const missing = [
    ...status.pending.map((url) => `${imageName(url)} (still loading after ${timeout / 1000}s)`),
    ...status.broken.map((url) => `${imageName(url)} (failed to load)`),
  ];
  if (missing.length > 0) {
    warn(`Printing without ${missing.length} picture${missing.length === 1 ? '' : 's'} that never loaded: ${missing.join(', ')}`);
  }
  if (!settled && status.pending.length === 0) {
    warn(`The paper's resources were still loading after ${timeout / 1000}s; printing what settled.`);
  }
  return status;
}
