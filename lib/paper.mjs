import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { launchBrowser } from './browser.mjs';
import { diagnosticLine } from './errors.mjs';
import { trackPaperRequests, waitForImages } from './images.mjs';

export const READY_SELECTOR = 'html[data-edition-ready="true"]';
export const NAVIGATION_TIMEOUT_MS = 60_000;
export const READY_TIMEOUT_MS = 90_000;

// PostHog's servers. The app already skips analytics in driven browsers
// (navigator.webdriver); this keeps a CLI run from ever counting as a reader
// even if that check changes. Match the host, never a path: the app's own
// first-party posthog module (src/lib/posthog.ts on a dev server) must load,
// or the whole page fails to boot.
export const isAnalytics = (url) => {
  const host = (url instanceof URL ? url : new URL(url)).hostname.toLowerCase();
  return host === 'posthog.com' || host.endsWith('.posthog.com');
};

/** Local calendar date, so an 8am run in Tokyo is named for today, not yesterday in UTC. */
export function localDate(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export const pdfPath = (outDir, now = new Date()) => join(outDir, `edition-${localDate(now)}.pdf`);

// Mobbin sections print as .plate contact sheets, not .story rows. /paper
// renders every story twice, once for the screen and once in .print-columns
// for paper; count the printed copy, or everything if that ever goes away.
export const STORIES = '.story, .plate';
export const PRINTED = '.print-columns';

export async function countStories(page) {
  try {
    const printed = page.locator(PRINTED);
    if ((await printed.count()) > 0) return await printed.locator(STORIES).count();
    return await page.locator(STORIES).count();
  } catch {
    return 0;
  }
}

/**
 * Loads /paper with the setup, waits for the page to say the edition is
 * composed and for its printed pictures to arrive, and saves it as an A4
 * PDF. Returns the story count, browser, and HTTP status for error responses.
 * Throws with a reader-facing message
 * when the page can't be reached.
 */
export async function renderPaper({ url, outFile, browser: choice, warn = console.warn, launch = launchBrowser }) {
  const { browser, kind } = await launch(choice);
  try {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    await context.route(isAnalytics, (route) => route.abort());
    const page = await context.newPage();
    const networkQuiet = trackPaperRequests(page);
    let response;
    try {
      response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT_MS });
    } catch (error) {
      // Playwright includes the navigation URL in its error. The query holds
      // the reader's encoded sources and should never go into a schedule log.
      const reason = diagnosticLine(error);
      throw new Error(`Could not reach ${new URL(url).origin} (${reason}). Is the site up?`);
    }
    try {
      // Check the marker each animation frame while the app composes. A
      // selector wait alone can back off for half a second between checks.
      const deadline = performance.now() + READY_TIMEOUT_MS;
      try {
        const marker = await page.waitForFunction(
          (selector) => document.documentElement?.matches(selector),
          READY_SELECTOR,
          { timeout: READY_TIMEOUT_MS },
        );
        await marker.dispose();
      } catch {
        // The original selector wait handles a failed probe or its timeout.
      }
      // Keep Playwright's original visibility check under the same deadline.
      await page.waitForSelector(READY_SELECTOR, { timeout: Math.max(1, deadline - performance.now()) });
    } catch (error) {
      if (error?.name !== 'TimeoutError') throw error;
      warn(`The page was still composing after ${READY_TIMEOUT_MS / 1000}s; printing what settled.`);
    }
    // Lay the page out as it prints, so the wait counts the pictures on paper
    // and not the screen copy's, then give them time to arrive.
    await page.emulateMedia({ media: 'print' });
    await waitForImages(page, { networkQuiet, warn });
    const stories = await countStories(page);
    await page.pdf({ path: outFile, format: 'A4', printBackground: false });
    const httpStatus = response?.status?.();
    return httpStatus >= 400 ? { stories, browser: kind, httpStatus } : { stories, browser: kind };
  } finally {
    await browser.close().catch(() => {});
  }
}

/**
 * Sends the PDF to CUPS with lpr, the same command macOS and most Linux
 * desktops already have. Returns { ok, message }.
 */
export function printPdf({ file, printer, platform = process.platform, timeout = 5 * 60_000, exec = execFileSync }) {
  if (platform === 'win32') {
    return {
      ok: false,
      unsupported: true,
      message: `Printing from here needs CUPS (macOS or Linux). The PDF is at ${file}.`,
    };
  }
  if (timeout > 0) {
    try {
      exec('lpr', printer ? ['-P', printer, file] : [file], { stdio: 'inherit', timeout, killSignal: 'SIGKILL' });
      return { ok: true, message: `Sent to ${printer ?? 'the default printer'}. Enjoy the paper.` };
    } catch {
      // Keep the saved PDF and report the normal print failure.
    }
  }
  return {
    ok: false,
    message: `Printing failed (is a printer set up? lpstat -p lists them). The PDF is at ${file}.`,
  };
}
