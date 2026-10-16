import { mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCliArgs, USAGE } from './args.mjs';
import { BrowserMissingError, launchBrowser } from './browser.mjs';
import { UsageError } from './errors.mjs';
import { localDate, pdfPath, printPdf, renderPaper } from './paper.mjs';
import { paperUrl } from './setup.mjs';
import { installSchedule, uninstallSchedule } from './schedule.mjs';

export const PACKAGE_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
export const VERSION = JSON.parse(readFileSync(join(PACKAGE_DIR, 'package.json'), 'utf8')).version;

// A scheduled run must end even if a browser hangs; launchd won't stop it.
const WATCHDOG_MS = 5 * 60_000;

const stamp = (now = new Date()) =>
  `${localDate(now)} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

/** Runs one CLI invocation; resolves to the exit code. */
export async function main(argv, io = {}) {
  const {
    log = console.log,
    error = console.error,
    home = homedir(),
    cwd = process.cwd(),
    platform = process.platform,
    isTTY = Boolean(process.stdout.isTTY),
  } = io;

  let options;
  try {
    options = parseCliArgs(argv, { home, cwd });
  } catch (err) {
    if (err instanceof UsageError) {
      error(err.message);
      return 1;
    }
    throw err;
  }

  if (options.command === 'help') {
    log(USAGE);
    return 0;
  }
  if (options.command === 'version') {
    log(VERSION);
    return 0;
  }
  if (options.command === 'uninstall') {
    const result = uninstallSchedule({ platform, home });
    (result.ok ? log : error)(result.message);
    return result.ok ? 0 : 1;
  }
  if (options.command === 'install') {
    try {
      const result = await installSchedule({
        options,
        platform,
        home,
        packageDir: PACKAGE_DIR,
        version: VERSION,
        preflight: async (choice) => {
          const { browser } = await launchBrowser(choice);
          await browser.close();
        },
      });
      (result.ok ? log : error)(result.message);
      return result.ok ? 0 : 1;
    } catch (err) {
      error(err instanceof BrowserMissingError ? err.message : `Could not install the schedule: ${err.message}`);
      return 1;
    }
  }

  // render
  if (!isTTY) log(`— ${stamp()} · edition-paper ${VERSION}`);
  const watchdog = setTimeout(() => {
    error(`Gave up after ${WATCHDOG_MS / 60_000} minutes without a finished paper.`);
    process.exit(1);
  }, WATCHDOG_MS);
  watchdog.unref();

  const outFile = pdfPath(options.outDir);
  let rendered;
  try {
    mkdirSync(options.outDir, { recursive: true });
    log(`Composing today's edition from ${options.url} (${options.sources} source${options.sources === 1 ? '' : 's'})…`);
    rendered = await renderPaper({
      url: paperUrl(options.url, options.setup),
      outFile,
      browser: options.browser,
      warn: error,
    });
  } catch (err) {
    if (err instanceof BrowserMissingError) {
      error(err.message);
      return 1;
    }
    const reason = String(err?.message ?? err).split('\n')[0];
    error(`Could not make the paper: ${reason}`);
    if (platform === 'darwin' && /EPERM|operation not permitted/i.test(reason)) {
      error(
        `macOS may be guarding ${options.outDir}. Allow node in System Settings → Privacy & Security → Files and Folders, or pick another folder with --out.`
      );
    }
    return 1;
  } finally {
    clearTimeout(watchdog);
  }

  log(`Edition saved: ${outFile} (${rendered.stories} stories)`);
  if (rendered.stories === 0) {
    error('No stories rendered; not sending to the printer.');
    return 1;
  }
  if (!options.print) return 0;

  const printed = printPdf({ file: outFile, printer: options.printer, platform });
  if (printed.unsupported && options.printer === undefined) {
    log(printed.message); // nobody asked for a printer by name; the PDF is the paper
    return 0;
  }
  (printed.ok ? log : error)(printed.message);
  return printed.ok ? 0 : 1;
}
