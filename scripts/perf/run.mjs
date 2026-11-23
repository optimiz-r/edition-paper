import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, delimiter, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixtureServer, fixtures } from './fixtures.mjs';
import { registry } from './registry.mjs';

const [manifestPath, repeatsArg = '9'] = process.argv.slice(2);
if (!manifestPath) throw new Error('Usage: node scripts/perf/run.mjs cases.json [repetitions]');
const cases = JSON.parse(readFileSync(manifestPath, 'utf8'));
const repeats = Number(repeatsArg);
assert(Number.isInteger(repeats) && repeats >= 3);
const root = mkdtempSync(join(tmpdir(), 'edition-paper-perf-'));
const probe = fileURLToPath(new URL('./probe.cjs', import.meta.url));
const setup = Buffer.from(JSON.stringify([{ id: 'fixture', type: 'static', name: 'Fixture' }])).toString('base64url');
const time = '/usr/bin/time';
const node = process.execPath;
const fakeBin = join(root, 'bin');
mkdirSync(fakeBin);
writeFileSync(join(fakeBin, 'lpr'), '#!/bin/sh\nprintf "%s\\n" "$@" >> "$EDITION_PERF_LPR"\n', { mode: 0o755 });
const path = [fakeBin, resolve(node, '..'), ...process.env.PATH.split(delimiter)].join(delimiter);
const procFs = process.platform === 'linux';
const memoryOf = (pid) => {
  let rss = 0;
  let pss = 0;
  try {
    const status = readFileSync(`/proc/${pid}/smaps_rollup`, 'utf8');
    rss = Number(/^Rss:\s+(\d+)/m.exec(status)?.[1] ?? 0);
    pss = Number(/^Pss:\s+(\d+)/m.exec(status)?.[1] ?? 0);
  } catch { /* process could exit during sampling */ }
  try {
    // Children can have been spawned by threads besides the group leader.
    const pids = new Set();
    for (const tid of readdirSync(`/proc/${pid}/task`)) {
      try {
        const list = readFileSync(`/proc/${pid}/task/${tid}/children`, 'utf8').trim();
        if (list) for (const child of list.split(/\s+/)) pids.add(child);
      } catch { /* thread exited while sampling */ }
    }
    for (const child of pids) {
      const measured = memoryOf(child);
      rss += measured.rss;
      pss += measured.pss;
    }
  } catch { /* process could exit during sampling */ }
  return { rss, pss };
};

function run(command, args, { env, cwd, memory = false } = {}) {
  return new Promise((resolve, reject) => {
    const start = process.hrtime.bigint();
    const startAt = performance.now();
    const child = spawn(command, args, { env, cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let peakTree = 0;
    let peakPss = 0;
    const sample = memory && procFs && setInterval(() => {
      const { rss, pss } = memoryOf(child.pid);
      peakTree = Math.max(peakTree, rss);
      peakPss = Math.max(peakPss, pss);
    }, 50);
    child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
    const timeout = setTimeout(() => child.kill('SIGTERM'), 310_000);
    child.on('error', reject);
    child.on('close', (code, signal) => {
      clearInterval(sample);
      clearTimeout(timeout);
      if (signal) return reject(new Error(`${command} terminated by ${signal}`));
      const markers = Object.fromEntries([...stderr.matchAll(/^@@perf (\w+) (\d+)$/gm)]
        .map(([, label, stamp]) => [label, Number(BigInt(stamp) - start) / 1e6]));
      resolve({
        code, stdout, stderr, markers, startAt, peakTree, peakPss,
        ms: Number(process.hrtime.bigint() - start) / 1e6,
      });
    });
  });
}

const localBrowsers = process.env.PLAYWRIGHT_BROWSERS_PATH;
const commonEnv = {
  PATH: path, LANG: 'C.UTF-8', TZ: 'UTC', NO_PROXY: '*',
  npm_config_audit: 'false', npm_config_fund: 'false', npm_config_update_notifier: 'false',
  npm_config_ignore_scripts: 'true',
  ...(localBrowsers ? { PLAYWRIGHT_BROWSERS_PATH: resolve(localBrowsers), PLAYWRIGHT_SKIP_BROWSER_GC: '1' } : {}),
};
function size(dir) {
  return readdirSync(dir, { withFileTypes: true }).reduce((total, ent) => {
    const file = join(dir, ent.name);
    return total + (ent.isDirectory() ? size(file) : ent.isFile() ? statSync(file).size : 0);
  }, 0);
}

function check(result, status) {
  assert.equal(result.code, status, result.stderr || result.stdout);
}

async function install(entry, mirror, work) {
  const home = join(work, 'home');
  mkdirSync(home, { recursive: true });
  const env = {
    ...commonEnv,
    HOME: home, TMPDIR: work, XDG_CACHE_HOME: join(home, '.cache'),
    npm_config_cache: join(work, 'npm'), npm_config_registry: mirror.url,
    npm_config_userconfig: join(home, ".npmrc"), npm_config_globalconfig: join(work, "global-npmrc"),
  };
  const before = mirror.bytes();
  const runResult = await run('npx', ['--yes', 'edition-paper', '--version'], {
    cwd: work,
    env: { ...env, NODE_OPTIONS: `--require "${probe}"`, EDITION_PERF_MARK_ENTRY: '1' },
  });
  check(runResult, 0);
  assert.equal(runResult.stdout.trim(), '1.0.0');
  assert(Number.isFinite(runResult.markers.entry), 'npx must reach the CLI entry marker');
  const npx = join(work, 'npm', '_npx');
  const modules = join(npx, readdirSync(npx).find((name) => !name.startsWith('.')), 'node_modules');
  const cli = join(modules, 'edition-paper', 'cli.mjs');
  return {
    cli, env,
    installMs: runResult.markers.entry,
    npxMs: runResult.ms,
    tarballBytes: mirror.bytes() - before,
    unpackedBytes: size(modules),
    ownBytes: size(join(modules, 'edition-paper')),
    dependencies: Object.keys(JSON.parse(readFileSync(join(modules, '.package-lock.json'), 'utf8')).packages).length - 1,
    archives: entry.archives.map((file) => basename(file)),
  };
}

function pdfSignature(file, cwd) {
  const tool = (cmd, args) => {
    const result = spawnSync(cmd, args, { cwd, maxBuffer: 16 * 1024 * 1024 });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, result.stderr.toString());
    return result.stdout;
  };
  const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
  const summary = tool('pdfinfo', [file]).toString();
  const pages = Number(/^Pages:\s+(\d+)/m.exec(summary)[1]);
  const pageSizes = tool('pdfinfo', ['-f', '1', '-l', String(pages), file]).toString()
    .split('\n').filter((line) => /^Page\s+\d+\s+size:/.test(line));
  const prefix = join(cwd, 'raster');
  tool('pdftoppm', ['-r', '96', file, prefix]);
  const raster = readdirSync(cwd).filter((name) => /^raster-.*\.ppm$/.test(name)).sort().map((name) => {
    const path = join(cwd, name);
    const digest = hash(readFileSync(path));
    rmSync(path);
    return digest;
  });
  assert.equal(raster.length, pages);
  assert.equal(pageSizes.length, pages);
  return { pages, pageSizes, text: hash(tool('pdftotext', ['-layout', file, '-'])), raster };
}

const samples = Object.fromEntries(Object.keys(cases).map((key) => [key, {
  install: [], warm: [], help: [], version: [], memory: [], pdfs: {}, contract: {},
}]));
const mirrors = [];
let fixture;
try {
  fixture = await fixtureServer();
  for (const [id, entry] of Object.entries(cases)) mirrors.push({ id, entry, ...await registry(entry.archives) });
  for (let iteration = 0; iteration < repeats; iteration++) {
    // Rotate case order to keep caches and host contention from always
    // favoring the same revision. No measurements overlap.
    for (let offset = 0; offset < mirrors.length; offset++) {
      const mirror = mirrors[(offset + iteration) % mirrors.length];
      const sample = samples[mirror.id];
      const work = mkdtempSync(join(root, `${mirror.id}-`));
      const { cli, env, ...measurement } = await install(mirror.entry, mirror, work);
      sample.install.push(measurement);
      for (const flag of ['help', 'version']) {
        const result = await run(node, [cli, `--${flag}`], { env, cwd: work });
        check(result, 0);
        sample[flag].push(result.ms);
        if (iteration === 0) {
          const traced = await run(node, [cli, `--${flag}`], { env: { ...env, NODE_DEBUG: 'esm,module' }, cwd: work });
          check(traced, 0);
          sample.contract[flag] = result.stdout;
          sample.contract[`${flag}LoadsBrowser`] = /(?:node_modules|vendor)\/playwright-core\//.test(traced.stderr);
        }
      }

      const render = async (name, memory = false, signature = false, browser = 'auto') => {
        fixture.select(name);
        const out = mkdtempSync(join(work, `${name}-`));
        const lpr = join(out, 'lpr.txt');
        const timeLog = join(out, 'time.txt');
        const args = [
          '--require', probe, cli, '--setup', setup, '--url', fixture.url, '--out', out,
          '--browser', browser, '--printer', 'Fixture Printer',
        ];
        const result = await run(memory ? time : node, memory ? ['-v', '-o', timeLog, node, ...args] : args, {
          env: { ...env, EDITION_PERF_LPR: lpr }, cwd: work, memory,
        });
        const count = fixtures[name];
        check(result, count ? 0 : 1);
        const file = join(out, readdirSync(out).find((name) => /^edition-\d{4}-\d\d-\d\d\.pdf$/.test(name)));
        assert(Number.isFinite(result.markers.pdf), 'must measure the completed PDF write');
        assert(result.stdout.includes(`Edition saved: ${file} (${count} stories)`));
        if (count) assert.equal(readFileSync(lpr, 'utf8'), `-P\nFixture Printer\n${file}\n`);
        else assert(!readdirSync(out).includes('lpr.txt'));
        if (signature) {
          sample.pdfs[`${browser}/${name}`] = pdfSignature(file, out);
          const normalize = (text) => text.replaceAll(fixture.url, '<origin>').replaceAll(out, '<out>')
            .replace(/@@perf pdf \d+\n/g, '').replace(/\d{4}-\d\d-\d\d \d\d:\d\d/g, '<stamp>');
          sample.contract[`${browser}/${name}`] = [normalize(result.stdout), normalize(result.stderr), result.code];
        }
        if (memory) {
          const log = readFileSync(timeLog, 'utf8');
          sample.memory.push({
            timeKiB: Number(/Maximum resident set size \(kbytes\):\s+(\d+)/.exec(log)[1]),
            treeKiB: result.peakTree,
            pssKiB: result.peakPss,
          });
        }
        const requests = (type) => fixture.requests.filter((request) => request.type === type);
        const startOf = (type) => requests(type)[0].start - result.startAt;
        const endOf = (type) => Math.max(...requests(type).map((request) => request.end)) - result.startAt;
        return {
          pdf: result.markers.pdf,
          exit: result.ms,
          beforeRequest: startOf('paper'),
          navigation: endOf('paper') - startOf('paper'),
          compose: endOf('stories') - endOf('paper'),
          pictures: endOf('image') - endOf('stories'),
          afterPictures: result.markers.pdf - endOf('image'),
        };
      };

      sample.warm.push(await render('daily', false, iteration === 0));
      if (iteration < 3 && !mirror.entry.warmOnly) await render('large', true, iteration === 0);
      if (iteration === 0 && !mirror.entry.warmOnly) {
        for (const name of ['mixed', 'empty']) await render(name, false, true);
        if (localBrowsers) await render('daily', false, true, 'chromium');
      }
      console.error(`${mirror.id} ${iteration + 1}/${repeats} · warm ${sample.warm.at(-1).pdf.toFixed(1)} ms · npx install ${measurement.installMs.toFixed(1)} ms`);
      rmSync(work, { recursive: true, force: true });
    }
  }
} finally {
  for (const { server } of [fixture, ...mirrors].filter(Boolean)) {
    server.closeAllConnections();
    server.close();
  }
  rmSync(root, { force: true, recursive: true });
}
console.log(JSON.stringify(samples, null, 2));
