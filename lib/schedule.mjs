import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { delimiter, dirname, isAbsolute, join } from 'node:path';
import { scheduledArgs } from './args.mjs';
import { buildPlist, LABEL } from './plist.mjs';

/** Every file the macOS schedule touches, from one home directory. */
export function schedulePaths(home) {
  const supportDir = join(home, 'Library', 'Application Support', 'Edition');
  return {
    plist: join(home, 'Library', 'LaunchAgents', `${LABEL}.plist`),
    // Pre-rebrand agent from the app repo; removed on any (re)install or
    // uninstall so an old schedule can't keep printing alongside this one.
    legacyPlist: join(home, 'Library', 'LaunchAgents', 'com.newspal.paper.plist'),
    supportDir,
    runnerDir: join(supportDir, 'paper'),
    log: join(home, 'Library', 'Logs', 'edition-paper.log'),
  };
}

const safeRealpath = (path) => {
  try {
    return realpathSync(path);
  } catch {
    return undefined;
  }
};

/**
 * The node binary launchd should start. process.execPath is resolved, so
 * under Homebrew it points into a versioned Cellar folder that the next
 * `brew upgrade` deletes. If a PATH entry (e.g. /opt/homebrew/bin/node) is
 * a link to this same binary, that stable name is used instead.
 */
export function stableNodePath(execPath = process.execPath, pathEnv = process.env.PATH ?? '', realpath = safeRealpath) {
  const target = realpath(execPath) ?? execPath;
  for (const dir of pathEnv.split(delimiter)) {
    if (!dir || !isAbsolute(dir)) continue;
    const candidate = join(dir, 'node');
    if (realpath(candidate) === target) return candidate;
  }
  return execPath;
}

/** Finds an installed package the way Node does: node_modules, walking up. */
function findPackageDir(fromDir, name) {
  for (let dir = fromDir; ; dir = dirname(dir)) {
    const candidate = join(dir, 'node_modules', name);
    if (existsSync(join(candidate, 'package.json'))) return candidate;
    if (dirname(dir) === dir) return undefined;
  }
}

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

/**
 * Copies this package (its published files) and its runtime dependencies
 * into runnerDir, so the scheduled job never depends on the npx cache, a
 * registry lookup, or a newer release than the one the reader ran. Swaps
 * the folder in whole so a failed copy leaves the previous runner intact.
 */
export function copyRunner(packageDir, runnerDir) {
  if (existsSync(runnerDir) && safeRealpath(runnerDir) === safeRealpath(packageDir)) {
    return; // already running from the runner; nothing to copy
  }
  const staging = `${runnerDir}.new-${process.pid}`;
  const previous = `${runnerDir}.old-${process.pid}`;
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  try {
    const pkg = readJson(join(packageDir, 'package.json'));
    for (const entry of ['package.json', ...(pkg.files ?? [])]) {
      const from = join(packageDir, entry);
      if (existsSync(from)) cpSync(from, join(staging, entry), { recursive: true, dereference: true });
    }
    const pending = Object.keys(pkg.dependencies ?? {}).map((name) => [packageDir, name]);
    const copied = new Set();
    while (pending.length > 0) {
      const [from, name] = pending.shift();
      if (copied.has(name)) continue;
      const dir = findPackageDir(from, name);
      if (!dir) throw new Error(`Could not find ${name}, which edition-paper needs. Try npx edition-paper again.`);
      cpSync(dir, join(staging, 'node_modules', name), { recursive: true, dereference: true });
      copied.add(name);
      for (const dep of Object.keys(readJson(join(dir, 'package.json')).dependencies ?? {})) {
        pending.push([dir, dep]);
      }
    }
    rmSync(previous, { recursive: true, force: true });
    if (existsSync(runnerDir)) renameSync(runnerDir, previous);
    renameSync(staging, runnerDir);
    rmSync(previous, { recursive: true, force: true });
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    throw error;
  }
}

const shellQuote = (arg) => (/^[A-Za-z0-9_\-./:=@,+]+$/.test(arg) ? arg : `'${arg.replaceAll("'", `'\\''`)}'`);
// In a .cmd file %VAR% expands, so a literal % is written %%.
const cmdQuote = (arg) => {
  const text = arg.replaceAll('%', '%%');
  return /[\s&|<>^"]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

/**
 * What to do instead on Linux, Windows and the rest: launchd is macOS only.
 * Prints a ready line for cron or Task Scheduler that runs this exact
 * version through npx, so nothing has to be installed globally.
 */
export function otherPlatformHint({ platform, options, version, nodePath = process.execPath }) {
  const { hour, minute } = options.time;
  const hhmm = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  const spec = `edition-paper@${version}`;
  const lines = [`The 8am schedule is built in only on macOS (launchd). Nothing was installed.`, ''];

  if (platform === 'win32') {
    const args = scheduledArgs({ ...options, print: false });
    lines.push(
      `On Windows, save this line as edition-paper.cmd, then schedule that file daily at ${hhmm}`,
      'in Task Scheduler (Create Basic Task → Daily → Start a program):',
      '',
      `npx --yes ${spec} ${args.map(cmdQuote).join(' ')}`,
      '',
      'Printing from the command line needs CUPS, so on Windows the paper is saved as a PDF only.'
    );
  } else {
    const args = scheduledArgs(options);
    const nodeDir = dirname(nodePath);
    // cron runs with PATH=/usr/bin:/bin and treats % as a newline.
    const command = `PATH=${shellQuote(`${nodeDir}:/usr/bin:/bin`)} npx --yes ${spec} ${args.map(shellQuote).join(' ')} >> "$HOME/edition-paper.log" 2>&1`;
    lines.push(
      `On Linux and other Unix systems, run crontab -e and add this line for ${hhmm} every day:`,
      '',
      `${minute} ${hour} * * * ${command.replaceAll('%', '\\%')}`,
      '',
      'cron uses the computer\'s clock. Output goes to ~/edition-paper.log.'
    );
  }
  return lines.join('\n');
}

const defaultExec = (command, args) => execFileSync(command, args, { stdio: 'pipe' });

function removeAgent(path, { exec, uid }) {
  try {
    exec('launchctl', ['bootout', `gui/${uid}`, path]);
  } catch {
    // not loaded; nothing to boot out
  }
  try {
    unlinkSync(path);
  } catch {
    // already gone
  }
}

/**
 * Writes and loads the launchd agent. On other platforms it installs
 * nothing and returns the cron / Task Scheduler hint. Returns { ok, message }.
 */
export async function installSchedule({
  options,
  platform = process.platform,
  home,
  packageDir,
  version,
  nodePath = stableNodePath(),
  uid = process.getuid?.(),
  exec = defaultExec,
  preflight = async () => {},
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  if (platform !== 'darwin') {
    return { ok: false, message: otherPlatformHint({ platform, options, version, nodePath }) };
  }

  // A schedule that can't find a browser would only fail at 8am, in a log
  // nobody reads. Find out now.
  await preflight(options.browser);

  const paths = schedulePaths(home);
  copyRunner(packageDir, paths.runnerDir);

  const plist = buildPlist({
    node: nodePath,
    script: join(paths.runnerDir, 'cli.mjs'),
    args: scheduledArgs(options),
    hour: options.time.hour,
    minute: options.time.minute,
    log: paths.log,
  });
  mkdirSync(dirname(paths.plist), { recursive: true });
  mkdirSync(dirname(paths.log), { recursive: true });
  removeAgent(paths.legacyPlist, { exec, uid });
  removeAgent(paths.plist, { exec, uid });
  writeFileSync(paths.plist, plist);
  try {
    try {
      exec('launchctl', ['bootstrap', `gui/${uid}`, paths.plist]);
    } catch {
      // launchd can still be tearing down the agent we just booted out
      // ("Bootstrap failed: 5"); one retry after a beat covers it.
      await sleep(1000);
      exec('launchctl', ['bootstrap', `gui/${uid}`, paths.plist]);
    }
  } catch (error) {
    try {
      unlinkSync(paths.plist);
    } catch {
      // nothing to clean up
    }
    const reason = String(error instanceof Error ? error.message : error).split('\n')[0];
    return { ok: false, message: `Could not load the schedule into launchd: ${reason}` };
  }

  const { hour, minute } = options.time;
  const at = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  const output = !options.print
    ? 'saves the PDF only'
    : `saves the PDF and prints it on ${options.printer ?? 'the default printer'}`;
  return {
    ok: true,
    message: [
      `Scheduled daily at ${at}: ${output}.`,
      `It runs edition-paper ${version} from ${paths.runnerDir}`,
      `with ${nodePath}. Logs: ${paths.log}`,
      `To try the scheduled job now: launchctl kickstart gui/${uid}/${LABEL}`,
    ].join('\n'),
  };
}

/** Unloads and deletes the agent and the runner. PDFs and the log stay. */
export function uninstallSchedule({ platform = process.platform, home, uid = process.getuid?.(), exec = defaultExec }) {
  if (platform !== 'darwin') {
    return {
      ok: true,
      message:
        'Nothing to remove: edition-paper only installs a schedule on macOS. If you added a cron line or a Task Scheduler task, remove it there.',
    };
  }
  const paths = schedulePaths(home);
  removeAgent(paths.plist, { exec, uid });
  removeAgent(paths.legacyPlist, { exec, uid });
  rmSync(paths.runnerDir, { recursive: true, force: true });
  try {
    if (readdirSync(paths.supportDir).length === 0) rmdirSync(paths.supportDir);
  } catch {
    // not there, or holds something else
  }
  return { ok: true, message: '8am paper unscheduled. Your PDFs stay where they are.' };
}
