# edition-paper performance harness

Run on Linux with Node 20+, npm, GNU time and Poppler (pdfinfo, pdftotext,
pdftoppm). The benchmark is opt-in and uses temporary homes, a loopback npm
mirror and edition server, and a fake lpr. It never invokes a scheduler.
Use package tarballs obtained before the timed run.

- Fetch the published archive and the exact dependency tarballs with
  `npm pack edition-paper@1.0.0 playwright-core@1.65.1 playwright-core@1.64.1`
  into a temporary directory. The first Playwright version reflects the
  measured fresh install, and the second is the main lockfile version.
- Export the baseline revision with `git archive e97ada5`, unpack to a
  temporary source directory, and run `npm pack` there.
- Run `npm ci` and `npm pack` from the candidate checkout. The
  package uses the Playwright Core version pinned in its lockfile. Include its
  archive in the benchmark manifest. The installed CLI runs without an npm
  install hook.

Example manifest

```json
{
  "1.0.0": { "archives": ["/tmp/published/edition-paper-1.0.0.tgz", "/tmp/playwright-core-1.65.1.tgz"] },
  "main": { "archives": ["/tmp/main/edition-paper-1.0.0.tgz", "/tmp/playwright-core-1.64.1.tgz"] },
  "current": { "archives": ["/tmp/current/edition-paper-1.1.0.tgz", "/tmp/playwright-core-1.65.1.tgz"] }
}
```

```sh
node scripts/perf/run.mjs /tmp/cases.json 9 > /tmp/perf-results.json
node scripts/perf/report.mjs /tmp/perf-results.json
```

The default Chrome path requires Google Chrome to be installed. To also check
the explicit managed Chromium path for PDF parity, set
`PLAYWRIGHT_BROWSERS_PATH` to a pre-populated cache with the browser builds
matching the selected Playwright versions. The harness never fetches these
browsers during a timed run.

Warm timing starts before the CLI is spawned and ends after the PDF write
completes, before Chromium shuts down or lpr is called. The loopback fixture
applies 300 ms per request, including the document, feed and each image.
Each warm sample records request paths and start/end times relative to CLI
spawn. The query string is excluded.
Cold timing starts before npx is spawned with an empty npm cache and ends
at entry to the CLI. Counts include runtime dependencies but exclude
edition-paper itself. Byte metrics include the CLI and its dependencies,
and count transferred archives and regular installed files separately.
Memory uses three independent 300-story runs per case, both GNU time's
maximum RSS and sampled totals for RSS and proportional set size (PSS)
across the process tree. RSS counts shared pages in each process. PSS
proportionally allocates shared pages. Set `"warmOnly": true` for an
intermediate revision to sample installation and warm runs without running
the large, mixed, empty and explicit managed Chromium cases. The pictures and failure
fixture also covers lazy images in shadow DOM and a missing image.
PDF comparisons use per-page sizes, layout-preserving extracted text and
a digest for each page rasterized at 96 DPI.

Validate parity separately with
`node scripts/perf/run.mjs /tmp/cases.json 3 parity > /tmp/parity.json`.
Use the two baselines and the final tarball in that manifest. The large
fixture serves the same 300 images from four loopback ports so browser
connection queues have time to deliver every image. Each still has 300 ms
latency. The mixed fixture holds one successful image for an additional 900 ms
in this mode and checks that only the broken image is reported. This mode
leaves the warm, install and memory scoring workload
alone. It also records memory separately for the complete large render.
Run directories are printed to stderr and retained.
Use a temporary directory outside an npm project for these runs so npx
resolves the mirror package instead of an enclosing checkout. On Linux keep
its path short enough for Chromium's Unix-domain socket.

Use `"installOnly": true` for a cold-install-only control. This permits
measuring npx's fixed overhead with a minimal tarball without a browser.

To measure Chromium onboarding independently, pass
`node scripts/perf/browser-download.mjs /tmp/browser-cases.json` a manifest
with each case's installed `cli`, upstream Playwright Core `installer` and
`archives` object pointing to local `chrome`, `shell`, and `ffmpeg` ZIPs.
Set `optIn: true` for the candidate's opt-in first render. The mirror adds
300 ms to archive responses, preserves content length and reports how many
bytes were actually transferred. Use browser archives for the selected
Playwright versions and host platform, with the upstream archive layout.
Pass the browser JSON as the second argument to report.mjs and the optional
parity JSON as the third.

## Print resource regression fixtures

On Linux with Poppler (`pdftoppm`, `pdffonts`) and the pinned Chromium shell
installed, run the six loopback fixtures with:

```sh
EDITION_PAPER_TEST_BROWSER=1 EDITION_PAPER_TEST_REPEATS=20 node --test test/readiness.test.mjs
```

Use `EDITION_PAPER_TEST_FONT` if DejaVu Sans Mono Bold is installed elsewhere.
For a contended run, pin the fixture command and its browser to one available
CPU with `taskset` and set `EDITION_PAPER_TEST_CPU_LOAD=1` to start a busy worker
on the same CPU. PDFs stay in the test's temporary directory.
