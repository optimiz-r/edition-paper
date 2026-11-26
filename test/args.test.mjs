import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { parseCliArgs, parseTime, scheduledArgs, UsageError } from '../lib/args.mjs';

const SETUP = 'W3siaWQiOiJsb2JzdGVycyIsIm5hbWUiOiJMb2JzdGVycyIsInR5cGUiOiJzdGF0aWMifV0';
const ctx = { home: '/Users/ada', cwd: '/Users/ada/work' };
const parse = (...argv) => parseCliArgs(argv, ctx);
const rejects = (argv, pattern) =>
  assert.throws(() => parseCliArgs(argv, ctx), (error) => error instanceof UsageError && pattern.test(error.message));

test('a plain run renders with the documented defaults', () => {
  assert.deepEqual(parse('--setup', SETUP), {
    command: 'render',
    setup: SETUP,
    sources: 1,
    url: 'https://edition.cafe',
    customUrl: false,
    outDir: '/Users/ada/Documents/Editions',
    customOut: false,
    printer: undefined,
    print: true,
    browser: 'auto',
  });
});

test('--flag=value works like --flag value', () => {
  assert.equal(parse(`--setup=${SETUP}`).setup, SETUP);
  assert.equal(parse('--setup', SETUP, '--printer=Brother HL').printer, 'Brother HL');
});

test('--no-print, --printer, --browser and --url are read', () => {
  const options = parse('--setup', SETUP, '--no-print', '--printer', 'My Printer', '--browser', 'chromium', '--url', 'http://localhost:5199/');
  assert.equal(options.print, false);
  assert.equal(options.printer, 'My Printer');
  assert.equal(options.browser, 'chromium');
  assert.equal(options.url, 'http://localhost:5199');
  assert.equal(options.customUrl, true);
});

test('--out is made absolute, and a leading ~ means home', () => {
  assert.equal(parse('--setup', SETUP, '--out', 'papers').outDir, '/Users/ada/work/papers');
  assert.equal(parse('--setup', SETUP, '--out=~/Papers').outDir, '/Users/ada/Papers');
  assert.equal(parse('--setup', SETUP, '--out', '/tmp/x/../y').outDir, '/tmp/y');
});

test('--install-schedule takes HHMM (or HH:MM) and needs --setup', () => {
  const options = parse('--setup', SETUP, '--install-schedule', '0800');
  assert.equal(options.command, 'install');
  assert.deepEqual(options.time, { hour: 8, minute: 0 });
  assert.deepEqual(parseTime('23:59'), { hour: 23, minute: 59 });
  assert.deepEqual(parseTime('0000'), { hour: 0, minute: 0 });
  for (const bad of ['800', '8am', '2400', '0860', '08-00', '']) {
    assert.throws(() => parseTime(bad), UsageError, bad);
  }
  rejects(['--install-schedule', '0800'], /--install-schedule needs --setup/);
  rejects(['--setup', SETUP, '--install-schedule'], /argument missing/);
});

test('uninstall needs nothing else, and refuses to be combined with install', () => {
  assert.deepEqual(parse('--uninstall-schedule'), { command: 'uninstall' });
  rejects(['--uninstall-schedule', '--install-schedule', '0800', '--setup', SETUP], /not both/);
});

test('help and version win over everything else', () => {
  assert.deepEqual(parse('--help'), { command: 'help' });
  assert.deepEqual(parse('-h', '--setup', 'garbage'), { command: 'help' });
  assert.deepEqual(parse('-v'), { command: 'version' });
});

test('mistakes get one plain sentence', () => {
  rejects([], /Missing --setup\. Open edition\.cafe\/paper/);
  rejects(['--setup'], /argument missing/);
  rejects(['--bogus'], /Unknown option '--bogus'/);
  rejects(['W3s'], /Unexpected argument "W3s"/);
  rejects(['npm', 'run', 'paper', '--', '--setup', SETUP], /Drop "npm run paper --"/);
  rejects(['--setup', SETUP, '--browser', 'firefox'], /auto, chrome or chromium/);
  rejects(['--setup', SETUP, '--printer', '  '], /needs a printer name/);
  rejects(['--setup', SETUP, '--url', 'ftp://edition.cafe'], /https:\/\/ or http:\/\//);
  rejects(['--setup', SETUP, '--url', 'edition.cafe'], /web address/);
  rejects(['--setup', SETUP, '--url', 'https://edition.cafe/?x=1'], /without \? or #/);
});

test('the scheduled run repeats only what the reader chose', () => {
  assert.deepEqual(scheduledArgs(parse('--setup', SETUP)), ['--setup', SETUP]);
  assert.deepEqual(
    scheduledArgs(parse('--setup', SETUP, '--printer', 'My Printer', '--out', '~/Papers', '--url', 'https://edition.cafe/', '--browser', 'chrome')),
    ['--setup', SETUP, '--printer', 'My Printer', '--out', '/Users/ada/Papers', '--url', 'https://edition.cafe', '--browser', 'chrome']
  );
  // --no-print wins over --printer, as it does on a manual run.
  assert.deepEqual(scheduledArgs(parse('--setup', SETUP, '--printer', 'P', '--no-print')), ['--setup', SETUP, '--no-print']);
});

test('argument matrix preserves last-value and informational-flag behavior', () => {
  const paired = [
    ['setup', 'malformed', SETUP, 'setup', SETUP],
    ['browser', 'invalid', 'chrome', 'browser', 'chrome'],
    ['url', 'invalid', 'http://localhost:5173', 'url', 'http://localhost:5173'],
    ['out', 'Papers', 'Papers été', 'outDir', resolve(ctx.cwd, 'Papers été')],
    ['printer', 'Office', "Ada's & Co", 'printer', "Ada's & Co"],
    ['install-schedule', 'invalid', '08:05', 'time', { hour: 8, minute: 5 }],
  ];
  for (const [flag, first, last, property, expected] of paired) {
    assert.deepEqual(parse('--setup', SETUP, `--${flag}=${first}`, `--${flag}`, last)[property], expected, flag);
  }
  for (const [flag, property, expected] of [
    ['no-print', 'print', false],
    ['uninstall-schedule', 'command', 'uninstall'],
    ['help', 'command', 'help'],
    ['version', 'command', 'version'],
  ]) {
    assert.equal(parse('--setup', SETUP, `--${flag}`, `--${flag}`)[property], expected, flag);
  }
});

test('argument matrix rejects missing values and boolean assignments', () => {
  for (const flag of ['setup', 'browser', 'url', 'out', 'printer', 'install-schedule']) {
    rejects([`--${flag}`], /argument missing/);
  }
  for (const flag of ['no-print', 'uninstall-schedule', 'help', 'version']) {
    for (const value of ['', 'false', '123', ';']) {
      rejects([`--${flag}=${value}`], /does not take an argument/);
    }
  }
  for (const [flag, pattern] of [
    ['setup', /not one Edition made/],
    ['browser', /auto, chrome or chromium/],
    ['url', /must be a web address/],
    ['printer', /needs a printer name/],
    ['install-schedule', /Use HHMM/],
  ]) {
    rejects(['--setup', SETUP, `--${flag}=`], pattern);
  }
});

test('argument errors stay on one line when input contains control characters', () => {
  for (const token of ['stray\nword', '--unknown\r\noption', 'forged\u001B[2J', 'stray\u2028word']) {
    assert.throws(() => parse('--setup', SETUP, token), (error) => {
      assert.ok(error instanceof UsageError);
      assert.match(error.message, /Run edition-paper --help/);
      assert.doesNotMatch(error.message, /[\r\n\u001B\u2028]/);
      return true;
    });
  }
});
