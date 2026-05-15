// Run with: npm run test:tools

import test from 'node:test';
import assert from 'node:assert/strict';

import { handler } from '../src/tools/check_overadjustment.js';
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

const T05_MBIAS: DAG = {
  nodes: [
    { id: 'U1', label: 'U1', type: 'latent' },
    { id: 'U2', label: 'U2', type: 'latent' },
    { id: 'M', label: 'M' },
    { id: 'X', label: 'X', type: 'exposure' },
    { id: 'Y', label: 'Y', type: 'outcome' },
  ],
  edges: [
    { src: 'U1', tgt: 'X' }, { src: 'U1', tgt: 'M' },
    { src: 'U2', tgt: 'M' }, { src: 'U2', tgt: 'Y' },
    { src: 'X', tgt: 'Y' },
  ],
  exposure: 'X',
  outcome: 'Y',
};

test('check_overadjustment: sound set on T02 (condition on C) → ok=true, no flags', () => {
  const result = handler({ dag: T02_CONFOUNDING, adjustment_set: ['C'] });
  assert.equal(result.ok, true);
  assert.deepEqual(result.problematic_variables, []);
  assert.equal(result.regulatory_considerations.overadjustment_detected, false);
  assert.equal(result.regulatory_considerations.identifiability, 'identifiable');
  assert.deepEqual(result.regulatory_considerations.flags, []);
  // Only pearl_backdoor cited (no overadjustment-specific citations).
  assert.deepEqual(result.citations.map(c => c.source), ['Pearl 2009']);
});

test('check_overadjustment: empty set → ok=true with helper recommendation', () => {
  const result = handler({ dag: T02_CONFOUNDING, adjustment_set: [] });
  assert.equal(result.ok, true);
  assert.match(result.recommendation, /empty adjustment set/i);
  assert.match(result.recommendation, /analyze_dag/);
});

test('check_overadjustment: T11 conditioning on B (descendant of X) → OVERADJ_DESCENDANT', () => {
  const result = handler({ dag: T11_OVERADJ, adjustment_set: ['B', 'C'] });
  assert.equal(result.ok, false);
  const probs = result.problematic_variables;
  assert.equal(probs.length, 1);
  assert.equal(probs[0]?.id, 'B');
  assert.equal(probs[0]?.reason, 'descendant_of_exposure');
  assert.equal(result.regulatory_considerations.overadjustment_detected, true);
  assert.equal(result.regulatory_considerations.identifiability, 'unidentifiable');
  assert.deepEqual(result.regulatory_considerations.overadjustment_variables, ['B']);
  const codes = result.regulatory_considerations.flags.map(f => f.code);
  assert.deepEqual(codes, ['OVERADJ_DESCENDANT']);
  // schisterman_overadjustment_2009 cited because of OVERADJ_DESCENDANT.
  const sources = result.citations.map(c => c.source);
  assert.ok(sources.includes('Schisterman, Cole & Platt 2009'));
});

test('check_overadjustment: T05 M-bias conditioning on M (collider) → OVERADJ_COLLIDER', () => {
  const result = handler({ dag: T05_MBIAS, adjustment_set: ['M'] });
  assert.equal(result.ok, false);
  const probs = result.problematic_variables;
  assert.equal(probs.length, 1);
  assert.equal(probs[0]?.id, 'M');
  assert.equal(probs[0]?.reason, 'collider');
  const codes = result.regulatory_considerations.flags.map(f => f.code);
  assert.deepEqual(codes, ['OVERADJ_COLLIDER']);
  const sources = result.citations.map(c => c.source);
  assert.ok(sources.includes('Greenland 2003'));
});

test('check_overadjustment: M-bias with justified collider conditioning {M, U1} → ok', () => {
  // Conditioning on M opens path X←U1→M←U2→Y, but U1 is also conditioned and
  // re-blocks it. Engine pathBlocked handles this transparently.
  const result = handler({ dag: T05_MBIAS, adjustment_set: ['M', 'U1'] });
  assert.equal(result.ok, true);
  assert.deepEqual(result.problematic_variables, []);
});

test('check_overadjustment: descendant of unconditioned collider → OVERADJ_DESCENDANT_OF_COLLIDER', () => {
  // Add a descendant D of the M-bias collider M, condition on D only.
  const dagWithDesc: DAG = {
    ...T05_MBIAS,
    nodes: [...T05_MBIAS.nodes, { id: 'D', label: 'D' }],
    edges: [...T05_MBIAS.edges, { src: 'M', tgt: 'D' }],
  };
  const result = handler({ dag: dagWithDesc, adjustment_set: ['D'] });
  assert.equal(result.ok, false);
  assert.equal(result.problematic_variables[0]?.id, 'D');
  assert.equal(result.problematic_variables[0]?.reason, 'descendant_of_collider');
  // descendant_of_collider is a warning, not critical, so identifiability
  // stays 'identifiable' per the severity-driven logic.
  assert.equal(result.regulatory_considerations.identifiability, 'identifiable');
  assert.equal(result.regulatory_considerations.overadjustment_detected, true);
});

test('check_overadjustment: throws on adjustment_set containing exposure', () => {
  assert.throws(
    () => handler({ dag: T02_CONFOUNDING, adjustment_set: ['X'] }),
    /must not contain the exposure/
  );
});

test('check_overadjustment: throws on adjustment_set containing outcome', () => {
  assert.throws(
    () => handler({ dag: T02_CONFOUNDING, adjustment_set: ['Y'] }),
    /must not contain the outcome/
  );
});

test('check_overadjustment: throws on unknown adjustment_set member', () => {
  assert.throws(
    () => handler({ dag: T02_CONFOUNDING, adjustment_set: ['NOPE'] }),
    /'NOPE' is not a node/
  );
});

test('check_overadjustment: dagitty_string input path', () => {
  const dsl = `dagitty('dag { X [exposure]; Y [outcome]; C; X -> Y; C -> X; C -> Y }')`;
  const result = handler({ dagitty_string: dsl, adjustment_set: ['C'] });
  assert.equal(result.ok, true);
});

test('check_overadjustment: response includes engine_version', () => {
  const result = handler({ dag: T02_CONFOUNDING, adjustment_set: [] });
  assert.match(result.engine_version, /^\d+\.\d+\.\d+\+\S+$/);
});
