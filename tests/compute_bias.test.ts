// Run with: npm run test:tools

import test from 'node:test';
import assert from 'node:assert/strict';

import { handler } from '../src/tools/compute_bias.js';
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

const T01_MEDIATION: DAG = {
  nodes: [
    { id: 'X', label: 'X', type: 'exposure' },
    { id: 'M', label: 'M' },
    { id: 'Y', label: 'Y', type: 'outcome' },
  ],
  edges: [{ src: 'X', tgt: 'M' }, { src: 'M', tgt: 'Y' }],
  exposure: 'X',
  outcome: 'Y',
};

const T11_OVERADJ: DAG = {
  nodes: [
    { id: 'X', label: 'X', type: 'exposure' },
    { id: 'B', label: 'B' },
    { id: 'C', label: 'C', type: 'confounder' },
    { id: 'Y', label: 'Y', type: 'outcome' },
  ],
  edges: [
    { src: 'X', tgt: 'B' },
    { src: 'B', tgt: 'Y' },
    { src: 'X', tgt: 'Y' },
    { src: 'C', tgt: 'X' },
    { src: 'C', tgt: 'Y' },
  ],
  exposure: 'X',
  outcome: 'Y',
};

test('compute_bias: T02 confounding — adjusting on C reduces bias', () => {
  const out = handler({ dag: T02_CONFOUNDING, adjustment_set: ['C'], n: 5000, seed: 42 });
  // Default coefficients: all edges = 0.5. True direct effect X→Y = 0.5.
  assert.equal(out.true_effect, 0.5);
  // Crude regression has confounding bias from C; |crude_bias| should be > 0.
  assert.ok(Math.abs(out.crude_bias) > 0.05, `crude_bias=${out.crude_bias} expected > 0.05`);
  // Adjusting on C should give a much closer estimate.
  assert.ok(Math.abs(out.adjusted_bias) < Math.abs(out.crude_bias),
    `adjusted_bias=${out.adjusted_bias} should be smaller than crude_bias=${out.crude_bias}`);
  assert.ok(out.bias_reduction > 0, `bias_reduction=${out.bias_reduction} should be > 0`);
});

test('compute_bias: T02 — empty adjustment_set has crude=adjusted, bias_reduction=0', () => {
  const out = handler({ dag: T02_CONFOUNDING, adjustment_set: [], n: 1000, seed: 42 });
  assert.equal(out.crude_estimate, out.adjusted_estimate);
  assert.equal(out.bias_reduction, 0);
});

test('compute_bias: T01 mediation — empty set already unbiased', () => {
  const out = handler({ dag: T01_MEDIATION, adjustment_set: [], n: 5000, seed: 42 });
  // True total X→Y effect goes through X→M→Y: 0.5 * 0.5 = 0.25.
  assert.equal(out.true_effect, 0.25);
  // No backdoor paths; crude estimate should already be near the truth.
  assert.ok(Math.abs(out.crude_bias) < 0.05,
    `crude_bias=${out.crude_bias} expected near zero (no confounding)`);
});

test('compute_bias: T11 overadjustment — adjusting on B (descendant of X) flagged + biases differently', () => {
  const out = handler({ dag: T11_OVERADJ, adjustment_set: ['B', 'C'], n: 5000, seed: 42 });
  const codes = out.diagnostics.flags.map(f => f.code);
  assert.ok(codes.includes('OVERADJ_DESCENDANT'));
  assert.ok(codes.includes('SIM_LINEAR_GAUSSIAN_ASSUMPTION'));
  assert.ok(codes.includes('SIM_SEED_DETERMINISTIC'));
  assert.equal(out.diagnostics.overadjustment_detected, true);
  assert.deepEqual(out.diagnostics.overadjustment_variables, ['B']);
  // identifiability flips to 'unidentifiable' because OVERADJ_DESCENDANT is critical.
  assert.equal(out.diagnostics.identifiability, 'unidentifiable');
  // Schisterman cited because of OVERADJ_DESCENDANT.
  assert.ok(out.citations.some(c => c.source.startsWith('Schisterman')));
});

test('compute_bias: deterministic given seed', () => {
  const a = handler({ dag: T02_CONFOUNDING, adjustment_set: ['C'], n: 200, seed: 42 });
  const b = handler({ dag: T02_CONFOUNDING, adjustment_set: ['C'], n: 200, seed: 42 });
  assert.equal(a.crude_estimate, b.crude_estimate);
  assert.equal(a.adjusted_estimate, b.adjusted_estimate);
});

test('compute_bias: throws on adjustment_set containing exposure', () => {
  assert.throws(
    () => handler({ dag: T02_CONFOUNDING, adjustment_set: ['X'], seed: 42 }),
    /must not contain the exposure/
  );
});

test('compute_bias: throws on missing exposure', () => {
  assert.throws(
    () => handler({
      dag: { ...T02_CONFOUNDING, exposure: undefined },
      adjustment_set: ['C'],
    }),
    /exposure/
  );
});

test('compute_bias: throws on cycle', () => {
  assert.throws(
    () => handler({
      dag: {
        nodes: [
          { id: 'A', label: 'A', type: 'exposure' },
          { id: 'B', label: 'B', type: 'outcome' },
        ],
        edges: [{ src: 'A', tgt: 'B' }, { src: 'B', tgt: 'A' }],
        exposure: 'A',
        outcome: 'B',
      },
      adjustment_set: [],
    }),
    /cycle/i
  );
});

test('compute_bias: bias_reduction = |crude_bias| - |adjusted_bias|', () => {
  const out = handler({ dag: T02_CONFOUNDING, adjustment_set: ['C'], n: 1000, seed: 42 });
  const expected = Math.abs(out.crude_bias) - Math.abs(out.adjusted_bias);
  assert.equal(out.bias_reduction, expected);
});

test('compute_bias: pearl_sem and pearl_backdoor always cited', () => {
  const out = handler({ dag: T02_CONFOUNDING, adjustment_set: ['C'], n: 100, seed: 42 });
  const sources = out.citations.map(c => c.source);
  // pearl_sem and pearl_backdoor share the source "Pearl 2009" but differ in reference.
  assert.ok(sources.filter(s => s === 'Pearl 2009').length >= 2);
});

test('compute_bias: response includes engine_version', () => {
  const out = handler({ dag: T02_CONFOUNDING, adjustment_set: [], n: 100, seed: 42 });
  assert.match(out.engine_version, /^\d+\.\d+\.\d+\+\S+$/);
});

test('compute_bias: custom coefficients change true_effect', () => {
  const out = handler({
    dag: T02_CONFOUNDING,
    adjustment_set: ['C'],
    n: 100,
    seed: 42,
    coefficients: { 'X->Y': 0.8, 'C->X': 0.5, 'C->Y': 0.5 },
  });
  assert.equal(out.true_effect, 0.8);
});
