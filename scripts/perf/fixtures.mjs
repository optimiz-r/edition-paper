import { createServer } from 'node:http';
import { once } from 'node:events';
import { setTimeout } from 'node:timers/promises';

export const latency = 300;
export const fixtures = { daily: 12, large: 300, mixed: 4, empty: 0 };

function story(i, fixture, imageOrigin) {
  const image = `<img loading="lazy" width="160" height="90" alt="" src="${imageOrigin}/image/${i}">`;
  return `<article class="story"><h2>Story ${i} · Café</h2>
    <p>A short update from the fixture desk. The edition includes local news and letters.</p>
    ${fixture === 'mixed' && i === 1 ? '<fixture-picture></fixture-picture>' : image}</article>`;
}

function paper(fixture) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Fixture paper</title>
  <link rel="icon" href="data:,">
  <style>
    @page { margin: 14mm }
    body { font: 12px Georgia, serif; color: #222 }
    h1 { font-size: 30px } h2 { font-size: 16px }
    article { break-inside: avoid; border-bottom: 1px solid #999; margin-bottom: 8px }
    .print-columns { column-count: 2 }
    @media print { .screen { display: none } }
    @media screen { .print-columns { display: none } }
  </style></head><body><div class="screen">Screen edition</div><h1>The Fixture Daily</h1>
  <section class="print-columns"></section>
  <script>
    customElements.define('fixture-picture', class extends HTMLElement {
      connectedCallback() {
        this.attachShadow({mode:'open'}).innerHTML =
          '<img loading="lazy" alt="" width="160" height="90" src="/image/1">' +
          '<img loading="lazy" alt="" width="160" height="90" src="/broken">';
      }
    });
    fetch('/stories/${fixture}').then(r => r.json()).then(html => {
      document.querySelector('.print-columns').innerHTML = html;
      document.documentElement.dataset.editionReady = 'true';
    });
  </script></body></html>`;
}

const image = (i) => `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360">
<rect width="640" height="360" fill="hsl(${i * 43 % 360},40%,60%)"/>
<circle cx="${60 + i % 100}" cy="110" r="58" fill="#234"/>
<path d="M0 360 240 145 390 300 640 135V360Z" fill="#ddd"/></svg>`;

export async function listen(handler) {
  const server = createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}

export async function fixtureServer({ largeImageShards = 1 } = {}) {
  let fixture = 'daily';
  const requests = [];
  const servers = [];
  const handler = async (request, response) => {
    const path = new URL(request.url, 'http://localhost').pathname;
    const start = performance.now();
    await setTimeout(latency);
    const [, type, name] = path.split('/');
    if (type === 'paper') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(paper(fixture));
    } else if (type === 'stories' && Object.hasOwn(fixtures, name)) {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(Array.from({ length: fixtures[name] }, (_, i) => {
        const imageOrigin = name === 'large' && largeImageShards > 1 ? servers[i % largeImageShards].url : '';
        return story(i + 1, name, imageOrigin);
      }).join('')));
    } else if (type === 'image') {
      response.writeHead(200, { 'Content-Type': 'image/svg+xml' });
      response.end(image(Number(name)));
    } else {
      response.writeHead(404).end();
    }
    requests.push({ type, start, end: performance.now() });
  };
  for (let i = 0; i < largeImageShards; i++) servers.push(await listen(handler));
  return { ...servers[0], servers, requests, select: (name) => { fixture = name; requests.length = 0; } };
}
