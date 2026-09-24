/**
 * Initial-bundle guard. Asserts a RULE, not a number: "this module is not in the
 * static import graph of the entry point". Runs in CI after the production build,
 * and by hand the same way:
 *
 *     npx ng build --configuration production --stats-json
 *     node scripts/assert-initial-bundle.mjs
 *
 * STATUS: wired into .github/workflows/frontend-ci.yml on 2026-09-24, in the same
 * commit that made the three importers dynamic — which is the condition this
 * docblock used to set ("it gets wired up in the same PR that fixes the
 * importers"). Until then it failed on purpose, because gating before the fix only
 * teaches everyone to ignore a red CI, which is how a gate dies.
 *
 * It passes today: @sentry is reached ONLY through a dynamic import, from
 * src/app/services/telemetry.service.ts and src/main.ts. It used to have three
 * static importers — those two plus src/app/app.config.ts — worth 241.84 kB of the
 * initial bundle, on every visit, for an SDK that reports nothing while
 * environment.sentryDsn is empty. Converting them measured 994.85 kB -> 753.70 kB.
 *
 * WHY A RULE AND NOT A kB CEILING: a script that asserts "the initial bundle is under
 * N kB" goes off on every Angular bump and gets raised until it means nothing. The
 * graph question - is this package reachable without a dynamic import? - has a stable
 * answer that only changes when someone actually changes an import.
 *
 * HOW IT MEASURES: `--stats-json` emits an esbuild metafile. Starting from the output
 * whose `entryPoint` is the configured entry, we follow ONLY `import-statement` edges.
 * Stopping at `dynamic-import` is exactly the budget's own definition of "initial", so
 * the set we walk is the set the budget weighs. The `.mjs` outputs are the SSR build -
 * a different graph - and are excluded.
 *
 * WHAT IS DATA AND WHAT IS CODE: the packages to keep out live in
 * `scripts/initial-bundle-rules.json`, not here. Today that is only @sentry; the guard
 * works for any library the project decides to keep out of the initial bundle.
 *
 * FAILURE POLICY - the opposite of generate-sitemap.mjs, which must never fail a build:
 * this script exists to fail.
 *   exit 0  every rule holds
 *   exit 1  a forbidden package is in the initial graph (prints which, and how much)
 *   exit 2  COULD NOT MEASURE - no stats.json, no entry point, malformed metafile.
 * Exit 2 is not a pass. A build that blows the 1 MB error budget writes no dist at all,
 * so "the file is missing" is a likely symptom of the very problem this guards, and
 * reporting it as success would be the same silent-green trap the guard is here to stop.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Reports COULD NOT MEASURE and exits 2. Never resolves. */
const cannotMeasure = (what, hint) => {
  console.error(`\n  COULD NOT MEASURE: ${what}`);
  console.error(`  ${hint}`);
  console.error('  This is not a pass. Exiting 2.\n');
  process.exit(2);
};

const readJson = (path, what) => {
  try {
    return JSON.parse(readFileSync(resolve(root, path), 'utf8'));
  } catch (err) {
    cannotMeasure(
      `${what} could not be read (${path})`,
      err.code === 'ENOENT'
        ? 'Run `npx ng build --configuration production --stats-json` first. If the build itself failed on the 1 MB error budget it writes no dist at all.'
        : `Unexpected error: ${err.message}`,
    );
  }
};

const rules = readJson('scripts/initial-bundle-rules.json', 'the rules file');
const stats = readJson(rules.statsFile, 'the build metafile');

const outputs = stats?.outputs;
if (!outputs || typeof outputs !== 'object') {
  cannotMeasure('the metafile has no `outputs` map', 'Was it produced by `--stats-json`?');
}

const isBrowser = (path) => path.endsWith('.js') && !path.endsWith('.mjs');
const entries = Object.keys(outputs).filter(
  (path) => outputs[path]?.entryPoint === rules.entryPoint && isBrowser(path),
);
if (entries.length !== 1) {
  cannotMeasure(
    `expected exactly one browser entry for "${rules.entryPoint}", found ${entries.length}`,
    'The entryPoint in the rules file must match the metafile.',
  );
}

// Walk the static graph. A dynamic-import edge is where the initial bundle ends.
const initial = new Set();
const pending = [entries[0]];
while (pending.length > 0) {
  const current = pending.pop();
  if (initial.has(current) || !outputs[current]) continue;
  initial.add(current);
  for (const edge of outputs[current].imports ?? []) {
    if (edge.kind === 'import-statement') pending.push(edge.path);
  }
}

// Attribute bytes to source modules, but only inside the initial chunks.
const bytesByInput = new Map();
for (const chunk of initial) {
  for (const [input, info] of Object.entries(outputs[chunk].inputs ?? {})) {
    bytesByInput.set(input, (bytesByInput.get(input) ?? 0) + (info.bytesInOutput ?? 0));
  }
}

const kB = (bytes) => `${(bytes / 1000).toFixed(2)} kB`;
const initialBytes = [...initial].reduce((sum, chunk) => sum + (outputs[chunk].bytes ?? 0), 0);

console.log(`\n  entry            ${rules.entryPoint}`);
console.log(`  initial chunks   ${initial.size} (${kB(initialBytes)} of JS)`);
console.log(`  rules            ${rules.forbidden.length}\n`);

let failed = false;
for (const rule of rules.forbidden) {
  const hits = [...bytesByInput].filter(([input]) => input.includes(rule.match));
  const total = hits.reduce((sum, [, bytes]) => sum + bytes, 0);

  if (hits.length === 0) {
    console.log(`  OK    ${rule.label} is not in the static graph`);
    continue;
  }

  failed = true;
  console.error(`  FAIL  ${rule.label} is in the initial bundle: ${kB(total)}`);
  console.error(`        ${rule.reason}`);
  const byPackage = new Map();
  for (const [input, bytes] of hits) {
    const after = input.slice(input.lastIndexOf('node_modules/') + 'node_modules/'.length);
    const parts = after.split('/');
    const pkg = after.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
    byPackage.set(pkg, (byPackage.get(pkg) ?? 0) + bytes);
  }
  for (const [pkg, bytes] of [...byPackage].sort((a, b) => b[1] - a[1])) {
    console.error(`          ${kB(bytes).padStart(10)}  ${pkg}`);
  }
}

if (failed) {
  console.error('\n  A forbidden package is reachable from the entry without a dynamic import.');
  console.error('  Convert EVERY static importer in one change: converting only some of them');
  console.error('  makes the bundle bigger, because the static copy stays and the split point');
  console.error('  duplicates. Measured on this repo: 993.00 kB -> 1092.51 kB.\n');
  process.exit(1);
}

console.log('\n  All rules hold.\n');
