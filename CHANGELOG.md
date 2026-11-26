# Changelog

## 1.1.0

- PDFs give late pictures, print backgrounds and fonts time to load. The CLI checks that picture sources have stopped changing before it writes the PDF.
- Browser and picture warnings hide HTTP URL credentials and query strings. Empty editions still save a PDF and skip printing. If the server returned an HTTP error, the message gives its status code.
- A stuck print submission uses the time remaining in the five-minute run limit. If submission times out, check the printer queue before retrying. Your PDF is saved.
- macOS checks the browser settings the scheduled job will use. If a replacement fails to load, the installer restores the previous files and tries to reload the previous job if it was active. The launchd file is readable only by its owner.
- Argument errors stay on one line, and macOS schedules preserve carriage returns in paths and printer names.

### Updating

- If you use Playwright's Chromium, run `npx playwright@1.65.1 install chromium --only-shell` in the browser cache you use for edition-paper. You can also opt into the download on a manual run by setting `EDITION_PAPER_INSTALL_CHROMIUM=1`. A working installed Chrome can be reused directly.
- Try the new command with `--no-print` first. Rerun the schedule setup command on macOS to update its saved copy. On Linux, regenerate and replace the cron recipe. See the README if you use a custom browser cache or Chromium executable.

### Limits

- The CLI waits up to 90 seconds for the page to finish composing and then up to 20 seconds for print resources. Slow or failed resources can still be missing from the PDF.
- The built-in schedule requires macOS. Linux uses a cron recipe, and the Windows recipe saves PDFs through Task Scheduler.
