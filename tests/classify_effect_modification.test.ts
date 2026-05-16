// Run with: npm run test:tools

import test from 'node:test';
import assert from 'node:assert/strict';

import { handler } from '../src/tools/classify_effect_modification.js';
import type { DAG } from '../src/schemas.js';

// Mirrors EM01 (VanderWeele-Robins 2007 Fig 1a): pure direct modifier.
const EM01_DIRECT: DAG = {
  nodes: [
    { id: 'e', label: 'E', type: 'exposure' },
    { id: 'd', label: 'D', type: 'outcome' },
    { id: 'm', label: 'M', type: 'modifier' },
  ],
  edges: [{ src: 'e', tgt: 'd', id: '_e0' }],
  modifiers: [{ id: '_m0', src: 'm', tgtEdge: '_e0' }],
  exposure: 'e',
  outcome: 'd',
};

// Mirrors EM18 (Weinberg 2007 Fig 3): pure interaction.
const EM18_PURE_INTERACTION: DAG = {
  nodes: [
    { id: 'e', label: 'E', type: 'exposure' },
    { id: 'd', label: 'D', type: 'outcome' },
    { id: 'm', label: 'M', type: 'modifier' },
  ],
  edges: [
    { src: 'e', tgt: 'd', id: '_e0' },
    { src: 'm', tgt: 'd', id: '_e1' },
  ],
  modifiers: [{ id: '_m0', src: 'm', tgtEdge: '_e0' }],
  exposure: 'e',
  outcome: 'd',
};

test('classify_effect_modification: EM01 direct → EM_DIRECT flag', () => {
  const out = handler({ dag: EM01_DIRECT });
  assert.equal(out.classifications.length, 1);
  assert.equal(out.classifications[0]!.type, 'direct');
  assert.equal(out.classifications[0]!.target_edge.src, 'e');
  assert.equal(out.classifications[0]!.target_edge.tgt, 'd');
  const codes = out.diagnostics.flags.map(f => f.code);
  assert.deepEqual(codes, ['EM_DIRECT']);
  // Citations: vanderweele_robins always; no weinberg unless pure-interaction.
  const sources = out.citations.map(c => c.source);
  assert.ok(sources.includes('VanderWeele & Robins 2007'));
  assert.ok(!sources.includes('Weinberg 2007'));
});

test('classify_effect_modification: EM18 pure-interaction → EM_PURE_INTERACTION + Weinberg cite', () => {
  const out = handler({ dag: EM18_PURE_INTERACTION });
  assert.equal(out.classifications[0]!.type, 'pure-interaction');
  const codes = out.diagnostics.flags.map(f => f.code);
  assert.deepEqual(codes, ['EM_PURE_INTERACTION']);
  const sources = out.citations.map(c => c.source);
  assert.ok(sources.includes('VanderWeele & Robins 2007'));
  assert.ok(sources.includes('Weinberg 2007'));
});

test('classify_effect_modification: empty modifiers → empty classifications, vanderweele cite still present', () => {
  const out = handler({
    dag: {
      nodes: [
        { id: 'X', label: 'X', type: 'exposure' },
        { id: 'Y', label: 'Y', type: 'outcome' },
      ],
      edges: [{ src: 'X', tgt: 'Y' }],
      exposure: 'X',
      outcome: 'Y',
    },
  });
  assert.deepEqual(out.classifications, []);
  assert.deepEqual(out.diagnostics.flags, []);
  // Per spec §5.4, vanderweele_robins_em_2007 is always emitted by this tool.
  assert.ok(out.citations.some(c => c.source.startsWith('VanderWeele')));
});

test('classify_effect_modification: missing exposure throws', () => {
  assert.throws(
    () => handler({
      dag: {
        nodes: [
          { id: 'e', label: 'E' },
          { id: 'd', label: 'D' },
          { id: 'm', label: 'M', type: 'modifier' },
        ],
        edges: [{ src: 'e', tgt: 'd', id: '_e0' }],
        modifiers: [{ id: '_m0', src: 'm', tgtEdge: '_e0' }],
        outcome: 'd',
      },
    }),
    /exposure/
  );
});

test('classify_effect_modification: invalid modifier (source node missing) classifies as invalid, no flag', () => {
  const out = handler({
    dag: {
      nodes: [
        { id: 'e', label: 'E', type: 'exposure' },
        { id: 'd', label: 'D', type: 'outcome' },
      ],
      edges: [{ src: 'e', tgt: 'd', id: '_e0' }],
      modifiers: [{ id: '_m0', src: 'ghost', tgtEdge: '_e0' }],
      exposure: 'e',
      outcome: 'd',
    },
  });
  assert.equal(out.classifications[0]!.type, 'invalid');
  assert.deepEqual(out.diagnostics.flags, []);
});

test('classify_effect_modification: response includes engine_version', () => {
  const out = handler({ dag: EM01_DIRECT });
  assert.match(out.engine_version, /^\d+\.\d+\.\d+\+\S+$/);
});
