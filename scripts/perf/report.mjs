import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';

const [file, browserFile] = process.argv.slice(2);
const results = JSON.parse(readFileSync(file, 'utf8'));
const browser = browserFile ? JSON.parse(readFileSync(browserFile, 'utf8')) : {};
const cases = ['1.0.0', 'main', 'current'].map((id) => results[id]);
const [published, main, current] = cases;
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const ms = (values) => `${median(values).toFixed(1)} [${Math.min(...values).toFixed(1)}–${Math.max(...values).toFixed(1)}] ms`;
const mib = (values) => `${(median(values) / 1024).toFixed(1)} [${(Math.min(...values) / 1024).toFixed(1)}–${(Math.max(...values) / 1024).toFixed(1)}] MiB`;
const warm = (data) => data.warm.map((run) => run.pdf);
const install = (data) => data.install.map((run) => run.installMs);
const tree = (data) => data.memory.map((run) => run.treeKiB);
const allPdfsMatch = (data, baseline) => Object.keys(baseline.pdfs).length > 0
  && Object.entries(baseline.pdfs).every(([name, pdf]) => isDeepStrictEqual(data.pdfs[name], pdf));
const both = (fn) => [published, main].every(fn);
const bytes = (data) => data.install[0].tarballBytes;
const verdict = (pass) => current ? (pass ? 'PASS' : 'FAIL') : '—';
const show = (formatter) => cases.map((data) => data ? formatter(data) : '—').join(' | ');
const cold = (data) => {
  const { ownBytes, unpackedBytes, dependencies } = data.install[0];
  return `${ms(install(data))}; ${bytes(data)} B archives; ${unpackedBytes} B unpacked (${ownBytes} B edition-paper); ${dependencies} deps`;
};
const fast = (data) => ['help', 'version'].map((flag) => `${flag} ${ms(data[flag])}`).join('; ');
const t3 = ['1.0.0', 'main', 'current'].map((id) => browser[id]?.summary ?? '—').join(' | ');
const equivalent = (data) => {
  const matches = [published, main].map((baseline) => allPdfsMatch(data, baseline) ? 'match' : 'differ');
  return `${Object.keys(data.pdfs).length} PDFs; ${matches.join(' / ')} vs 1.0.0 / main`;
};
console.log('| Target | 1.0.0 | Main | Current | Requirement | Result |');
console.log('| --- | --- | --- | --- | --- | --- |');
console.log(`| T1 Warm to PDF | ${show((data) => ms(warm(data)))} | ≤50% of both baseline medians | ${verdict(current && both((base) => median(warm(current)) <= 0.5 * median(warm(base))))} |`);
console.log(`| T2 Cold install | ${show(cold)} | ≥40% less time and archive bytes vs both | ${verdict(current && both((base) => median(install(current)) <= 0.6 * median(install(base)) && bytes(current) <= 0.6 * bytes(base)))} |`);
console.log(`| T3 Browser onboarding | ${t3} | Name, size and progress ≤2 s; reuse installed browser | ${verdict(current && browser.current?.pass)} |`);
console.log(`| T4 Large-edition RSS | ${show((data) => `tree ${mib(tree(data))}; GNU time ${mib(data.memory.map((run) => run.timeKiB))}; PSS ${mib(data.memory.map((run) => run.pssKiB))}`)} | Median tree ≤ both baseline medians; all samples ≤1 GB | ${verdict(current && both((base) => median(tree(current)) <= median(tree(base))) && Math.max(...tree(current)) * 1024 <= 1e9)} |`);
console.log(`| T5 Info flags | ${show(fast)} | All ≤150 ms; no Playwright import | ${verdict(current && ['help', 'version'].every((flag) => Math.max(...current[flag]) <= 150 && !current.contract[`${flag}LoadsBrowser`]))} |`);
console.log(`| T6 PDF parity | ${show(equivalent)} | Exact text, page count/size, and raster parity against both | ${verdict(current && both((base) => allPdfsMatch(current, base)))} |`);
for (const [id, data] of Object.entries(results)) {
  console.log(`\n${id} median phase times`);
  for (const key of ['beforeRequest', 'navigation', 'compose', 'pictures', 'afterPictures', 'exit']) {
    console.log(`  ${key}: ${ms(data.warm.map((run) => run[key]))}`);
  }
  console.log(`  npx complete: ${ms(data.install.map((run) => run.npxMs))}`);
  console.log(`  warm to PDF: ${ms(warm(data))}; install: ${cold(data)}`);
  if (data !== published) {
    console.log(`  matching published contract logs and statuses: ${isDeepStrictEqual(data.contract, published.contract)}`);
    console.log(`  differing PDFs vs published: ${Object.keys(data.pdfs).filter((name) => !isDeepStrictEqual(data.pdfs[name], published.pdfs[name])).join(', ') || 'none'}`);
    console.log(`  differing PDFs vs main: ${Object.keys(data.pdfs).filter((name) => !isDeepStrictEqual(data.pdfs[name], main.pdfs[name])).join(', ') || 'none'}`);
  }
}
