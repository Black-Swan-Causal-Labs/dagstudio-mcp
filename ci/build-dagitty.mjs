// Concatenate the vendored dagitty source into a single Node-loadable bundle,
// mirroring the upstream Makefile recipe (jslib/Makefile, target dagitty-node.js):
//
//     dagitty-node.js : node-pre.js $(GRAPH_FILES) node-post.js
//         cat $^ > $@
//
// where GRAPH_FILES is the ordered list reproduced below. The bundle is
// CommonJS (uses `require('underscore')` and `module.exports`), so we emit
// it with a .cjs extension — this package is `"type": "module"` in
// package.json, which would otherwise force .js to be parsed as ESM. Output
// is gitignored (ci/dagitty-node.cjs); regenerate with `node ci/build-dagitty.mjs`.
//
// The bundle's runtime dep is `underscore` (declared as a devDependency of
// dag-studio-mcp). The published npm package never includes ci/* — the
// `files` array in package.json restricts the tarball to dist/ + README.md +
// LICENSE.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, 'dagitty-src');

// Order matches jslib/Makefile's GRAPH_FILES. Order is load-bearing: Class,
// Hash, Graph define the base classes; later files extend them.
const FILES = [
  'node-pre.js',
  'graph/Class.js',
  'graph/Hash.js',
  'graph/Graph.js',
  'graph/GraphAnalyzer.js',
  'graph/GraphLayouter.js',
  'graph/GraphParser.js',
  'graph/GraphTransformer.js',
  'graph/GraphGenerator.js',
  'graph/ObservedGraph.js',
  'graph/GraphSerializer.js',
  'graph/MPolynomials.js',
  'parser/GraphDotParser.js',
  'node-post.js',
];

const parts = FILES.map(f => readFileSync(resolve(SRC, f), 'utf8'));
const bundle = parts.join('\n');
const out = resolve(HERE, 'dagitty-node.cjs');
writeFileSync(out, bundle);

console.error(`build-dagitty: wrote ${out} (${bundle.length} bytes from ${FILES.length} files)`);
