import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseCliArgs, scheduledArgs } from '../lib/args.mjs';
import { buildPlist, escapeXml } from '../lib/plist.mjs';

const GOLDEN = readFileSync(new URL('./fixtures/com.edition.paper.plist', import.meta.url), 'utf8');
const SETUP = 'W3siaWQiOiJsb2JzdGVycyIsIm5hbWUiOiJMb2JzdGVycyIsInR5cGUiOiJzdGF0aWMifV0';

const golden = () => {
  const options = parseCliArgs(
    ['--setup', SETUP, '--printer', `Ada's "HL-L2350" <upstairs> & co`, '--out', '~/Documents/Morning & Evening', '--install-schedule', '0705'],
    { home: '/Users/ada', cwd: '/' }
  );
  return {
    node: '/opt/homebrew/bin/node',
    script: '/Users/ada/Library/Application Support/Edition/paper/cli.mjs',
    args: scheduledArgs(options),
    hour: options.time.hour,
    minute: options.time.minute,
    log: '/Users/ada/Library/Logs/edition-paper.log',
  };
};

test('the agent matches the golden plist byte for byte', () => {
  assert.equal(buildPlist(golden()), GOLDEN);
});

test('every program argument is an absolute path or a flag; nothing relies on PATH', () => {
  const plist = buildPlist(golden());
  const strings = [...plist.matchAll(/<string>([^<]*)<\/string>/g)].map((m) => m[1]);
  assert.equal(strings[1], '/opt/homebrew/bin/node');
  assert.match(strings[2], /^\/Users\/ada\/Library\/Application Support\/Edition\/paper\/cli\.mjs$/);
  for (const key of ['StandardOutPath', 'StandardErrorPath']) {
    assert.match(plist, new RegExp(`<key>${key}</key><string>/Users/ada/Library/Logs/edition-paper\\.log</string>`));
  }
  for (const name of ['node', 'script', 'log']) {
    assert.throws(() => buildPlist({ ...golden(), [name]: 'relative/path' }), new RegExp(`absolute ${name} path`));
  }
});

test('arguments are XML-escaped, so a printer name cannot break the file', () => {
  const plist = buildPlist(golden());
  const body = plist.replace(/^<\?xml[^>]*>\n<!DOCTYPE[^>]*>\n/, '');
  // No raw markup characters survive inside any <string>.
  for (const [, text] of body.matchAll(/<string>([^<]*)<\/string>/g)) {
    assert.doesNotMatch(text, /[<>"']|&(?!amp;|lt;|gt;|quot;|apos;)/);
  }
  assert.equal(escapeXml(`<a href="x">Tom & Jerry's</a>`), '&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&apos;s&lt;/a&gt;');
  assert.throws(() => escapeXml('bell\u0007'), /control character/);
});

test('hour and minute are checked again at the last step', () => {
  assert.throws(() => buildPlist({ ...golden(), hour: 24 }), /Bad hour/);
  assert.throws(() => buildPlist({ ...golden(), minute: 60 }), /Bad minute/);
  assert.match(buildPlist({ ...golden(), hour: 0, minute: 0 }), /<integer>0<\/integer>\n {4}<key>Minute<\/key><integer>0<\/integer>/);
});
