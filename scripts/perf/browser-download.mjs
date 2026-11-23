import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createReadStream, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { fixtureServer, listen } from './fixtures.mjs';

const cases = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const root = mkdtempSync(join(tmpdir(), 'edition-paper-download-'));
const fixture = await fixtureServer();
const results = {};

async function measure(entry, mode, mirror, parent) {
  const work = mkdtempSync(join(parent, `${mode}-`));
  const setup = Buffer.from('[{"id":"fixture","type":"static","name":"Fixture"}]').toString('base64url');
  const renderArgs = [
    resolve(entry.cli), '--setup', setup, '--url', fixture.url, '--out', work, '--no-print',
  ];
  const args = mode === 'legacy'
    ? [resolve(entry.installer), 'install', 'chromium']
    : [...renderArgs, '--browser', mode === 'opt-in' || mode === 'missing' ? 'chromium' : 'auto'];
  const env = {
    PATH: process.env.PATH, HOME: work, TMPDIR: work, XDG_CACHE_HOME: join(work, '.cache'),
    LANG: 'C.UTF-8', TZ: 'UTC', NO_PROXY: '*',
    PLAYWRIGHT_DOWNLOAD_HOST: mirror,
    PLAYWRIGHT_BROWSERS_PATH: join(work, 'browsers'),
    ...(mode === 'opt-in' ? { EDITION_PAPER_INSTALL_CHROMIUM: '1' } : {}),
    ...(mode === 'system' ? {
      EDITION_PAPER_INSTALL_CHROMIUM: '1',
      EDITION_PAPER_CHROMIUM_EXECUTABLE: entry.systemChromium,
    } : {}),
  };
  let titleMs;
  let progressMs;
  let title;
  let progress;
  let stdout = '';
  let stderr = '';
  const start = performance.now();
  const child = spawn(process.execPath, args, { env, cwd: work });
  child.stdout.setEncoding('utf8').on('data', (chunk) => {
    stdout += chunk;
    const download = /^Downloading (.+)$/m.exec(stdout);
    if (download && title === undefined) {
      title = download[0];
      titleMs = performance.now() - start;
    }
    const status = /\d+% of [\d.]+ MiB/m.exec(stdout);
    if (status && progress === undefined) {
      progress = status[0];
      progressMs = performance.now() - start;
    }
  });
  child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
  const timer = globalThis.setTimeout(() => child.kill('SIGTERM'), 300_000);
  try {
    const [exit] = await once(child, 'close');
    assert.equal(exit, mode === 'missing' ? 1 : 0, stdout + stderr);
    const wrotePdf = readdirSync(work).some((file) => /^edition-.*\.pdf$/.test(file));
    if (mode === 'missing') assert.match(stderr, /^No browser to print with\./m);
    if (mode !== 'missing' && mode !== 'legacy') assert(wrotePdf, 'render must save a PDF');
    return { titleMs, progressMs, title, progress, wrotePdf, exit };
  } finally {
    clearTimeout(timer);
  }
}

try {
  for (const [id, entry] of Object.entries(cases)) {
    let bytes = 0;
    let requests = 0;
    const { server, url } = await listen(async (request, response) => {
      const path = new URL(request.url, 'http://localhost').pathname;
      const type = /headless-shell/.test(path) ? 'shell' : /ffmpeg/.test(path) ? 'ffmpeg' : 'chrome';
      if (!entry.archives[type]) {
        response.writeHead(404).end();
        return;
      }
      const archive = resolve(entry.archives[type]);
      const length = statSync(archive).size;
      requests += 1;
      await setTimeout(300);
      response.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': length });
      const stream = createReadStream(archive);
      stream.on('data', (chunk) => { bytes += chunk.length; });
      response.on('close', () => stream.destroy());
      stream.pipe(response);
    });
    try {
      const work = join(root, id);
      mkdirSync(work);
      const missing = await measure(entry, 'missing', url, work);
      assert.equal(requests, 0, 'default failure must not initiate a download');
      const system = await measure(entry, 'system', url, work);
      assert.equal(requests, 0, 'installed system Chrome must avoid a download');
      const mode = entry.optIn ? 'opt-in' : 'legacy';
      const download = await measure(entry, mode, url, work);
      assert(requests > 0);
      assert(download.title && download.progress, 'expect a download title and sized progress');
      results[id] = {
        missing, system, download, requests, bytes,
        pass: download.titleMs <= 2000 && download.progressMs <= 2000 && system.wrotePdf,
        summary: `system Chrome: 0 B; ${mode}: name ${download.titleMs.toFixed(0)} ms, size/progress ${download.progressMs.toFixed(0)} ms, ${bytes} B`,
      };
      console.error(`${id} ${download.title}; ${download.progress}; ${bytes} bytes`);
    } finally {
      server.closeAllConnections();
      server.close();
    }
  }
} finally {
  fixture.server.closeAllConnections();
  fixture.server.close();
  rmSync(root, { recursive: true, force: true });
}
console.log(JSON.stringify(results, null, 2));
