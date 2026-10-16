import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { launchBrowser } from './browser.mjs';

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

const firstLine = (error) => String(error instanceof Error ? error.message : error).split('\n')[0];

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
 * composed, and saves it as an A4 PDF. Returns { stories, browser }.
 * Throws with a reader-facing message when the page can't be reached.
 */
export async function renderPaper({ url, outFile, browser: choice, warn = console.warn, launch = launchBrowser }) {
  const { browser, kind } = await launch(choice);
  try {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    await context.route(isAnalytics, (route) => route.abort());
    const page = await context.newPage();
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT_MS });
    } catch (error) {
      throw new Error(`Could not reach ${new URL(url).origin} (${firstLine(error)}). Is the site up?`);
    }
    try {
      await page.waitForSelector(READY_SELECTOR, { timeout: READY_TIMEOUT_MS });
    } catch (error) {
      if (error?.name !== 'TimeoutError') throw error;
      warn(`The page was still composing after ${READY_TIMEOUT_MS / 1000}s; printing what settled.`);
    }
    const stories = await countStories(page);
    await page.pdf({ path: outFile, format: 'A4', printBackground: false });
    return { stories, browser: kind };
  } finally {
    await browser.close().catch(() => {});
  }
}

/**
 * Sends the PDF to CUPS with lpr, the same command macOS and most Linux
 * desktops already have. Returns { ok, message }.
 */
export function printPdf({ file, printer, platform = process.platform, exec = execFileSync }) {
  if (platform === 'win32') {
    return {
      ok: false,
      unsupported: true,
      message: `Printing from here needs CUPS (macOS or Linux). The PDF is at ${file}.`,
    };
  }
  try {
    exec('lpr', printer ? ['-P', printer, file] : [file], { stdio: 'inherit' });
    return { ok: true, message: `Sent to ${printer ?? 'the default printer'}. Enjoy the paper.` };
  } catch {
    return {
      ok: false,
      message: `Printing failed (is a printer set up? lpstat -p lists them). The PDF is at ${file}.`,
    };
  }
}
