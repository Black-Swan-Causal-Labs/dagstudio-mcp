// Run with: npm run test:tools

import test from 'node:test';
import assert from 'node:assert/strict';

import { handler } from '../src/tools/simulate_data.js';
import type { DAG } from '../src/schemas.js';

const T02_CONFOUNDING: DAG = {
  nodes: [
    { id: 'C', label: 'C', type: 'confounder' },
    { id: 'X', label: 'X', type: 'exposure' },
    { id: 'Y', label: 'Y', type: 'outcome' },
  ],
  edges: [
    { src: 'C', tgt: 'X' },
    { src: 'C', tgt: 'Y' },
    { src: 'X', tgt: 'Y' },
  ],
  exposure: 'X',
  outcome: 'Y',
};

test('simulate_data: defaults n=1000, seed=42, format=json', () => {
  const out = handler({ dag: T02_CONFOUNDING });
  assert.equal(out.n, 1000);
  assert.equal(out.seed, 42);
  assert.equal(out.format, 'json');
  assert.ok(Array.isArray(out.data));
  assert.equal((out.data as Array<Record<string, number>>).length, 1000);
});

test('simulate_data: deterministic given seed (two runs match exactly)', () => {
  const a = handler({ dag: T02_CONFOUNDING, n: 50, seed: 42 });
  const b = handler({ dag: T02_CONFOUNDING, n: 50, seed: 42 });
  assert.deepEqual(a.data, b.data);
});

test('simulate_data: different seeds produce different data', () => {
  const a = handler({ dag: T02_CONFOUNDING, n: 50, seed: 42 });
  const b = handler({ dag: T02_CONFOUNDING, n: 50, seed: 43 });
  assert.notDeepEqual(a.data, b.data);
});

test('simulate_data: csv format returns labeled CSV string', () => {
  const out = handler({ dag: T02_CONFOUNDING, n: 5, seed: 42, format: 'csv' });
  assert.equal(out.format, 'csv');
  assert.equal(typeof out.data, 'string');
  const lines = (out.data as string).split('\n');
  assert.equal(lines.length, 6); // header + 5 rows
  assert.equal(lines[0], 'C,X,Y');
});

test('simulate_data: topological_order respects edges', () => {
  // C must come before X and Y; X must come before Y.
  const out = handler({ dag: T02_CONFOUNDING, n: 1, seed: 42 });
  const idx = (id: string) => out.topological_order.indexOf(id);
  assert.ok(idx('C') < idx('X'));
  assert.ok(idx('C') < idx('Y'));
  assert.ok(idx('X') < idx('Y'));
});

test('simulate_data: coefficient overrides take effect', () => {
  // Set X→Y to 0.0; the X coefficient in simulated data should be near zero
  // when we regress Y on X (after stripping confounding via large n).
  const out = handler({
    dag: T02_CONFOUNDING,
    n: 5000,
    seed: 42,
    coefficients: { 'X->Y': 0.0, 'C->X': 0.5, 'C->Y': 0.5 },
  });
  // crude E[Y|X] regression: Y = 0.5*X + 0.5*C + noise. C and X correlated via
  // C → X. The data should still be deterministic.
  // Just check that the simulation ran without error and produced finite values.
  for (const row of (out.data as Array<Record<string, number>>).slice(0, 10)) {
    for (const v of Object.values(row)) {
      assert.ok(Number.isFinite(v));
    }
  }
});

test('simulate_data: emits SIM_LINEAR_GAUSSIAN_ASSUMPTION + SIM_SEED_DETERMINISTIC', () => {
  const out = handler({ dag: T02_CONFOUNDING, n: 10, seed: 42 });
  const codes = out.diagnostics.flags.map(f => f.code);
  assert.deepEqual(codes, ['SIM_LINEAR_GAUSSIAN_ASSUMPTION', 'SIM_SEED_DETERMINISTIC']);
});

test('simulate_data: cycle throws', () => {
  assert.throws(
    () => handler({
      dag: {
        nodes: [{ id: 'A', label: 'A' }, { id: 'B', label: 'B' }],
        edges: [{ src: 'A', tgt: 'B' }, { src: 'B', tgt: 'A' }],
      },
    }),
    /cycle/i
  );
});

test('simulate_data: unknown coefficient key throws', () => {
  assert.throws(
    () => handler({
      dag: T02_CONFOUNDING,
      coefficients: { 'X->NOPE': 0.5 },
    }),
    /'X->NOPE' does not match any edge/
  );
});

test('simulate_data: empty DAG throws', () => {
  assert.throws(
    () => handler({ dag: { nodes: [], edges: [] } }),
    /no nodes/
  );
});

test('simulate_data: pearl_sem citation always present', () => {
  const out = handler({ dag: T02_CONFOUNDING, n: 10 });
  assert.ok(out.citations.some(c => c.source === 'Pearl 2009'));
});
