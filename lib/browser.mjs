import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join } from 'node:path';
import { diagnosticLine } from './errors.mjs';

const require = createRequire(import.meta.url);

export class BrowserMissingError extends Error {}

async function installManagedChromium() {
  const cli = join(dirname(require.resolve('playwright-core/package.json')), 'cli.js');
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
    return require('playwright-core/package.json').version;
  } catch {
    return undefined;
  }
}

export function installHint(version = playwrightVersion()) {
  return `npx playwright${version ? `@${version}` : ''} install chromium --only-shell`;
}

const launchReason = (error) => diagnosticLine(error).replace(/^browserType\.launch:\s*/, '');

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
  systemExecutable = process.env.EDITION_PAPER_CHROMIUM_EXECUTABLE,
} = {}) {
  if (!chromium) ({ chromium } = await import('playwright-core'));
  const kinds = choice === 'chrome' ? ['chrome'] : choice === 'chromium' ? ['chromium'] : ['chrome', 'chromium'];
  const failures = [];
  for (const kind of kinds) {
    if (kind === 'chromium' && systemExecutable && isAbsolute(systemExecutable)) {
      try {
        const browser = await chromium.launch({ executablePath: systemExecutable, chromiumSandbox: true });
        return { browser, kind };
      } catch (error) {
        failures.push(`  System Chromium: ${launchReason(error)}`);
      }
    }
    try {
      const browser = await chromium.launch(kind === 'chrome' ? { channel: 'chrome' } : {});
      return { browser, kind };
    } catch (error) {
      failures.push(`  ${kind === 'chrome' ? 'Google Chrome' : "Playwright's Chromium"}: ${launchReason(error)}`);
    }
  }
  if (install && choice !== 'chrome') {
    try {
      await install();
      return { browser: await chromium.launch({}), kind: 'chromium' };
    } catch (error) {
      failures.push(`  Playwright's Chromium after installation: ${launchReason(error)}`);
    }
  }
  const installChromium = choice === 'chromium' ? 'Run' : 'Install Google Chrome, or run';
  const fix =
    choice === 'chrome'
      ? 'Install Google Chrome (google.com/chrome), or drop --browser chrome.'
      : `${installChromium} this once to fetch Playwright's Chromium (headless shell):\n  ${installHint(version)}`;
  throw new BrowserMissingError(`No browser to print with.\n${failures.join('\n')}\n${fix}`);
}
