import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';

const [file, browserFile, parityFile] = process.argv.slice(2);
const results = JSON.parse(readFileSync(file, 'utf8'));
const browser = browserFile ? JSON.parse(readFileSync(browserFile, 'utf8')) : {};
const parity = parityFile ? JSON.parse(readFileSync(parityFile, 'utf8')) : undefined;
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
const pss = (data) => data.memory.map((run) => run.pssKiB);
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
const parityReference = parity?.['1.0.0']?.signatures?.[0];
const completeParity = (id) => {
  const { signatures, contracts } = parity[id];
  return signatures.length === contracts.length && signatures.length > 0
    && signatures.every((signature) => isDeepStrictEqual(signature, parityReference))
    && contracts.every((contract) => contract['auto/large'][1].trim() === '');
};
const parityCells = parity && ['1.0.0', 'main', 'current'].map((id) =>
  `${parity[id].signatures.length} × ${Object.keys(parityReference).length} PDFs; ${completeParity(id) ? 'match' : 'differ'}`
);
console.log('| Target | 1.0.0 | Main | Current | Requirement | Result |');
console.log('| --- | --- | --- | --- | --- | --- |');
console.log(`| T1 Warm to PDF | ${show((data) => ms(warm(data)))} | ≤50% of both baseline medians | ${verdict(current && both((base) => median(warm(current)) <= 0.5 * median(warm(base))))} |`);
console.log(`| T2 Cold install | ${show(cold)} | ≥40% less time and archive bytes vs both | ${verdict(current && both((base) => median(install(current)) <= 0.6 * median(install(base)) && bytes(current) <= 0.6 * bytes(base)))} |`);
console.log(`| T3 Browser onboarding | ${t3} | Name, size and progress ≤2 s; reuse installed browser | ${browser.current ? verdict(browser.current.pass) : 'UNMEASURED'} |`);
console.log(`| T4 Peak large-edition memory | ${show((data) => `PSS ${pss(data).every(Number.isFinite) ? mib(pss(data)) : 'unmeasured'}; tree RSS ${mib(tree(data))}; GNU time ${mib(data.memory.map((run) => run.timeKiB))}`)} | Median tree PSS ≤ both baseline medians; all PSS samples ≤1 GB | ${verdict(current && both((base) => median(pss(current)) <= median(pss(base))) && Math.max(...pss(current)) * 1024 <= 1e9)} |`);
console.log(`| T5 Info flags | ${show(fast)} | All ≤150 ms; no Playwright import | ${verdict(current && ['help', 'version'].every((flag) => Math.max(...current[flag]) <= 150 && !current.contract[`${flag}LoadsBrowser`]))} |`);
const parityPass = parity ? ['1.0.0', 'main', 'current'].every(completeParity) : current && both((base) => allPdfsMatch(current, base));
console.log(`| T6 PDF parity | ${parity ? parityCells.join(' | ') : show(equivalent)} | Exact text, page count/size, and raster parity against both | ${verdict(parityPass)} |`);
for (const [id, data] of Object.entries(results)) {
  console.log(`\n${id} median phase times`);
  for (const key of ['beforeRequest', 'navigation', 'compose', 'pictures', 'afterPictures', 'exit']) {
    console.log(`  ${key}: ${ms(data.warm.map((run) => run[key]))}`);
  }
  console.log(`  npx complete: ${ms(data.install.map((run) => run.npxMs))}`);
  console.log(`  after PDF write to exit: ${ms(data.warm.map((run) => run.exit - run.pdf))}`);
  console.log(`  warm to PDF: ${ms(warm(data))}; install: ${cold(data)}`);
  if (data !== published) {
    console.log(`  matching published contract logs and statuses: ${isDeepStrictEqual(data.contract, published.contract)}`);
    console.log(`  differing PDFs vs published: ${Object.keys(data.pdfs).filter((name) => !isDeepStrictEqual(data.pdfs[name], published.pdfs[name])).join(', ') || 'none'}`);
    console.log(`  differing PDFs vs main: ${Object.keys(data.pdfs).filter((name) => !isDeepStrictEqual(data.pdfs[name], main.pdfs[name])).join(', ') || 'none'}`);
  }
}
