import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const bundled = new URL('../vendor/playwright-core/', import.meta.url);
const bundledManifest = new URL('package.json', bundled);

const hasBundledDriver = () => existsSync(bundledManifest);

export class BrowserMissingError extends Error {}

async function installManagedChromium() {
  const cli = hasBundledDriver()
    ? fileURLToPath(new URL('cli.js', bundled))
    : join(dirname(require.resolve('playwright-core/package.json')), 'cli.js');
  console.log("Installing Playwright's Chromium Headless Shell. Download size and progress follow when the transfer starts.");
  const child = spawn(process.execPath, [cli, 'install', 'chromium', '--only-shell'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      npm_config_loglevel: 'notice',
      PLAYWRIGHT_DOWNLOAD_NO_PROGRESS: '0',
      PLAYWRIGHT_SKIP_BROWSER_GC: '1',
    },
  });
  const stop = () => child.kill();
  process.once('exit', stop);
  try {
    const [code, signal] = await once(child, 'close');
    if (code !== 0) throw new Error(`Playwright installer exited with ${signal ?? code}.`);
  } finally {
    process.off('exit', stop);
  }
}

/** The Playwright version this CLI runs, so the install hint fetches a matching Chromium. */
export function playwrightVersion() {
  try {
    const manifest = hasBundledDriver() ? fileURLToPath(bundledManifest) : 'playwright-core/package.json';
    return require(manifest).version;
  } catch {
    return undefined;
  }
}

export function installHint(version = playwrightVersion()) {
  return `npx playwright${version ? `@${version}` : ''} install chromium`;
}

const firstLine = (error) =>
  String(error instanceof Error ? error.message : error)
    .split('\n')[0]
    .replace(/^browserType\.launch:\s*/, '');

/**
 * auto: the reader's own Google Chrome when it is installed (no download),
 * else Playwright's Chromium. chrome / chromium: only that one.
 * Resolves to { browser, kind }; throws BrowserMissingError with one
 * instruction when nothing launches.
 */
export async function launchBrowser(choice, {
  chromium,
  version,
  install = process.env.EDITION_PAPER_INSTALL_CHROMIUM === '1' ? installManagedChromium : undefined,
} = {}) {
  if (!chromium) {
    const entry = hasBundledDriver() ? new URL('index.mjs', bundled) : 'playwright-core';
    ({ chromium } = await import(entry));
  }
  const kinds = choice === 'chrome' ? ['chrome'] : choice === 'chromium' ? ['chromium'] : ['chrome', 'chromium'];
  const failures = [];
  for (const kind of kinds) {
    try {
      const browser = await chromium.launch(kind === 'chrome' ? { channel: 'chrome' } : {});
      return { browser, kind };
    } catch (error) {
      failures.push(`  ${kind === 'chrome' ? 'Google Chrome' : "Playwright's Chromium"}: ${firstLine(error)}`);
    }
  }
  if (install && choice !== 'chrome') {
    try {
      await install();
      return { browser: await chromium.launch({}), kind: 'chromium' };
    } catch (error) {
      failures.push(`  Playwright's Chromium after installation: ${firstLine(error)}`);
    }
  }
  const fix =
    choice === 'chrome'
      ? 'Install Google Chrome (google.com/chrome), or drop --browser chrome.'
      : `Install Google Chrome, or run this once to fetch Playwright's Chromium (about 150 MB):\n  ${installHint(version)}`;
  throw new BrowserMissingError(`No browser to print with.\n${failures.join('\n')}\n${fix}`);
}
