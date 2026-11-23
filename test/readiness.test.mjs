import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { Worker } from 'node:worker_threads';
import { launchBrowser } from '../lib/browser.mjs';
import { renderPaper } from '../lib/paper.mjs';

const image = (src, attrs = '') => `<img loading="lazy" src="/asset/${src}" width="180" height="80" ${attrs}>`;
const fixtures = {
  slow: { html: image('slow'), resources: ['slow'], color: 'red' },
  failed: { html: image('failed', 'alt="Picture unavailable"'), resources: ['failed'] },
  lazy: {
    html: `<div style="height:1100px"></div><div style="break-before:page">${image('lazy')}</div>`,
    resources: ['lazy'],
    color: 'red',
    page: 2,
  },
  swap: {
    html: image('first', 'id="lead"'),
    script: `document.querySelector('#lead').addEventListener('load', ({ target }) => {
      setTimeout(() => { target.src = '/asset/replacement'; }, 110);
    }, { once: true });`,
    resources: ['first', 'replacement'],
    color: 'blue',
  },
  background: {
    html: '<div class="background"></div>',
    css: '.background { width:180px; height:80px; background-image:url(/asset/background) }',
    resources: ['background'],
    color: 'green',
  },
  font: {
    html: '<p style="font-family:Fixture">Late web font sample 1 2 3</p>',
    css: '@font-face { font-family:Fixture; src:url(/asset/font) }',
    resources: ['font'],
  },
};

const resources = {
  slow: { time: 275, color: '#f00' },
  failed: { time: 70 },
  lazy: { time: 130, color: '#f00' },
  first: { time: 65, color: '#f00' },
  replacement: { time: 210, color: '#00f' },
  background: { time: 220, color: '#0b0' },
  font: { time: 280 },
};

const svg = (color) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="80"><rect width="180" height="80" fill="${color}"/></svg>`;

function edition(name, fixture) {
  return `<!doctype html><html data-edition-ready="true"><meta charset="utf-8">
    <title>${name}</title><link rel="icon" href="data:,">
    <style>
      @media screen { .print-columns { display: none } }
      * { print-color-adjust: exact; -webkit-print-color-adjust: exact }
      ${fixture.css ?? ''}
    </style>
    <main class="print-columns"><article class="story">${fixture.html}</article></main>
    <script>${fixture.script ?? ''}</script></html>`;
}

function rasterColors(file, page = 1) {
  const raster = execFileSync('pdftoppm', ['-f', String(page), '-l', String(page), '-r', '36', file]);
  const header = /^P6\n\d+ \d+\n255\n/.exec(raster.toString('ascii', 0, 64));
  assert.ok(header, `expected a color raster for page ${page}`);
  const colors = { red: 0, blue: 0, green: 0 };
  for (let i = header[0].length; i < raster.length; i += 3) {
    const r = raster[i], g = raster[i + 1], b = raster[i + 2];
    if (r > 200 && g < 40 && b < 40) colors.red++;
    if (r < 40 && g < 40 && b > 200) colors.blue++;
    if (r < 40 && g > 130 && b < 40) colors.green++;
  }
  return colors;
}

test('PDF readiness with real Chromium and loopback resources', {
  skip: process.env.EDITION_PAPER_TEST_BROWSER !== '1',
  timeout: 15 * 60_000,
}, async (t) => {
  const repeats = Number(process.env.EDITION_PAPER_TEST_REPEATS ?? 1);
  assert.ok(Number.isInteger(repeats) && repeats > 0);
  const selected = process.env.EDITION_PAPER_TEST_CASE;
  if (selected) assert.ok(Object.hasOwn(fixtures, selected));
  const dir = mkdtempSync(join(tmpdir(), 'paper-fixtures-'));
  const font = readFileSync(process.env.EDITION_PAPER_TEST_FONT ??
    '/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf');
  const completed = new Set();
  const server = createServer(async (req, res) => {
    const [, route, name] = req.url.split('/');
    if (route === 'paper' && Object.hasOwn(fixtures, name)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(edition(name, fixtures[name]));
      return;
    }
    const resource = route === 'asset' && resources[name];
    if (!resource) {
      res.writeHead(404).end();
      return;
    }
    await delay(resource.time);
    if (name === 'font') res.writeHead(200, { 'Content-Type': 'font/ttf' }).end(font);
    else if (resource.color) res.writeHead(200, { 'Content-Type': 'image/svg+xml' }).end(svg(resource.color));
    else res.writeHead(404).end();
    completed.add(name);
  });
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}`;
  if (process.env.EDITION_PAPER_TEST_CPU_LOAD === '1') {
    const load = new Worker('for (;;) Math.sqrt(Math.random());', { eval: true });
    t.after(() => load.terminate());
    await once(load, 'online');
  }

  const { browser, kind } = await launchBrowser('chromium', { install: null });
  t.after(() => browser.close());
  for (const [name, fixture] of Object.entries(fixtures)) {
    if (selected && name !== selected) continue;
    await t.test(`${name}: ${repeats} consecutive complete PDFs`, async () => {
      for (let i = 0; i < repeats; i++) {
        completed.clear();
        const file = join(dir, `${name}-${i + 1}.pdf`);
        const warnings = [];
        const context = await browser.newContext({ serviceWorkers: 'block' });
        const finished = new Set();
        try {
          const page = await context.newPage();
          page.on('requestfinished', (request) => {
            if (request.url().startsWith(url + '/asset/')) finished.add(request.url().split('/').at(-1));
          });
          const pdf = page.pdf.bind(page);
          page.pdf = (options) => {
            for (const resource of fixture.resources) {
              assert.ok(completed.has(resource) && finished.has(resource), `${name} PDF started before ${resource} finished`);
            }
            return pdf(options);
          };
          const result = await renderPaper({
            url: `${url}/paper/${name}`, outFile: file, browser: 'chromium', warn: (msg) => warnings.push(msg),
            launch: async () => ({
              kind,
              browser: { newContext: async () => ({ route: context.route.bind(context), newPage: async () => page }), close: async () => {} },
            }),
          });
          assert.equal(result.stories, 1);
        } finally {
          await context.close();
        }
        if (name === 'failed') {
          assert.deepEqual(warnings, [`Printing without 1 picture that never loaded: ${url}/asset/failed (failed to load)`]);
        } else {
          assert.deepEqual(warnings, []);
        }
        if (name === 'font') assert.match(execFileSync('pdffonts', [file], { encoding: 'utf8' }), /DejaVuSansMono-Bold/);
        if (fixture.color) {
          const colors = rasterColors(file, fixture.page);
          assert.ok(colors[fixture.color] > 500, `missing ${fixture.color} artwork in ${file}`);
          if (name === 'swap') assert.equal(colors.red, 0, 'obsolete image leaked into the PDF');
        }
      }
    });
  }
});
