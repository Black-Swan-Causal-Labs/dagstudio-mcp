# dag-studio-mcp

Model Context Protocol (MCP) server for the [DAG Studio](https://github.com/Black-Swan-Causal-Labs/dag-studio) causal-inference engine. It lets AI agents construct, analyze, and validate causal directed acyclic graphs (DAGs) using the same engine that powers the [DAG Studio canvas](https://dagstudio.blackswancausallabs.com/).

Built and maintained by [Black Swan Causal Labs](https://blackswancausallabs.com). Listed in the [RWE MCP Registry](https://black-swan-causal-labs.github.io/RWE-MCP-Registry/).

## Tools

| Tool | What it does |
|---|---|
| `analyze_dag` | Backdoor paths, minimal sufficient adjustment sets, identifiability |
| `parse_dagitty` | Parse dagitty DSL (raw or R-wrapped) into the structured DAG model |
| `generate_code` | R / Python analysis code for a DAG, plus a one-click DAG Studio URL |
| `check_overadjustment` | Detect adjustment for mediators, colliders, and descendants of exposure |
| `simulate_data` | Simulate data from a DAG under user-specified structural coefficients |
| `compute_bias` | Empirical bias of an adjustment strategy against the simulated truth |
| `classify_effect_modification` | Classify effect-modifier structure (direct, indirect, proxy, common-cause, pure interaction) |
| `get_canonical_example` | Canonical teaching DAGs (confounding, M-bias, frontdoor, and others) |
| `validate_engine` | Run the full canonical validation suite and report engine version |

Every analytical response carries an `engine_version` stamp, a `concordance` attestation, a `diagnostics` block with severity-coded flags, and citations to the underlying methods literature.

## Validation

The engine is validated four ways for coherence: against Pearl (2009) theory, against the reference implementation dagitty (Textor et al. 2016), against DAG Studio's own analytical results, and empirically via `compute_bias` on simulated data.

- 35 canonical cases: T01 to T15 (structural identification) and EM01 to EM20 (effect modification), runnable live via `validate_engine`.
- A release-gate concordance check runs the engine head-to-head against dagitty (vendored at upstream commit `7a65777`) and stamps the attestation surfaced in tool responses.
- 93 unit and integration tests across the engine bindings, the tool layer, and the auth gate.

## Hosted endpoint

The server runs as a Cloudflare Worker (Streamable HTTP):

```
https://dagstudio-mcp.blackswancausallabs.com/mcp
```

Access is token-gated during the trial period. Request a token at jdiazdecaro@blackswancausallabs.com. Tokens are accepted either as a bearer header or as a `?token=` query parameter (the query form exists for clients whose connector UI cannot set custom headers, such as the Claude.ai web connector).

Claude Code:

```sh
claude mcp add --transport http dag-studio \
  https://dagstudio-mcp.blackswancausallabs.com/mcp \
  --header "Authorization: Bearer <your token>"
```

Claude.ai web: add a custom connector pointed at `https://dagstudio-mcp.blackswancausallabs.com/mcp?token=<your token>`.

## Repository layout

- `src/tools/`: one file per tool, each exporting `{ InputSchema, OutputSchema, descriptor, handler }`
- `src/worker/`: Cloudflare Worker transport and the token gate (`auth.ts`)
- `src/index.ts`: stdio entry point for local use
- `ci/`: release-gate concordance harness against vendored dagitty
- `tests/`: unit and integration tests (`npm test`)
- `MCP_REQUIREMENTS.md`: the v1 specification
- `FDA_GUIDANCE_ALIGNMENT.md`: mapping of DAG Studio capabilities onto FDA draft RWE guidance protocol elements

The analytical engine itself (`dag-engine.js`) lives in the open [dag-studio](https://github.com/Black-Swan-Causal-Labs/dag-studio) repository and is imported from a sibling checkout (`../../dag-engine.js` relative to `src/`). To build this package, clone both repositories with the layout the import expects, or vendor the engine file.

## Development

```sh
npm install
npm test                  # full suite
npm run dev               # stdio server via tsx
npm run worker:typecheck  # worker bundle typecheck
npm run worker:deploy     # deploy (stamps engine_version from git HEAD first)
```

For interactive inspection: `npx @modelcontextprotocol/inspector`.

## Protocol status

Built on `@modelcontextprotocol/sdk` (TypeScript). Current against the finalized MCP specification revision 2025-11-25. Migration to the 2026-07-28 revision is planned once stable SDK support ships.

## License

Apache License 2.0 (see `LICENSE`).

Exception: `ci/dagitty-src/` contains the dagitty reference engine (GPL-2.0, Textor et al.), vendored at upstream commit `7a65777` solely as a release-time CI fixture for the concordance check. It retains its own license, is excluded from the published npm package, and is not part of the deployed worker bundle.
