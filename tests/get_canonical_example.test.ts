// Run with: npm run test:tools

import test from 'node:test';
import assert from 'node:assert/strict';

import { handler } from '../src/tools/get_canonical_example.js';

test('get_canonical_example: T01 returns full DAG + expected metadata', () => {
  const out = handler({ id: 'T01' });
  assert.equal(out.id, 'T01');
  assert.match(out.name, /Mediation/);
  assert.equal(out.category, 'Mediation');
  assert.equal(out.dag.exposure, 'X');
  assert.equal(out.dag.outcome, 'Y');
  assert.equal(out.expected_backdoor_count, 0);
  assert.deepEqual(out.expected_adjustment_sets, [[]]);
  assert.ok(out.citations.length >= 1);
  assert.match(out.engine_version, /^\d+\.\d+\.\d+\+\S+$/);
});

test('get_canonical_example: T06 carries no_adjustment_possible=true', () => {
  const out = handler({ id: 'T06' });
  assert.equal(out.no_adjustment_possible, true);
  assert.deepEqual(out.expected_adjustment_sets, []);
});

test('get_canonical_example: EM01 returns DAG with modifiers and EM expected', () => {
  const out = handler({ id: 'EM01' });
  assert.equal(out.id, 'EM01');
  assert.equal(out.category, 'Effect Modification');
  assert.deepEqual(out.expected_em_classifications, ['direct']);
  assert.ok(out.dag.modifiers && out.dag.modifiers.length === 1);
  assert.equal(out.dag.modifiers![0]!.src, 'm');
  // Modifier's tgtEdge should reference one of the synthetic edge ids the
  // engine assigns at EM-test runtime.
  const edgeIds = new Set(out.dag.edges.map(e => e.id));
  assert.ok(edgeIds.has(out.dag.modifiers![0]!.tgtEdge));
});

test('get_canonical_example: unknown ID throws with available list', () => {
  assert.throws(
    () => handler({ id: 'T99' }),
    /T01.*T15/s
  );
});

test('get_canonical_example: ID without T/EM prefix throws', () => {
  assert.throws(
    () => handler({ id: 'foo' }),
    /Main-suite IDs are T01–T15/
  );
});

test('get_canonical_example: refs with " · " split into source + reference', () => {
  // T02 has refs like "Greenland et al. · Epidemiology 1999"
  const out = handler({ id: 'T02' });
  const cite = out.citations.find(c => c.source.startsWith('Greenland'));
  assert.ok(cite, 'expected a Greenland citation');
  assert.equal(cite!.source, 'Greenland et al.');
  assert.equal(cite!.reference, 'Epidemiology 1999');
});
