/**
 * Lint ratchet.
 *
 * WHY A RATCHET AND NOT A GATE
 *   The repo carries a pre-existing baseline of lint problems (60 errors, 16
 *   warnings at the time this was written). A CI step that simply runs
 *   `npm run lint` would fail on the first commit, so the realistic outcomes
 *   would be either a big-bang cleanup nobody scheduled, or - far more likely -
 *   someone marks lint `continue-on-error` and it stops meaning anything.
 *
 *   A ratchet takes the third option: the baseline is recorded, CI fails only
 *   when the count gets WORSE, and improvements are reported so the baseline can
 *   be tightened. That makes lint enforceable today without pretending the
 *   existing debt is not there, and it makes the debt monotonically shrink.
 *
 *   This is the same reasoning as the funnel-coverage allowlist: record the
 *   known-bad state explicitly, then fail on drift in either direction.
 *
 * Usage:
 *   node scripts/lint-ratchet.mjs           # check against the baseline
 *   node scripts/lint-ratchet.mjs --update  # rewrite the baseline (deliberate act)
 */
import { ESLint } from 'eslint';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASELINE_FILE = join(HERE, 'lint-baseline.json');
const UPDATE = process.argv.includes('--update');

const eslint = new ESLint({});
const results = await eslint.lintFiles(['.']);

const errors = results.reduce((n, r) => n + r.errorCount, 0);
const warnings = results.reduce((n, r) => n + r.warningCount, 0);
const total = errors + warnings;

if (UPDATE || !existsSync(BASELINE_FILE)) {
  writeFileSync(
    BASELINE_FILE,
    JSON.stringify(
      {
        errors,
        warnings,
        total,
        note: 'Pre-existing lint debt. CI fails only if this gets worse. Lower it with: node scripts/lint-ratchet.mjs --update',
      },
      null,
      2
    ) + '\n'
  );
  console.log(`lint baseline written: ${errors} errors, ${warnings} warnings (${total} total)`);
  process.exit(0);
}

const baseline = JSON.parse(readFileSync(BASELINE_FILE, 'utf8'));

console.log(`lint: ${errors} errors, ${warnings} warnings (${total} total)`);
console.log(`baseline: ${baseline.errors} errors, ${baseline.warnings} warnings (${baseline.total} total)`);

// Per-file breakdown of anything above baseline is not attempted: ESLint's
// counts are the contract here. A rise is a rise, and the full `npm run lint`
// output is one command away for whoever has to fix it.
if (total > baseline.total) {
  console.error(
    `\nFAIL: lint problems increased by ${total - baseline.total}.\n` +
      'Fix the new problems, or - if the increase is genuinely intended - run\n' +
      '  node scripts/lint-ratchet.mjs --update\n' +
      'and justify the new baseline in the PR description.'
  );
  process.exit(1);
}

if (total < baseline.total) {
  console.log(
    `\nImproved by ${baseline.total - total}. Tighten the baseline with:\n` +
      '  node scripts/lint-ratchet.mjs --update'
  );
}

console.log('\nPASS: lint has not regressed.');
