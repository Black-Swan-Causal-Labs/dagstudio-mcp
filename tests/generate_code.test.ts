// Run with: npm run test:tools

import test from 'node:test';
import assert from 'node:assert/strict';

import { handler } from '../src/tools/generate_code.js';
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

test('generate_code: python emits networkx.DiGraph', () => {
  const out = handler({ dag: T02_CONFOUNDING, language: 'python' });
  assert.equal(out.language, 'python');
  assert.match(out.code, /import networkx as nx/);
  assert.match(out.code, /dag = nx\.DiGraph\(\)/);
  assert.match(out.code, /dag\.add_edges_from/);
  assert.match(out.code, /dag\.graph\['exposure'\] = 'X'/);
  assert.deepEqual(out.identifier_map, { C: 'C', X: 'X', Y: 'Y' });
});

test('generate_code: r emits library(dagitty) + DSL', () => {
  const out = handler({ dag: T02_CONFOUNDING, language: 'r' });
  assert.equal(out.language, 'r');
  assert.match(out.code, /library\(dagitty\)/);
  assert.match(out.code, /dag <- dagitty\(/);
  assert.match(out.code, /X \[exposure\]/);
  assert.match(out.code, /Y \[outcome\]/);
  assert.match(out.code, /C -> X/);
});

test('generate_code: identifier_map sanitizes labels with special characters', () => {
  const out = handler({
    dag: {
      nodes: [
        { id: 'n1', label: 'Heart Failure', type: 'exposure' },
        { id: 'n2', label: '2024 LDL', type: 'outcome' },
      ],
      edges: [{ src: 'n1', tgt: 'n2' }],
      exposure: 'n1',
      outcome: 'n2',
    },
    language: 'python',
  });
  // Spaces become underscores, leading digits get an underscore prefix.
  assert.equal(out.identifier_map['n1'], 'Heart_Failure');
  assert.equal(out.identifier_map['n2'], '_2024_LDL');
});

test('generate_code: works on DAGs without x/y coordinates', () => {
  // Agent-supplied DAGs often don't carry layout coords. The tool defaults
  // missing x/y to 0 so the engine's coordinate-mapping helper doesn't
  // produce NaN values in the optional layout block.
  const out = handler({ dag: T02_CONFOUNDING, language: 'python' });
  assert.doesNotMatch(out.code, /NaN/);
});

test('generate_code: emits dagstudio_url pointing at the canonical canvas', () => {
  for (const language of ['r', 'python'] as const) {
    const out = handler({ dag: T02_CONFOUNDING, language });
    const u = new URL(out.dagstudio_url);
    assert.equal(u.origin + u.pathname, 'https://dagstudio.blackswancausallabs.com/');
    const dagitty = u.searchParams.get('dagitty');
    assert.ok(dagitty, `dagitty query param missing for language=${language}`);
    // The URL carries bare DSL (just the dag { ... } block) regardless of
    // which language was requested. The canvas's ?dagitty= handler auto-wraps
    // bare DSL in dagitty('...'); the R wrapper and comment header from
    // generateRCode would break that auto-wrap, so we strip them.
    assert.doesNotMatch(dagitty!, /library\(dagitty\)/);
    assert.doesNotMatch(dagitty!, /dagitty\(/);
    assert.match(dagitty!, /^dag \{/);
    assert.match(dagitty!, /X \[exposure\]/);
    assert.match(dagitty!, /Y \[outcome\]/);
    assert.match(dagitty!, /C -> X/);
  }
});
