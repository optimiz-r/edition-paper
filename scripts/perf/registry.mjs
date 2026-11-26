import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { listen } from './fixtures.mjs';

export async function registry(archives) {
  const packages = new Map();
  const tarballs = new Map();
  let bytes = 0;
  for (const archive of archives) {
    const body = readFileSync(archive);
    const member = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' })
      .split('\n').find((name) => /^[^/]+\/package\.json$/.test(name));
    const manifest = JSON.parse(execFileSync('tar', ['-xOzf', archive, member]));
    const path = `/${manifest.name}/-/${basename(archive)}`;
    if (packages.has(manifest.name)) throw new Error(`Supply one tarball per package: ${manifest.name}`);
    packages.set(manifest.name, { manifest, path, body });
    tarballs.set(path, body);
  }
  const running = await listen((request, response) => {
    const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const tarball = tarballs.get(path);
    if (tarball) {
      bytes += tarball.length;
      response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': tarball.length });
      response.end(tarball);
      return;
    }
    const pkg = packages.get(path.slice(1));
    if (!pkg) {
      response.writeHead(404).end();
      return;
    }
    const { manifest, body } = pkg;
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({
      name: manifest.name,
      'dist-tags': { latest: manifest.version },
      versions: {
        [manifest.version]: {
          ...manifest,
          dist: {
            tarball: running.url + pkg.path,
            integrity: `sha512-${createHash('sha512').update(body).digest('base64')}`,
          },
        },
      },
    }));
  });
  return { ...running, editionPaperVersion: packages.get('edition-paper')?.manifest.version, bytes: () => bytes };
}
