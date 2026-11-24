import { createRequire } from 'node:module';
import { diagnosticLine } from './errors.mjs';

const require = createRequire(import.meta.url);

export class BrowserMissingError extends Error {}

/** The Playwright version this CLI runs, so the install hint fetches a matching Chromium. */
export function playwrightVersion() {
  try {
    return require('playwright-core/package.json').version;
  } catch {
    return undefined;
  }
}

export function installHint(version = playwrightVersion()) {
  return `npx playwright${version ? `@${version}` : ''} install chromium`;
}

/**
 * auto: the reader's own Google Chrome when it is installed (no download),
 * else Playwright's Chromium. chrome / chromium: only that one.
 * Resolves to { browser, kind }; throws BrowserMissingError with one
 * instruction when nothing launches.
 */
export async function launchBrowser(choice, { chromium, version } = {}) {
  if (!chromium) ({ chromium } = await import('playwright-core'));
  const kinds = choice === 'chrome' ? ['chrome'] : choice === 'chromium' ? ['chromium'] : ['chrome', 'chromium'];
  const failures = [];
  for (const kind of kinds) {
    try {
      const browser = await chromium.launch(kind === 'chrome' ? { channel: 'chrome' } : {});
      return { browser, kind };
    } catch (error) {
      const reason = diagnosticLine(error).replace(/^browserType\.launch:\s*/, '');
      failures.push(`  ${kind === 'chrome' ? 'Google Chrome' : "Playwright's Chromium"}: ${reason}`);
    }
  }
  const installChromium = choice === 'chromium' ? 'Run' : 'Install Google Chrome, or run';
  const fix =
    choice === 'chrome'
      ? 'Install Google Chrome (google.com/chrome), or drop --browser chrome.'
      : `${installChromium} this once to fetch Playwright's Chromium:\n  ${installHint(version)}`;
  throw new BrowserMissingError(`No browser to print with.\n${failures.join('\n')}\n${fix}`);
}
