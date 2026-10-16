# edition-paper

Edition's morning paper, printed.

[edition.cafe/paper](https://edition.cafe/paper) typesets your sources onto one A4
paper. `edition-paper` saves that page as a PDF and sends it to your printer. On a
Mac it can do that every morning at 8am.

It is a small command-line tool. There is no account and nothing to clone. You need
Node 20 or newer and a browser to render the page with: your own Google Chrome if
it's installed, otherwise Playwright's Chromium.

## Quick start

1. Open [edition.cafe/paper](https://edition.cafe/paper) on a computer and click
   **Copy 8am command**. The button copies a line like this, ready to paste into a
   terminal:

   ```
   npx edition-paper --setup W3siaWQiOiJoYWNrZXItbmV3cyIs…
   ```

   A page from before this package copies `npm run paper -- --setup …` instead.
   Keep the part from `--setup` on and put `npx edition-paper` in front.

2. Try it once without printing:

   ```
   npx edition-paper --setup W3siaWQiOiJoYWNrZXItbmV3cyIs… --no-print
   ```

   The paper lands in `~/Documents/Editions/edition-<date>.pdf`.

3. Schedule it (macOS):

   ```
   npx edition-paper --setup W3siaWQiOiJoYWNrZXItbmV3cyIs… --install-schedule 0800 --printer "My Printer"
   ```

   Leave out `--printer` to use your default printer, or use `--no-print` to keep
   PDFs only. `lpstat -p` lists your printers' names.

Every run saves the PDF first, so you have the paper even when printing fails or
is switched off.

## Flags

| Flag | What it does |
|---|---|
| `--setup <param>` | Your sources, as copied from edition.cafe/paper. Required. |
| `--no-print` | Save the PDF only. |
| `--printer <name>` | Print on this printer (CUPS `lpr -P`). Without it, the default printer. |
| `--out <dir>` | Where PDFs go. Default `~/Documents/Editions`. Files are named `edition-<date>.pdf` by your local date; a second run on the same day replaces that day's file. |
| `--install-schedule <HHMM>` | macOS: run every day at HHMM, 24-hour (`0800`, or `08:00`). Uses the other flags you pass with it. |
| `--uninstall-schedule` | macOS: remove the daily run. |
| `--browser <auto\|chrome\|chromium>` | `auto` (default) uses Google Chrome if it's installed, else Playwright's Chromium. |
| `--url <origin>` | The Edition to load. Default `https://edition.cafe`; `http://localhost:5173` for a dev server (`npm run dev` in a clone of the app). |
| `-h`, `--help` | Show the flags. |
| `-v`, `--version` | Show the version. |

## What it sends, and where

- **One page request with your setup in it.** The CLI opens
  `https://edition.cafe/paper?setup=<param>` in a headless browser on your computer.
  The parameter is your list of sources (names, feed addresses, subreddits) as
  base64url-encoded JSON. It is encoded, not encrypted, and it travels in the query
  string, so edition.cafe's host (Vercel) receives it with the request, like any page
  address. The app leaves out what it treats as private, and tells you so when it
  copies the command: a Reddit front page, and any feed whose address has a query
  string, a `#` fragment, a username or password, a non-standard port, or a private
  host such as `localhost`. It can't see a key inside the path itself, like a
  Pinboard `secret:` feed or a podcast's private feed; that address goes along like
  any other, so leave such a feed off your front page before you copy.
- **Your sources, fetched by the page.** /paper then loads your sources the way it
  does when you open it yourself: some straight from the source (Hacker News,
  Reddit, Are.na), most other feeds through edition.cafe's own proxy, and pictures
  from wherever they are hosted.
- **Nothing from the CLI itself.** No telemetry, no update checks, no account.
- **No analytics.** Edition's site leaves its analytics (PostHog) off in automated
  browsers. It checks `navigator.webdriver`, which Playwright sets, so a run of this
  CLI never counts as a visit. The CLI also blocks every request to PostHog's
  servers in its browser, so that stays true even if the site's check changes.
- **Your printer.** The PDF goes to CUPS with `lpr`, on your computer.

On disk it writes the PDF and, on a Mac with a schedule, the files listed below.
The browser runs with a temporary profile that is deleted when the run ends; it
never touches your Chrome profile, history or cookies.

## How the schedule works (macOS)

`--install-schedule 0800` does four things:

1. It checks that a browser starts, so a missing browser shows up now rather than
   at 8am in a log.
2. It copies this exact version of edition-paper, with the one library it needs
   (`playwright-core`), to `~/Library/Application Support/Edition/paper/`.
3. It writes a launchd agent, `~/Library/LaunchAgents/com.edition.paper.plist`,
   which runs that copy every day at 08:00 with the absolute path of your `node`.
   launchd starts jobs with a bare PATH and no shell profile, so nothing in the
   agent is looked up by name.
4. It loads the agent with `launchctl`.

**Why a copy, not `npx` every morning.** `npx` runs packages from a cache that npm
may clear at any time. Asking for `edition-paper@1` at 8am would also mean a
registry lookup every morning and, after any new release, new code running
unattended on your Mac without you having asked for it. The copy runs the version
you ran when you set it up, from a folder that changes only when you install again.
To update, run your install command again as `npx edition-paper@latest …`.

**Which node.** The agent records the node you ran the install with. With Homebrew
it records the stable `/opt/homebrew/bin/node` (or `/usr/local/bin/node`), not the
versioned folder that `brew upgrade` deletes. If you remove that node (say, an nvm
version), run the install again.

**When it runs.** If your Mac is asleep at 08:00, launchd runs the job when it
wakes. If it is shut down, that morning's paper is skipped.

**Logs.** `~/Library/Logs/edition-paper.log`. Each run starts with a dated line.

**Try it now** instead of waiting for tomorrow:

```
launchctl kickstart gui/$(id -u)/com.edition.paper
```

It's worth doing once. macOS guards the Documents folder, and the scheduled job may
be asked whether `node` can write there. Better to answer that while you're at
the Mac than to miss it at 8am.

There is one schedule at a time: installing again replaces it, including one set up
earlier from Edition's repository.

## Linux and Windows

There's no built-in schedule there. `--install-schedule` installs nothing and exits
with a ready-made line instead:

- **Linux and other Unix systems:** a cron line to add with `crontab -e`. It
  runs this exact version through `npx` with an absolute PATH, for example:

  ```
  0 8 * * * PATH=/home/you/.nvm/versions/node/v24.13.0/bin:/usr/bin:/bin npx --yes edition-paper@1.0.0 --setup W3siaWQiOi… >> "$HOME/edition-paper.log" 2>&1
  ```

  Printing goes through CUPS (`lpr`), as on a Mac.
- **Windows:** a line to save as a `.cmd` file and schedule daily in Task
  Scheduler. Windows has no `lpr`, so there the paper is a PDF only.

## Uninstall

```
npx edition-paper --uninstall-schedule
```

This unloads and deletes the agent and the copy in Application Support. Your PDFs
and the log stay. To remove those too:

```
rm -r ~/Documents/Editions ~/Library/Logs/edition-paper.log
```

If you installed Playwright's Chromium for this, it lives in
`~/Library/Caches/ms-playwright` (macOS) or `~/.cache/ms-playwright` (Linux). npx
keeps its own copy of edition-paper in npm's cache (`~/.npm/_npx`).

## When something goes wrong

- **"No browser to print with."** Install Google Chrome, or run the one command the
  message gives you, `npx playwright@<version> install chromium` (about 150 MB). The
  version is pinned to the Playwright this CLI uses, so the browser matches.
- **"No stories rendered; not sending to the printer."** The page loaded but had
  nothing from the last 24 hours, or no source answered. The PDF is still saved, so
  you can open it and see which sections say "Could not reach".
- **"Printing failed."** Check the printer name with `lpstat -p`. The PDF is saved
  either way.
- **"Operation not permitted" in the log (macOS).** macOS is guarding
  `~/Documents`. Allow `node` in System Settings → Privacy & Security → Files and
  Folders, or install the schedule again with `--out` pointing somewhere else, such
  as `~/Editions`.
- **It waits, then prints anyway.** The CLI gives the page 90 seconds to finish
  composing and then prints what has settled. A run that hangs is stopped after five
  minutes.
- **"Printing without 1 picture that never loaded: …"** Once the page is composed,
  the CLI gives its pictures up to 20 seconds more, then prints. That line names
  each picture that failed or was still loading, so an empty frame on the paper has
  a reason in the log: usually the site hosting that picture was down or slow.

## License

BSD-3-Clause. Copyright (c) 2026, Domenico Plumitallo. See [LICENSE](LICENSE).
