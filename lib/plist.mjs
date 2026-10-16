import { isAbsolute } from 'node:path';

export const LABEL = 'com.edition.paper';

// XML 1.0 can't carry these at all, escaped or not.
const XML_FORBIDDEN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/;

export function escapeXml(value) {
  const text = String(value);
  if (XML_FORBIDDEN.test(text)) {
    throw new Error('A scheduled argument contains a control character launchd cannot store.');
  }
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

/**
 * The launchd agent for the daily run. launchd starts jobs with a minimal
 * PATH and no shell, so the program and every file it names must be an
 * absolute path; this refuses anything else rather than writing an agent
 * that fails silently at 8am.
 */
export function buildPlist({ node, script, args, hour, minute, log }) {
  for (const [name, path] of Object.entries({ node, script, log })) {
    if (typeof path !== 'string' || !isAbsolute(path)) {
      throw new Error(`The schedule needs an absolute ${name} path, got ${JSON.stringify(path)}.`);
    }
  }
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw new Error(`Bad hour ${hour}.`);
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) throw new Error(`Bad minute ${minute}.`);

  const programArguments = [node, script, ...args]
    .map((arg) => `    <string>${escapeXml(arg)}</string>`)
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${programArguments}
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key><integer>${hour}</integer>
    <key>Minute</key><integer>${minute}</integer>
  </dict>
  <key>StandardOutPath</key><string>${escapeXml(log)}</string>
  <key>StandardErrorPath</key><string>${escapeXml(log)}</string>
</dict>
</plist>
`;
}
