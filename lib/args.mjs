import { parseArgs } from 'node:util';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { UsageError } from './errors.mjs';
import { DEFAULT_URL, readSetup } from './setup.mjs';

export { UsageError };

export const BROWSERS = ['auto', 'chrome', 'chromium'];

const OPTIONS = {
  setup: { type: 'string' },
  url: { type: 'string' },
  out: { type: 'string' },
  printer: { type: 'string' },
  'no-print': { type: 'boolean' },
  'install-schedule': { type: 'string' },
  'uninstall-schedule': { type: 'boolean' },
  browser: { type: 'string' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
};

export const USAGE = `edition-paper — Edition's morning paper, printed

Usage
  npx edition-paper --setup <param> [--no-print] [--printer <name>]
  npx edition-paper --setup <param> --install-schedule 0800 [--printer <name>]
  npx edition-paper --uninstall-schedule

Get <param> from edition.cafe/paper: "Copy 8am command" copies
"npm run paper -- --setup <param>". Keep everything from --setup on.

Flags
  --setup <param>             Your sources, as copied from edition.cafe/paper.
  --no-print                  Save the PDF only; don't send it to a printer.
  --printer <name>            Print to this CUPS printer (see: lpstat -p).
                              Without it, the default printer is used.
  --out <dir>                 Where PDFs go. Default: ~/Documents/Editions
  --install-schedule <HHMM>   macOS: run daily at HHMM (24h), e.g. 0800.
  --uninstall-schedule        macOS: remove the daily run.
  --browser <auto|chrome|chromium>
                              Default auto: Google Chrome if installed,
                              else Playwright's Chromium.
  --url <origin>              Edition to load. Default: ${DEFAULT_URL}
  -h, --help                  Show this help.
  -v, --version               Show the version.
`;

const firstSentence = (message) => String(message).split(/\.\s/)[0].replace(/\.$/, '');

/** "0800" or "08:00" → { hour: 8, minute: 0 }. */
export function parseTime(value) {
  const match = /^(\d{2}):?(\d{2})$/.exec(value ?? '');
  if (!match) throw new UsageError('Use HHMM for --install-schedule, e.g. 0800.');
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) {
    throw new UsageError('Use HHMM with hour 00-23 and minute 00-59, e.g. 0800.');
  }
  return { hour, minute };
}

/** Accepts http(s) origins only; returns it without trailing slashes. */
export function parseBaseUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new UsageError(`--url must be a web address, e.g. ${DEFAULT_URL}.`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new UsageError(`--url must start with https:// or http://.`);
  }
  if (url.search || url.hash) {
    throw new UsageError('--url takes an origin such as https://edition.cafe, without ? or #.');
  }
  return value.replace(/\/+$/, '');
}

/** Absolute path, with a leading ~ expanded (the shell skips it in --out=~/x). */
export function resolveDir(value, { home = homedir(), cwd = process.cwd() } = {}) {
  if (value === '~') return home;
  if (value.startsWith('~/')) return join(home, value.slice(2));
  return isAbsolute(value) ? resolve(value) : resolve(cwd, value);
}

/**
 * Turns argv into one of: help, version, uninstall, install, render.
 * Throws UsageError with a reader-facing message on anything else.
 */
export function parseCliArgs(argv, { home = homedir(), cwd = process.cwd() } = {}) {
  let values;
  let positionals;
  try {
    ({ values, positionals } = parseArgs({
      args: argv,
      options: OPTIONS,
      strict: true,
      allowPositionals: true,
    }));
  } catch (error) {
    throw new UsageError(`${firstSentence(error.message)}. Run edition-paper --help for the flags.`);
  }

  if (positionals.length > 0) {
    const pastedNpm = positionals.some((p) => ['npm', 'run', 'paper'].includes(p));
    throw new UsageError(
      pastedNpm
        ? 'Drop "npm run paper --" from the copied command: run npx edition-paper --setup <param>.'
        : `Unexpected argument "${positionals[0]}". Run edition-paper --help for the flags.`
    );
  }

  if (values.help) return { command: 'help' };
  if (values.version) return { command: 'version' };

  if (values['uninstall-schedule'] && values['install-schedule'] !== undefined) {
    throw new UsageError('Use either --install-schedule or --uninstall-schedule, not both.');
  }
  if (values['uninstall-schedule']) return { command: 'uninstall' };

  const browser = values.browser ?? 'auto';
  if (!BROWSERS.includes(browser)) {
    throw new UsageError('--browser takes auto, chrome or chromium.');
  }

  if (values.printer !== undefined && values.printer.trim() === '') {
    throw new UsageError('--printer needs a printer name (see: lpstat -p).');
  }

  const installing = values['install-schedule'] !== undefined;
  if (values.setup === undefined) {
    throw new UsageError(
      installing
        ? '--install-schedule needs --setup. Open edition.cafe/paper and use "Copy 8am command".'
        : 'Missing --setup. Open edition.cafe/paper and use "Copy 8am command".'
    );
  }
  const { setup, sources } = readSetup(values.setup);

  const options = {
    setup,
    sources,
    url: values.url === undefined ? DEFAULT_URL : parseBaseUrl(values.url),
    customUrl: values.url !== undefined,
    outDir: resolveDir(values.out ?? join(home, 'Documents', 'Editions'), { home, cwd }),
    customOut: values.out !== undefined,
    printer: values.printer,
    print: !values['no-print'],
    browser,
  };

  if (installing) {
    return { command: 'install', ...options, time: parseTime(values['install-schedule']) };
  }
  return { command: 'render', ...options };
}

/**
 * The flags the scheduled run repeats. Only what the reader chose: defaults
 * are left to the CLI so a later version can improve them.
 */
export function scheduledArgs(options) {
  return [
    '--setup',
    options.setup,
    ...(options.printer !== undefined && options.print ? ['--printer', options.printer] : []),
    ...(options.print ? [] : ['--no-print']),
    ...(options.customOut ? ['--out', options.outDir] : []),
    ...(options.customUrl ? ['--url', options.url] : []),
    ...(options.browser !== 'auto' ? ['--browser', options.browser] : []),
  ];
}
