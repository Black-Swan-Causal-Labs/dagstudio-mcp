// Run with: npm run test:tools (uses tsx loader + node:test)

import test from 'node:test';
import assert from 'node:assert/strict';

import { handler, InputSchema } from '../src/tools/parse_dagitty.js';

test('parse_dagitty: classic confounding round-trip', () => {
  const dsl = `dagitty('dag { X [exposure]; Y [outcome]; C; X -> Y; C -> X; C -> Y }')`;
  const result = handler(InputSchema.parse({ dagitty_string: dsl }));
  assert.equal(result.exposure, 'X');
  assert.equal(result.outcome, 'Y');
  assert.equal(result.nodes.length, 3);
  assert.equal(result.edges.length, 3);
  const types = Object.fromEntries(result.nodes.map(n => [n.id, n.type]));
  assert.equal(types['X'], 'exposure');
  assert.equal(types['Y'], 'outcome');
  assert.equal(types['C'], 'unclassified');
});

test('parse_dagitty: latent role maps to type=latent', () => {
  const dsl = `dagitty('dag { U [latent]; X [exposure]; Y [outcome]; X -> Y; U -> X; U -> Y }')`;
  const result = handler(InputSchema.parse({ dagitty_string: dsl }));
  const types = Object.fromEntries(result.nodes.map(n => [n.id, n.type]));
  assert.equal(types['U'], 'latent');
});

test('parse_dagitty: chained edge syntax (A -> B -> C)', () => {
  const dsl = `dagitty('dag { X [exposure]; M; Y [outcome]; X -> M -> Y }')`;
  const result = handler(InputSchema.parse({ dagitty_string: dsl }));
  assert.equal(result.edges.length, 2);
  assert.deepEqual(
    result.edges.map(e => `${e.src}->${e.tgt}`).sort(),
    ['M->Y', 'X->M']
  );
});

test('parse_dagitty: bidirected and undirected edges are skipped', () => {
  const dsl = `dagitty('dag { A; B; C; D; A -> B; C <-> D; A -- B }')`;
  const result = handler(InputSchema.parse({ dagitty_string: dsl }));
  // Only the A -> B directed edge survives.
  assert.deepEqual(result.edges, [{ src: 'A', tgt: 'B' }]);
});

test('parse_dagitty: throws on missing dagitty(...) wrapper', () => {
  assert.throws(
    () => handler(InputSchema.parse({ dagitty_string: 'X -> Y' })),
    /dagitty/i
  );
});

test('parse_dagitty: rejects empty dagitty_string at the schema layer', () => {
  assert.throws(() => InputSchema.parse({ dagitty_string: '' }));
});
