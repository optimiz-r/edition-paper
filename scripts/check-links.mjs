#!/usr/bin/env node
/**
 * Runs before `npm publish` (prepublishOnly). npm turns package.json's
 * `repository`, `bugs` and `homepage` into the "Repository", "Issues" and
 * "Homepage" links on the package's page, and a published version keeps them.
 * Publishing while one of them answers 404 — the GitHub repo not created yet,
 * or still private — ships a dead link to every reader who checks where the
 * code comes from. So: every link must load, signed out, or nothing is
 * published. Fix the page or the field, then publish again.
 *
 * Not part of the package (see "files" in package.json).
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** [field, https URL] for each link npm shows on the package page. */
export function packageLinks(pkg) {
  const url = (value) => (typeof value === 'string' ? value : value?.url);
  const links = [];
  const repository = url(pkg.repository);
  if (repository) {
    links.push(['repository', repository.replace(/^git\+/, '').replace(/\.git$/, '')]);
  }
  const bugs = url(pkg.bugs);
  if (bugs) links.push(['bugs', bugs]);
  if (pkg.homepage) links.push(['homepage', pkg.homepage]);
  return links;
}

async function main() {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  let dead = 0;
  for (const [field, href] of packageLinks(pkg)) {
    let status;
    try {
      // No credentials: this is what a stranger on npmjs.com gets.
      status = (await fetch(href, { redirect: 'follow', signal: AbortSignal.timeout(15000) })).status;
    } catch (error) {
      status = error.message;
    }
    const ok = status === 200;
    if (!ok) dead++;
    console.log(`${ok ? 'ok  ' : 'DEAD'} ${field}: ${href} (${status})`);
  }
  if (dead > 0) {
    console.error(
      'Not publishing: package.json links to pages a reader cannot open. Make the repo public (or drop the field), then publish again.'
    );
    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
