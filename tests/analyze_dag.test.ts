// Run with: npm run test:tools (uses tsx loader + node:test)

import test from 'node:test';
import assert from 'node:assert/strict';

import { handler } from '../src/tools/analyze_dag.js';

test('analyze_dag: classic confounding (DAG input) → IDENT_OK only', () => {
  const result = handler({
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
  });
  assert.equal(result.identifiable, true);
  assert.equal(result.backdoor_paths.length, 1);
  assert.deepEqual(result.minimal_adjustment_sets, [['C']]);
  assert.equal(result.regulatory_considerations.identifiability, 'identifiable');
  assert.equal(result.regulatory_considerations.unmeasured_confounding_present, false);
  assert.equal(result.regulatory_considerations.overadjustment_detected, false);
  assert.deepEqual(
    result.regulatory_considerations.flags.map(f => f.code),
    ['IDENT_OK']
  );
});

test('analyze_dag: T01 mediation chain → IDENT_EMPTY_SET', () => {
  const result = handler({
    nodes: [
      { id: 'X', label: 'X', type: 'exposure' },
      { id: 'M', label: 'M' },
      { id: 'Y', label: 'Y', type: 'outcome' },
    ],
    edges: [
      { src: 'X', tgt: 'M' },
      { src: 'M', tgt: 'Y' },
    ],
    exposure: 'X',
    outcome: 'Y',
  });
  assert.equal(result.identifiable, true);
  assert.deepEqual(result.minimal_adjustment_sets, [[]]);
  assert.deepEqual(
    result.regulatory_considerations.flags.map(f => f.code),
    ['IDENT_EMPTY_SET']
  );
});

test('analyze_dag: T06 instrumental variable → IDENT_NONE + CONF_LATENT_ON_BACKDOOR, unidentifiable', () => {
  const result = handler({
    nodes: [
      { id: 'IV', label: 'IV' },
      { id: 'U', label: 'U', type: 'latent' },
      { id: 'X', label: 'X', type: 'exposure' },
      { id: 'Y', label: 'Y', type: 'outcome' },
    ],
    edges: [
      { src: 'IV', tgt: 'X' },
      { src: 'U', tgt: 'X' },
      { src: 'U', tgt: 'Y' },
      { src: 'X', tgt: 'Y' },
    ],
    exposure: 'X',
    outcome: 'Y',
  });
  assert.equal(result.identifiable, false);
  assert.equal(result.regulatory_considerations.identifiability, 'unidentifiable');
  assert.equal(result.regulatory_considerations.unmeasured_confounding_present, true);
  const codes = result.regulatory_considerations.flags.map(f => f.code);
  assert.ok(codes.includes('IDENT_NONE'));
  assert.ok(codes.includes('CONF_LATENT_ON_BACKDOOR'));
});

test('analyze_dag: dagitty_string input path delegates to parse_dagitty', () => {
  const result = handler({
    dagitty_string: `dagitty('dag { X [exposure]; Y [outcome]; C; X -> Y; C -> X; C -> Y }')`,
  });
  assert.equal(result.identifiable, true);
  assert.deepEqual(result.minimal_adjustment_sets, [['C']]);
});

test('analyze_dag: missing exposure → throws with remediation hint', () => {
  assert.throws(
    () => handler({
      nodes: [{ id: 'X', label: 'X' }, { id: 'Y', label: 'Y' }],
      edges: [{ src: 'X', tgt: 'Y' }],
      outcome: 'Y',
    }),
    /exposure/
  );
});

test('analyze_dag: cycle → throws with remediation hint', () => {
  assert.throws(
    () => handler({
      nodes: [
        { id: 'A', label: 'A', type: 'exposure' },
        { id: 'B', label: 'B' },
        { id: 'C', label: 'C', type: 'outcome' },
      ],
      edges: [
        { src: 'A', tgt: 'B' },
        { src: 'B', tgt: 'C' },
        { src: 'C', tgt: 'A' },
      ],
      exposure: 'A',
      outcome: 'C',
    }),
    /cycle/i
  );
});

test('analyze_dag: exposure not in nodes → throws', () => {
  assert.throws(
    () => handler({
      nodes: [{ id: 'X', label: 'X' }, { id: 'Y', label: 'Y' }],
      edges: [{ src: 'X', tgt: 'Y' }],
      exposure: 'NOPE',
      outcome: 'Y',
    }),
    /exposure 'NOPE' is not a node/
  );
});

test('analyze_dag: response includes citations and well-formed engine_version', () => {
  const result = handler({
    nodes: [
      { id: 'X', label: 'X', type: 'exposure' },
      { id: 'Y', label: 'Y', type: 'outcome' },
    ],
    edges: [{ src: 'X', tgt: 'Y' }],
    exposure: 'X',
    outcome: 'Y',
  });
  const sources = result.citations.map(c => c.source);
  assert.ok(sources.includes('Pearl 2009'));
  assert.ok(sources.includes('Greenland, Pearl & Robins 1999'));
  assert.ok(sources.includes('Textor et al. 2016'));
  assert.match(result.engine_version, /^\d+\.\d+\.\d+\+\S+$/);
});

test('analyze_dag: T12 competing adjustment sets → IDENT_OK only (one minimal set)', () => {
  // T12 has 3 backdoor paths but only {C1, C2} is the minimal set.
  const result = handler({
    nodes: [
      { id: 'C1', label: 'C1', type: 'confounder' },
      { id: 'C2', label: 'C2', type: 'confounder' },
      { id: 'C3', label: 'C3', type: 'confounder' },
      { id: 'X', label: 'X', type: 'exposure' },
      { id: 'Y', label: 'Y', type: 'outcome' },
    ],
    edges: [
      { src: 'C1', tgt: 'X' }, { src: 'C1', tgt: 'Y' },
      { src: 'C2', tgt: 'X' }, { src: 'C2', tgt: 'Y' },
      { src: 'C3', tgt: 'C1' }, { src: 'C3', tgt: 'Y' },
      { src: 'X', tgt: 'Y' },
    ],
    exposure: 'X',
    outcome: 'Y',
  });
  assert.equal(result.identifiable, true);
  assert.equal(result.backdoor_paths.length, 3);
  assert.deepEqual(result.minimal_adjustment_sets, [['C1', 'C2']]);
  assert.deepEqual(
    result.regulatory_considerations.flags.map(f => f.code),
    ['IDENT_OK']
  );
});

test('analyze_dag: STRUCT_LABEL_MISMATCH fires when a mediator is mislabeled as confounder', () => {
  // X -> M -> Y with M typed as 'confounder' — structurally a mediator, not a confounder.
  const result = handler({
    nodes: [
      { id: 'X', label: 'X', type: 'exposure' },
      { id: 'M', label: 'M', type: 'confounder' },
      { id: 'Y', label: 'Y', type: 'outcome' },
    ],
    edges: [
      { src: 'X', tgt: 'M' },
      { src: 'M', tgt: 'Y' },
    ],
    exposure: 'X',
    outcome: 'Y',
  });
  const codes = result.regulatory_considerations.flags.map(f => f.code);
  assert.ok(codes.includes('STRUCT_LABEL_MISMATCH'));
});
