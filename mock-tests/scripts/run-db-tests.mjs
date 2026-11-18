/**
 * Cross-platform runner for the pgtap assurance suite (supabase/tests/assurance.sql).
 *
 * WHY THIS EXISTS
 *   The old script was `psql "%SUPABASE_DB_URL%" ...` - cmd.exe syntax that
 *   silently passes a literal percent string on Linux CI, and required every
 *   developer to export the variable by hand. This runner reads the URL from
 *   process.env OR .env.local (gitignored), so `npm run test:db` works out of
 *   the box on Windows and in CI from a repository secret.
 *
 * WHY IT PARSES OUTPUT INSTEAD OF TRUSTING THE EXIT CODE
 *   pgtap assertion failures DO NOT raise: `ok(false, ...)` prints "not ok"
 *   and psql still exits 0. ON_ERROR_STOP catches SQL errors, but only a scan
 *   of the TAP stream catches a failed assertion. A runner that trusted the
 *   exit code would report a red suite as green - the exact failure class this
 *   project's assurance work exists to prevent.
 *
 * The suite itself is wrapped in BEGIN/ROLLBACK and creates only TEMP tables
 * and rolled-back fixtures, so it is safe against the hosted database.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Minimal .env parser: KEY=VALUE, optional quotes, # comments. */
function readEnvFile(path) {
  const out = {};
  if (!existsSync(path)) return out;
  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const key = line.slice(0, line.indexOf('=')).trim();
    let value = line.slice(line.indexOf('=') + 1).trim();
    if (value.length >= 2 && value[0] === value[value.length - 1] && (value[0] === '"' || value[0] === "'")) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const url =
  process.env.SUPABASE_DB_URL || readEnvFile(join(ROOT, '.env.local')).SUPABASE_DB_URL;

if (!url) {
  console.error(
    'SUPABASE_DB_URL is not set. Add it to mock-tests/.env.local (see 06-env.example)\n' +
      'or export it / provide the repository secret in CI.'
  );
  process.exit(1);
}

// Suite path is overridable (argv[2]) so the runner's failure detection can
// itself be tested against an injected failing assertion - a gate that has
// never failed on a violation is not known to work.
const suite = process.argv[2]
  ? join(process.cwd(), process.argv[2])
  : join(ROOT, 'supabase', 'tests', 'assurance.sql');
const res = spawnSync('psql', [url, '-v', 'ON_ERROR_STOP=1', '-f', suite], {
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
});

if (res.stdout) process.stdout.write(res.stdout);
if (res.stderr) process.stderr.write(res.stderr);

if (res.error) {
  console.error(`Could not run psql: ${res.error.message}. Is PostgreSQL client installed and on PATH?`);
  process.exit(1);
}
if (res.status !== 0) {
  console.error(`psql exited ${res.status} (SQL error under ON_ERROR_STOP).`);
  process.exit(res.status ?? 1);
}

const tap = res.stdout ?? '';
const okCount = (tap.match(/^\s*ok \d+ - /gm) ?? []).length;
const notOk = tap.match(/^\s*not ok.*$/gm) ?? [];
const failedSummary = /Looks like you failed/.test(tap);

if (notOk.length > 0 || failedSummary || okCount === 0) {
  console.error(`\nDB assurance FAILED: ${notOk.length} failing assertion(s), ${okCount} passing.`);
  for (const line of notOk) console.error('  ' + line.trim());
  if (okCount === 0) console.error('  No TAP output found - the suite did not run.');
  process.exit(1);
}

console.log(`\nDB assurance PASSED: ${okCount} assertions, 0 failures (rolled back).`);