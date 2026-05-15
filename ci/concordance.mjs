// Release-gate concordance check (spec §5.3, §6.3).
//
// Runs T01–T15 through both DAG Studio's engine and the upstream dagitty
// reference implementation. Asserts set-of-sets equality on the minimal
// sufficient adjustment sets returned by each. On disagreement, prints the
// per-case diff and exits non-zero, blocking the release.
//
// On a passing run with UPDATE_ATTESTATION=1 set, rewrites
// src/attestation.ts with the dagitty version, commit, validation timestamp,
// and case counts so the published engine_version carries a real attestation
// rather than the unstamped placeholder.
//
// EM01–EM20 are NOT included in this concordance check: dagitty does not
// natively classify modifiers per VanderWeele-Robins / Weinberg, so there is
// no upstream comparison engine. EM cases are validated via the engine's
// own canonical suite (runEMTest), just not concordance-checked here.

import { createRequire } from 'node:module';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');
const require = createRequire(import.meta.url);

// Build the bundle if missing (idempotent — fast even when present).
// The bundle is .cjs because dagitty is CommonJS and this package is ESM.
const bundlePath = resolve(HERE, 'dagitty-node.cjs');
if (!existsSync(bundlePath)) {
  console.error('dagitty-node.cjs missing; running build-dagitty.mjs first…');
  await import('./build-dagitty.mjs');
}

const dagitty = require('./dagitty-node.cjs');
const { TESTS, computeAdjustmentSets } = await import(resolve(REPO_ROOT, 'dag-engine.js'));

// Convert a canonical TestCase into the dagitty DSL string upstream's parser
// expects. Roles map directly: exposure → [exposure], outcome → [outcome],
// latent → [latent]. Confounders/mediators in our type system don't have
// dagitty annotations — they're inferred structurally and don't change the
// adjustment-set computation.
function testToDSL(t) {
  const lines = ['dag {'];
  for (const n of t.nodes) {
    const roles = [];
    if (n.id === t.exp) roles.push('exposure');
    if (n.id === t.out) roles.push('outcome');
    if (n.type === 'latent') roles.push('latent');
    lines.push(`  ${n.id}${roles.length ? ' [' + roles.join(',') + ']' : ''}`);
  }
  for (const e of t.edges) {
    lines.push(`  ${e.src} -> ${e.tgt}`);
  }
  lines.push('}');
  return lines.join('\n');
}

const normalizeSet = s => [...s].sort().join(',');
function setOfSetsEqual(a, b) {
  if (a.length !== b.length) return false;
  const A = new Set(a.map(normalizeSet));
  const B = new Set(b.map(normalizeSet));
  if (A.size !== B.size) return false;
  for (const x of A) if (!B.has(x)) return false;
  return true;
}

let passed = 0;
const failures = [];

for (const t of TESTS) {
  const dsl = testToDSL(t);
  let dagittyRaw;
  try {
    const g = dagitty.GraphParser.parseGuess(dsl);
    dagittyRaw = dagitty.GraphAnalyzer.listMsasTotalEffect(g);
  } catch (err) {
    failures.push({ id: t.id, name: t.name, error: `dagitty parse/analyze threw: ${err.message}` });
    continue;
  }
  const dagittySets = dagittyRaw.map(s => s.map(v => v.id));

  const dsResult = computeAdjustmentSets(t.exp, t.out, t.nodes, t.edges);
  const dsSets = dsResult?.sets ?? [];

  if (setOfSetsEqual(dagittySets, dsSets)) {
    passed++;
  } else {
    failures.push({
      id: t.id,
      name: t.name,
      dagitty: dagittySets,
      'dag-studio': dsSets,
    });
  }
}

console.log(`Concordance: ${passed}/${TESTS.length} cases match (T01–T15)`);
for (const f of failures) {
  console.error(`  ✖ ${f.id} ${f.name}`);
  if (f.error) {
    console.error(`    error:      ${f.error}`);
  } else {
    console.error(`    dagitty:    ${JSON.stringify(f.dagitty)}`);
    console.error(`    dag-studio: ${JSON.stringify(f['dag-studio'])}`);
  }
}

if (failures.length > 0) {
  console.error('\nConcordance check FAILED. Release blocked per spec §5.3.');
  process.exit(1);
}

console.log(`\nAll ${TESTS.length} canonical cases concordant with dagitty.`);

// On pass, optionally rewrite src/attestation.ts. Gated behind an env var so
// `npm run concordance` is a side-effect-free verification step locally; CI
// passes UPDATE_ATTESTATION=1 only on the release branch.
if (process.env.UPDATE_ATTESTATION === '1') {
  const commitHash = readFileSync(resolve(HERE, 'dagitty-src', 'COMMIT.txt'), 'utf8').trim();
  const shortCommit = commitHash.slice(0, 7);
  // dagitty's jslib has no package.json with a version field; fall back to a
  // commit-derived version string. Update if upstream starts publishing
  // versioned npm packages.
  const dagittyVersion = `git-${shortCommit}`;
  const timestamp = new Date().toISOString();

  const src =
    "// Static ConcordanceAttestation (spec §5.3). Updated by ci/concordance.mjs\n" +
    "// at release time. Do not edit by hand.\n" +
    "\n" +
    "import type { ConcordanceAttestation } from './schemas.js';\n" +
    "\n" +
    "export const ATTESTATION: ConcordanceAttestation = {\n" +
    "  reference_engine: 'dagitty',\n" +
    `  reference_version: '${dagittyVersion}',\n` +
    `  reference_commit: '${shortCommit}',\n` +
    `  validated_at: '${timestamp}',\n` +
    `  cases_validated: ${TESTS.length},\n` +
    `  cases_concordant: ${passed},\n` +
    "};\n";
  const attestationPath = resolve(HERE, '..', 'src', 'attestation.ts');
  writeFileSync(attestationPath, src);
  console.log(`Wrote attestation: ${attestationPath}`);
  console.log(`  reference_engine = 'dagitty'`);
  console.log(`  reference_version = '${dagittyVersion}'`);
  console.log(`  reference_commit  = '${shortCommit}'`);
  console.log(`  validated_at      = '${timestamp}'`);
  console.log(`  cases_validated   = ${TESTS.length}`);
  console.log(`  cases_concordant  = ${passed}`);
}
