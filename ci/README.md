# Release-gate concordance

`ci/` contains the release-time concordance check between DAG Studio's engine
and the upstream dagitty reference implementation (Textor et al. 2016, IJE).
Spec: [`MCP_REQUIREMENTS.md`](../../MCP_REQUIREMENTS.md) §5.3 and §6.3.

## License: GPL-2.0 carve-out

The vendored source under `dagitty-src/` is taken from
[github.com/jtextor/dagitty](https://github.com/jtextor/dagitty), which is
**GPL-2.0 licensed**. The DAG Studio MCP package is MIT. To keep these
licenses cleanly separated:

- `ci/` is **never** included in the published npm tarball. The
  `files` allow-list in [`package.json`](../package.json) restricts the
  package to `dist/`, `README.md`, and `LICENSE`.
- `dagitty-src/COMMIT.txt` pins the upstream commit (`7a65777…`).
- `dagitty-src/LICENSE.txt` is the unmodified GPL-2.0 text from upstream.

This is the same arrangement the spec describes: dagitty runs at release time
(in CI) to attest that DAG Studio's engine produces bit-equivalent results,
but never enters the runtime path of any consumer's installation.

## Scripts

- `build-dagitty.mjs` — concatenates the vendored sources into
  `dagitty-node.js` (gitignored), mirroring upstream's `jslib/Makefile`.
  Idempotent.
- `concordance.mjs` — runs T01–T15 through both engines and asserts
  set-of-sets equality on the minimal sufficient adjustment sets. Exits
  non-zero on disagreement. With `UPDATE_ATTESTATION=1` set, also rewrites
  `../src/attestation.ts` with the new attestation values.

## EM01–EM20 are *not* concordance-checked

dagitty does not natively classify modifiers per VanderWeele-Robins (2007) or
Weinberg (2007). EM cases are validated via the engine's own canonical
suite (`runEMTest`) — see `dag-engine.test.js` — but there is no upstream
implementation to compare against. Document this carve-out explicitly when
referring to "concordance" in publication or marketing.

## Running locally

```sh
cd dag-studio-mcp
npm install              # underscore is a devDependency, picked up here
npm run concordance      # builds bundle + runs check; non-zero exit on disagreement
```

To regenerate the attestation file after a successful run:

```sh
UPDATE_ATTESTATION=1 npm run concordance
```
