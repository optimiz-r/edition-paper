# edition-paper 1.1.0 Mac smoke check

Allow about ten minutes of hands-on time, plus the Chromium download if the connection is slow. Before starting, have the `edition-paper-1.1.0.tgz` candidate on a Mac with Node 20 or newer, Google Chrome, and access to a test printer. Use a disposable macOS login because installing replaces that user's edition-paper schedule. Copy a setup value from an edition that has stories and pictures today.

1. **Install the candidate.** Set `archive` to its absolute local path, then run the following. When prompted, paste just the value after `--setup` from the copied command.

   ```sh
   scratch=$(mktemp -d)
   cd "$scratch"
   npm init -y
   npm install "$archive"
   paper="$scratch/node_modules/.bin/edition-paper"
   "$paper" --version
   npm ls playwright-core
   printf 'Paste the setup value and press Return: '
   IFS= read -r setup
   ```

   Expect edition-paper `1.1.0` and Playwright Core `1.65.1`.

2. **Render with a fresh Chromium cache.** Confirm the install names the headless shell and that a readable A4 PDF appears with stories and pictures.

   ```sh
   browser_cache="$scratch/browsers"
   PLAYWRIGHT_BROWSERS_PATH="$browser_cache" EDITION_PAPER_INSTALL_CHROMIUM=1 \
     "$paper" --setup "$setup" --browser chromium --no-print --out "$scratch/managed"
   ```

3. **Render with installed Chrome.** Confirm a readable PDF appears in the second folder and the run starts without a browser download.

   ```sh
   "$paper" --setup "$setup" --browser chrome --no-print --out "$scratch/chrome"
   ```

4. **Install and trigger a PDF-only launchd job.** Use the same Chromium cache. Confirm `plutil` accepts the file, its permissions are `600`, and kickstart produces a fresh PDF and a successful run in the log.

   ```sh
   PLAYWRIGHT_BROWSERS_PATH="$browser_cache" \
     "$paper" --setup "$setup" --browser chromium --no-print \
     --out "$scratch/scheduled" --install-schedule 0800
   agent="$HOME/Library/LaunchAgents/com.edition.paper.plist"
   plutil -lint "$agent"
   stat -f '%Lp' "$agent"
   launchctl kickstart "gui/$(id -u)/com.edition.paper"
   ```

   The install output gives the log path. Wait for `Edition saved` in that log and open the PDF in `scheduled/`.

5. **Make one real print.** Run `lpstat -p`, set `printer` to the chosen test queue, and send one job. Confirm one copy arrives and check the A4 size, margins and artwork. If the command times out, inspect the queue before retrying.

   ```sh
   "$paper" --setup "$setup" --browser chrome --printer "$printer" --out "$scratch/print"
   ```

Once done, run `"$paper" --uninstall-schedule` in the test login. Keep the PDFs and launchd log if a step failed. Record the macOS and Node versions, which steps passed, and which step needs a fix before release.
