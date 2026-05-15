// Run with: npm run test:tools

import test from 'node:test';
import assert from 'node:assert/strict';

import { handler } from '../src/tools/validate_engine.js';

test('validate_engine: default suite=all → 35 cases all pass', () => {
  const out = handler({});
  assert.equal(out.total, 35);
  assert.equal(out.passed, 35);
  assert.equal(out.all_pass, true);
  assert.deepEqual(out.reference_implementations, ['Pearl 2009', 'dagitty (Textor et al. 2016)']);
});

test('validate_engine: suite=main → 15 T-cases', () => {
  const out = handler({ suite: 'main' });
  assert.equal(out.total, 15);
  assert.equal(out.passed, 15);
  assert.ok(out.results.every(r => r.id.startsWith('T')));
});

test('validate_engine: suite=effect_modification → 20 EM cases', () => {
  const out = handler({ suite: 'effect_modification' });
  assert.equal(out.total, 20);
  assert.equal(out.passed, 20);
  assert.ok(out.results.every(r => r.id.startsWith('EM')));
  assert.ok(out.results.every(r => r.category === 'Effect Modification'));
});

test('validate_engine: response includes engine_version', () => {
  const out = handler({});
  assert.match(out.engine_version, /^\d+\.\d+\.\d+\+\S+$/);
});

test('validate_engine: results include expected/got per case', () => {
  const out = handler({ suite: 'main' });
  const t02 = out.results.find(r => r.id === 'T02');
  assert.ok(t02);
  assert.equal(t02!.pass, true);
  assert.ok(t02!.expected);
  assert.ok(t02!.got);
});
