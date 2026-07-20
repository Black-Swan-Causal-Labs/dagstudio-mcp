# DAG Studio MCP Server: Requirements

**Document status:** Working spec, v0.1
**Last updated:** April 2026
**Related:** [`FDA_GUIDANCE_ALIGNMENT.md`](./FDA_GUIDANCE_ALIGNMENT.md)

> **Historical note (July 2026).** This is the v1 specification as written in April 2026. The implementation has since diverged in two documented ways: the `regulatory_considerations` response envelope (section 5.2) was renamed to `diagnostics` and its `fda_reference` flag field was removed (worker-v0.2.0), and the remote transport described as deferred in section 2.3 shipped as a Cloudflare Worker with a trial-access token gate. Tool contracts otherwise match this document.

---

## 1. Purpose and audience

This document specifies the design and v1 scope of the DAG Studio Model Context
Protocol (MCP) server. Its audience is the implementer (initially the maintainer,
later any contributor) and any reviewer evaluating the technical scope of the
build. It exists to answer the question: *what am I building, and is it done yet?*

The companion document [`FDA_GUIDANCE_ALIGNMENT.md`](./FDA_GUIDANCE_ALIGNMENT.md)
describes the regulatory rationale for each capability and the protocol elements
served. Where this document references a tool's regulatory motivation, it does
so in a single line and points to the alignment document for elaboration.

---

## 2. Architectural overview

The build separates into three artifacts. The first two are required for v1; the
third is optional for v1 and recommended for broader reach.

### 2.1 `dag-engine.js` — pure-function engine module

A standalone ES module exporting the analytical functions currently embedded in
`index.html`. Same code, lifted out, no behavior change. The browser app, the
MCP server, and the validation suite all import from this module.

Functions to extract (all already pure, all already validated):

- `descendants`, `allPaths`, `pathBlocked`
- `backdoorPaths`, `computeAdjustmentSets`
- `classifyEffectModification`
- `parseDagittyR` (renamed `parseDagitty` to drop the legacy R-runtime context)
- `generatePythonCode`, `generateRCode` (and helpers `_codeIdent`, `_identMap`,
  `_plotCoords`)
- `topoSort`, `boxMullerRandom`, `simulateData`
- `computeOLSCoefficients`, `computeTrueEffect`, `solveLinear`, `residualize`,
  `computeCorrelation`, `computePartialCorrelation`
- `dataToCSV`
- The `TESTS` array and `runTest` function (the canonical validation suite)
- The `EM_TESTS` array and `runEMTest` function

The extraction must be byte-for-byte semantically identical. The 15-case
concordance suite must pass after extraction with no edits.

### 2.2 `dag-studio-mcp` — MCP server package

A Node package using `@modelcontextprotocol/sdk` with TypeScript and Zod
schemas. Imports `dag-engine.js` and wraps each capability as an MCP tool.
Distributed via npm so consumers can run it with `npx -y dag-studio-mcp` from
Claude Desktop, Cursor, Cline, or any MCP-aware client.

Project layout:

```
dag-studio-mcp/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts            # server entry, stdio transport
│   ├── tools/              # one file per tool
│   ├── schemas.ts          # Zod schemas, shared response types
│   ├── attestation.ts      # static ConcordanceAttestation built at release time
│   └── version.ts          # engine_version pin
├── ci/
│   └── concordance.mjs     # release-gate dagitty parity check (CI only)
└── README.md
```

### 2.3 Remote MCP (optional, deferred)

A Cloudflare Workers deployment exposing the same server over HTTP/SSE for
zero-install use as a custom connector in Claude.ai. Same tool surface, same
schemas. Recommended once v1 has shipped and stabilized.

---

## 3. Data model

The canonical DAG representation is the same shape used throughout DAG Studio:

```ts
type Node = {
  id: string;
  label: string;
  type?: 'exposure' | 'outcome' | 'confounder' | 'mediator'
       | 'latent' | 'modifier' | 'unclassified';
  // x, y are optional metadata for layout; not used in analysis
  x?: number;
  y?: number;
};

type Edge = {
  src: string;  // source node id
  tgt: string;  // target node id
  // bend, id are optional layout metadata
};

type DAG = {
  nodes: Node[];
  edges: Edge[];
  exposure?: string;  // node id
  outcome?: string;   // node id
  modifiers?: Modifier[];
};
```

Tools accept either a `DAG` object directly or a `dagitty_string` that is
parsed via `parseDagitty` into the canonical shape. Layout metadata (`x`, `y`,
`bend`) is preserved on round-trip but never required.

---

## 4. Tool catalog (v1)

Each tool entry below specifies purpose, FDA cross-reference, input, output,
and key error semantics. Full Zod schemas live in `schemas.ts`; this document
is the human-facing specification.

### 4.1 `analyze_dag`

**Purpose.** Primary tool. Given a DAG with declared exposure and outcome,
return the open backdoor paths, the minimal sufficient adjustment sets,
identifiability status, and all directed paths.

**FDA cross-reference.** §III.C "Relevant covariates and corresponding
strategies to address potential bias"; §III.E "Specific approach to account
for potential confounding factors, including assessment of unmeasured
confounding."

**Input.** `DAG` object **or** `{ dagitty_string: string }`.

**Output.**

```ts
{
  identifiable: boolean;             // true iff at least one valid set exists
  backdoor_paths: string[][];        // each path as ordered node-id list
  minimal_adjustment_sets: string[][]; // each set as node-id list
  all_directed_paths: string[][];
  exposure: string;
  outcome: string;
  concordance: ConcordanceAttestation;    // see §5.3
  regulatory_considerations: RegulatoryBlock;  // see §5.2
  engine_version: string;
  citations: Citation[];
}
```

**Error semantics.** Returns a structured error if the graph contains a
directed cycle, if exposure or outcome is unset or absent, or if the dagitty
string fails to parse. All errors include a remediation hint.

**Description (for the MCP tool descriptor).** Returns identifiability status
and minimal adjustment sets given the DAG provided. Does not validate that the
DAG correctly encodes domain knowledge or that the variables are measurable in
any specific dataset.

### 4.2 `parse_dagitty`

**Purpose.** Parse a dagitty DSL string into the canonical DAG shape. Useful as
a standalone input adapter and for agent workflows that round-trip between
notation and analysis.

**FDA cross-reference.** Supports §III.C bullet 1 (causal diagram artifact).

**Input.** `{ dagitty_string: string }`.

**Output.** A canonical `DAG` object.

**Error semantics.** Throws on missing `dagitty(...)` wrapper, malformed edge
operators, or empty graph.

### 4.3 `generate_code`

**Purpose.** Emit idiomatic Python (`networkx.DiGraph`) or R (`dagitty` DSL)
representing the DAG.

**FDA cross-reference.** Supports the executable-artifact side of §III.C
bullet 1; useful in §III.E sensitivity analysis workflows.

**Input.** `{ dag: DAG; language: 'python' | 'r' }`.

**Output.** `{ code: string; identifier_map: Record<string, string> }`.

The `identifier_map` lets agents trace canvas labels to sanitized code
identifiers when these differ.

### 4.4 `check_overadjustment`

**Purpose.** Given a DAG and a proposed adjustment set, identify any variable
in the set that is a descendant of the exposure (and therefore inappropriate
to condition on without changing the estimand).

**FDA cross-reference.** §III.E "Evaluation of potential overadjustment of
intermediate variables on the causal pathway." This is one of the few places
the guidance is technically specific, and this tool exists specifically to
serve it.

**Input.** `{ dag: DAG; adjustment_set: string[] }`.

**Output.**

```ts
{
  ok: boolean;
  problematic_variables: Array<{
    id: string;
    reason: 'descendant_of_exposure' | 'collider' | 'descendant_of_collider';
    explanation: string;
  }>;
  recommendation: string;  // human-readable summary
  regulatory_considerations: RegulatoryBlock;
  citations: Citation[];
}
```

### 4.5 `simulate_data`

**Purpose.** Generate synthetic data from a Linear Gaussian SEM consistent with
the DAG. Deterministic given seed.

**FDA cross-reference.** §III.E "Description of planned sensitivity analyses,
including details on which factors are proposed to be changed and rationale
for such changes."

**Input.**

```ts
{
  dag: DAG;
  n: number;                                // sample size, default 1000
  seed: number;                             // for reproducibility
  coefficients?: Record<string, number>;    // optional edge-keyed overrides
  format?: 'json' | 'csv';                  // default 'json'
}
```

**Output.**

```ts
{
  data: Array<Record<string, number>> | string;  // rows or CSV
  topological_order: string[];
  assumptions: {
    model: 'linear_gaussian_sem';
    root_distribution: 'N(0,1)';
    edge_coefficient_default: 0.5;
    error_distribution: 'N(0, 0.25)';
  };
  engine_version: string;
}
```

**Description.** Outputs are consistent with the DAG under the linear Gaussian
model only. Real datasets generated under unknown processes will not in general
match these distributions; the simulation is for sensitivity analysis and
demonstration of structural claims, not for substitute analysis of real data.

### 4.6 `compute_bias`

**Purpose.** Given a DAG and a proposed adjustment set, simulate data, fit
crude (`Y ~ X`) and adjusted (`Y ~ X + Z`) regressions, and report the bias of
each estimate against the true total causal effect computed from the SEM
coefficients.

**FDA cross-reference.** §III.E sensitivity analyses; supports demonstration
of why a structural claim ("adjust for {age, smoking}") matters numerically.

**Input.** `{ dag: DAG; adjustment_set: string[]; n: number; seed: number; coefficients?: Record<string, number> }`.

**Output.**

```ts
{
  true_effect: number;
  crude_estimate: number;
  crude_bias: number;
  adjusted_estimate: number;
  adjusted_bias: number;
  bias_reduction: number;             // |crude_bias| - |adjusted_bias|
  regulatory_considerations: RegulatoryBlock;
  engine_version: string;
}
```

### 4.7 `classify_effect_modification`

**Purpose.** For each modifier annotation on the DAG, classify the effect
modification structure per VanderWeele & Robins (2007) and Weinberg (2007).

**FDA cross-reference.** §III.E "Approach and rationale for subgroup analyses."

**Input.** `{ dag: DAG }` (with modifiers populated).

**Output.**

```ts
{
  classifications: Array<{
    modifier_id: string;
    target_edge: { src: string; tgt: string };
    type: 'direct' | 'indirect' | 'common-cause' | 'proxy' | 'pure-interaction';
    explanation: string;
  }>;
  citations: Citation[];
}
```

### 4.8 `get_canonical_example`

**Purpose.** Return one of the canonical validated DAGs from the test suite by
ID (T01–T15 for the main suite, EM01–EM20 for effect modification). Useful for
few-shot prompting, regression testing, and education.

**Input.** `{ id: string }`.

**Output.** A full `DAG` object plus the test's metadata: name, category,
description, expected backdoor count, expected adjustment sets, and citations.

### 4.9 `validate_engine`

**Purpose.** Run the full canonical validation suite (T01–T15 plus EM01–EM20)
against the current engine and return pass/fail per case. Lets agents verify
trust in the engine before relying on its output.

**FDA cross-reference.** Supports the methodological-defensibility posture the
guidance implicitly requires; documented in [`FDA_GUIDANCE_ALIGNMENT.md`](./FDA_GUIDANCE_ALIGNMENT.md) §7.

**Input.** None, or `{ suite?: 'main' | 'effect_modification' | 'all' }`.

**Output.**

```ts
{
  passed: number;
  total: number;
  all_pass: boolean;
  results: Array<{
    id: string;
    name: string;
    category: string;
    pass: boolean;
    expected: object;
    got: object;
  }>;
  engine_version: string;
  reference_implementations: ['Pearl 2009', 'dagitty (Textor et al. 2016)'];
}
```

---

## 5. Response conventions

### 5.1 `engine_version`

Every tool response includes `engine_version`, pinned to a semver string and
the corresponding git commit short hash:

```ts
type EngineVersion = `${string}+${string}`;  // e.g., "0.1.0+a3f1b2c"
```

This makes responses reproducible: an agent or researcher who saved an
`analyze_dag` output can re-run it against the same engine version later and
expect identical results.

### 5.2 `regulatory_considerations` block

Tools that return analytical results include a `regulatory_considerations`
block phrased in the FDA's vocabulary. This is the artifact agents will surface
to users drafting protocols. Schema:

```ts
type RegulatoryBlock = {
  identifiability: 'identifiable' | 'unidentifiable' | 'partially_identifiable';
  unmeasured_confounding_present: boolean;
  overadjustment_detected: boolean;
  overadjustment_variables?: string[];
  flags: Array<{
    severity: 'info' | 'warning' | 'critical';
    code: string;       // stable identifier, e.g., 'OVERADJ_DESCENDANT'
    message: string;    // human-readable
    fda_reference?: string;  // e.g., '§III.E bullet 4'
  }>;
};
```

The top-level fields (`identifiability`, `unmeasured_confounding_present`,
`overadjustment_detected`) carry the headline status; the `flags` array
carries the structural reason for that status, plus any context an agent
should surface when drafting protocol text. The v1 engine emits
`partially_identifiable` only as a placeholder for v1.1 mediation tools; in
v1, the enum reduces to `identifiable | unidentifiable`.

#### Flag catalog

Flag codes are stable API surface. Once published in v0.1.0 they are the
contract that agents and downstream tooling key against. New flags may be
added in minor versions; existing codes are not renamed or removed without a
major version increment. Severity is fixed per code so agents can switch on
it without parsing the message.

**Identifiability** (FDA §III.C variable strategy; §III.E unmeasured
confounding)

- `IDENT_OK` *(info)*: At least one minimal sufficient adjustment set blocks
  every backdoor path; the total effect is identifiable from the declared
  variables. *(§III.C)*
- `IDENT_NONE` *(critical)*: No subset of the declared covariates blocks all
  backdoor paths; the total effect is not identifiable through covariate
  adjustment alone. *(§III.E unmeasured confounding)*
- `IDENT_EMPTY_SET` *(info)*: No backdoor paths exist; the total effect is
  identifiable without adjustment. *(§III.C)*
- `IDENT_MULTIPLE_SETS` *(info)*: More than one minimal sufficient adjustment
  set exists. The choice between them should be defended on measurement,
  precision, or sample-size grounds rather than left implicit. *(§III.C)*

**Confounding**

- `CONF_LATENT_ON_BACKDOOR` *(warning)*: A node typed `latent` lies on at
  least one open backdoor path. Identifiability through measured covariates
  alone is impossible without further structural assumptions; sensitivity
  analyses are warranted. *(§III.E unmeasured confounding)*

**Overadjustment** (FDA §III.E bullet 4)

- `OVERADJ_DESCENDANT` *(critical)*: The proposed adjustment set contains a
  descendant of the exposure. Conditioning on it blocks part of the causal
  effect being estimated and changes the estimand. *(§III.E bullet 4)*
- `OVERADJ_COLLIDER` *(critical)*: The proposed adjustment set contains a
  collider whose conditioning is not justified by another variable in the
  set. Conditioning opens a non-causal path and induces selection bias.
  *(§III.E bullet 4)*
- `OVERADJ_DESCENDANT_OF_COLLIDER` *(warning)*: The proposed adjustment set
  contains a descendant of an unconditioned collider. This can induce the
  same M-bias as conditioning on the collider directly. *(§III.E bullet 4)*

**Effect modification** (FDA §III.E subgroup analyses; classifications follow
VanderWeele & Robins 2007 and Weinberg 2007)

- `EM_DIRECT` *(info)*: The modifier is structurally independent of the
  exposure-outcome system; subgroup-specific effects are interpretable as
  pure modification. *(§III.E subgroup analyses)*
- `EM_INDIRECT` *(warning)*: The modifier acts through a mediator of the
  exposure-outcome effect. Subgroup-specific effects conflate modification
  with mediation and may not generalize to subjects in whom the mediator is
  intervened on. *(§III.E subgroup analyses)*
- `EM_COMMON_CAUSE` *(warning)*: The modifier shares an ancestor with the
  exposure. Subgroup-specific effects are confounded by the shared ancestor
  unless that ancestor is also adjusted for. *(§III.E subgroup analyses)*
- `EM_PROXY` *(info)*: The modifier is unobserved; subgroup analyses rest on
  a downstream proxy and results may not transfer to the latent modifier.
  *(§III.E subgroup analyses)*
- `EM_PURE_INTERACTION` *(info)*: The modifier has a direct effect on the
  outcome alongside the exposure. The appropriate target estimand is the
  joint effect, not a subgroup-specific effect (Weinberg 2007). *(§III.E
  subgroup analyses)*

**Structural conflicts** (FDA §III.C variable conceptualization)

- `STRUCT_LABEL_MISMATCH` *(warning)*: A node's user-assigned role (e.g.,
  "confounder") disagrees with its structural role inferred from the DAG
  (e.g., it is a mediator). The DAG, not the label, is the analytical
  ground truth; the mismatch should be reconciled before relying on the
  result. *(§III.C)*

**Simulation caveats** (emitted by `simulate_data` and `compute_bias`)

- `SIM_LINEAR_GAUSSIAN_ASSUMPTION` *(info)*: Output is conditional on the
  linear Gaussian SEM (root variables N(0,1); edges β=0.5 by default; errors
  N(0, 0.25)). Results do not generalize to nonlinear, non-Gaussian, or
  non-additive processes. *(§III.E sensitivity analyses)*
- `SIM_SEED_DETERMINISTIC` *(info)*: Output is deterministic given seed;
  vary seed and aggregate to characterize stochastic variation. *(§III.E
  sensitivity analyses)*

#### Per-tool emission

| Tool | Flags emitted |
|------|---------------|
| `analyze_dag` | `IDENT_OK`, `IDENT_NONE`, `IDENT_EMPTY_SET`, `IDENT_MULTIPLE_SETS`, `CONF_LATENT_ON_BACKDOOR`, `STRUCT_LABEL_MISMATCH` |
| `check_overadjustment` | `OVERADJ_DESCENDANT`, `OVERADJ_COLLIDER`, `OVERADJ_DESCENDANT_OF_COLLIDER` |
| `classify_effect_modification` | `EM_DIRECT`, `EM_INDIRECT`, `EM_COMMON_CAUSE`, `EM_PROXY`, `EM_PURE_INTERACTION` |
| `simulate_data` | `SIM_LINEAR_GAUSSIAN_ASSUMPTION`, `SIM_SEED_DETERMINISTIC` |
| `compute_bias` | `SIM_LINEAR_GAUSSIAN_ASSUMPTION`, `SIM_SEED_DETERMINISTIC`, plus any `OVERADJ_*` flag the proposed adjustment set triggers |

Tools that perform pure transformations or diagnostics (`parse_dagitty`,
`generate_code`, `get_canonical_example`, `validate_engine`) do not emit
regulatory flags.

### 5.3 `concordance` attestation

Each release of the engine is gated on a nightly CI job that runs the canonical
suite (T01–T15 plus EM01–EM20) through both DAG Studio's engine and the
upstream dagitty implementation, and asserts bit-equivalent results on every
case. A release that fails the gate does not ship. The `engine_version` in
every response therefore implies concordance with dagitty at the moment of
release; responses carry a static attestation pointing back to the gate that
admitted them:

```ts
type ConcordanceAttestation = {
  reference_engine: 'dagitty';
  reference_version: string;    // e.g., "3.1.0"
  reference_commit: string;     // dagitty source short hash the gate ran against
  validated_at: string;         // ISO 8601 timestamp of the gate run
  cases_validated: number;      // e.g., 35
  cases_concordant: number;     // e.g., 35
};
```

Per-call concordance was considered and rejected for two reasons. First,
dagitty is GPL-2.0 licensed and the MCP package is MIT; bundling the reference
engine into a published npm package is a license-compatibility question we do
not want to inherit at the runtime path. Second, executing dagitty on every
request would add latency to `analyze_dag` for no marginal trust value beyond
what a release gate already provides when the gate covers every case. A future
deployment that needs runtime concordance against a private engine extension
can add it as an optional subprocess-isolated path without altering this
schema.

### 5.4 Citations

Every analytical response includes a `citations` array pointing to the
methodological basis for the result:

```ts
type Citation = {
  source: string;       // e.g., "Pearl 2009"
  reference: string;    // e.g., "Theorem 3.3.2 (backdoor criterion)"
  url?: string;
};
```

Agents drafting protocol text will use these citations directly. The tool
should not invent citations; it should only emit references that correspond
to the algorithms actually used.

#### Citation catalog

Like the flag catalog in §5.2, citations are stable API surface. The `source`
and `reference` strings are the contract that downstream protocol templates
copy verbatim. New entries may be added in minor versions; existing entries
are not modified without a major version increment. Bibliographic records
mirror [`FDA_GUIDANCE_ALIGNMENT.md`](./FDA_GUIDANCE_ALIGNMENT.md) §8 where
applicable; entries marked *(MCP-only)* are needed for `check_overadjustment`
and `compute_bias` and are not present in the companion document.

URLs are optional in the schema. The catalog leaves them unspecified so
implementations can pick a stable canonical link (DOI, publisher page, or
preprint) at publish time without locking the spec to a specific resolver.

**Foundations**

- `pearl_backdoor`
  - `source`: `"Pearl 2009"`
  - `reference`: `"Theorem 3.3.2 (backdoor criterion); Cambridge University Press, 2nd ed."`
- `pearl_dseparation`
  - `source`: `"Pearl 2009"`
  - `reference`: `"Definition 1.2.3 (d-separation); Cambridge University Press, 2nd ed."`
- `pearl_sem`
  - `source`: `"Pearl 2009"`
  - `reference`: `"Chapter 5 (causal inference in linear systems); Cambridge University Press, 2nd ed."`
- `greenland_pearl_robins_1999`
  - `source`: `"Greenland, Pearl & Robins 1999"`
  - `reference`: `"Causal Diagrams for Epidemiologic Research, Epidemiology 10(1):37–48"`

**dagitty implementation reference**

- `textor_dagitty_2016`
  - `source`: `"Textor et al. 2016"`
  - `reference`: `"Robust causal inference using directed acyclic graphs: the R package 'dagitty', International Journal of Epidemiology 45(6):1887–1894"`

**Overadjustment** *(MCP-only)*

- `schisterman_overadjustment_2009`
  - `source`: `"Schisterman, Cole & Platt 2009"`
  - `reference`: `"Overadjustment bias and unnecessary adjustment in epidemiologic studies, Epidemiology 20(4):488–495"`
- `greenland_collider_2003`
  - `source`: `"Greenland 2003"`
  - `reference`: `"Quantifying biases in causal models: classical confounding versus collider-stratification bias, Epidemiology 14(3):300–306"`

**Effect modification**

- `vanderweele_robins_em_2007`
  - `source`: `"VanderWeele & Robins 2007"`
  - `reference`: `"Four types of effect modification: a classification based on directed acyclic graphs, Epidemiology 18(5):561–568"`
- `weinberg_em_2007`
  - `source`: `"Weinberg 2007"`
  - `reference`: `"Can DAGs clarify effect modification?, Epidemiology 18(5):569–572"`

#### Per-tool emission

| Tool | Always emits | Conditionally emits |
|------|--------------|---------------------|
| `analyze_dag` | `pearl_backdoor`, `pearl_dseparation`, `greenland_pearl_robins_1999`, `textor_dagitty_2016` | (none) |
| `check_overadjustment` | `pearl_backdoor` | `schisterman_overadjustment_2009` on any `OVERADJ_DESCENDANT`; `greenland_collider_2003` on any `OVERADJ_COLLIDER` or `OVERADJ_DESCENDANT_OF_COLLIDER` |
| `classify_effect_modification` | `vanderweele_robins_em_2007` | `weinberg_em_2007` on `EM_PURE_INTERACTION` |
| `simulate_data` | `pearl_sem` | (none) |
| `compute_bias` | `pearl_sem`, `pearl_backdoor` | `schisterman_overadjustment_2009` and `greenland_collider_2003` on the same triggers as `check_overadjustment` |

`parse_dagitty` and `generate_code` perform pure transformations and emit no
citations. `get_canonical_example` returns the canonical example's own
citations (per-test metadata baked into the engine, not from this catalog).
`validate_engine` reports `reference_implementations` per its schema in §4.9
rather than a `citations` array.

---

## 6. Validation strategy

Three layers, each enforced in CI:

1. **Engine parity.** After extraction, the canonical 15-case suite must pass
   identically to the in-browser version. This is a regression check; the
   engine is the single source of truth.

2. **Schema parity.** Every tool's input and output must validate against its
   Zod schema in CI. A mismatch fails the build.

3. **Concordance.** A nightly CI job runs the full T01–T15 plus EM01–EM20
   suite through both DAG Studio's engine and the upstream dagitty
   implementation and asserts bit-equivalent results on every case. The job
   is release-blocking: any disagreement fails the build, and the engine
   version cannot increment until the discrepancy is resolved or the case is
   reconciled into the canonical suite. The `dagitty-node.js` build artifact
   and its `underscore` dependency live in the CI environment only and never
   enter the published npm package; concordance is a release-time guarantee,
   not a runtime one (see §5.3).

The independent reproduction scripts (`dag-studio-concordance.R` and
`dag-studio-headless-test.js`) ship in the repo and are referenced from the
preprint.

---

## 7. v1 scope and deferred items

### 7.1 In scope for v1

- The nine tools listed in §4
- `dag-engine.js` extraction with full test parity
- Zod schemas for every input and output
- `regulatory_considerations`, `engine_version`, `concordance`, and `citations`
  on every analytical response
- `npm publish` and Claude Desktop / Cursor / Cline configuration examples in
  the README
- The independent reproduction scripts referenced from the preprint

### 7.2 Deferred to v1.1

- `check_temporal_consistency` — flags edges that run backward against
  declared time-zero ordering (FDA §III.C immortal time, §III.E reverse
  causality)
- `get_target_trial_template` — returns a starter DAG keyed on study type
  (FDA §III.B target trial emulation)
- `get_design_implications` — returns DAG-encoded assumptions of cohort vs.
  case-control vs. self-controlled designs (FDA §III.B study design choice)
- `node.operational_definition` field — first-class operational-definition
  metadata on nodes (FDA §III.C conceptual vs. operational definitions)
- Library extensions: canonical immortal-time DAG, canonical
  measurement-error DAG, canonical source-vs-study-population DAG
- Remote MCP deployment via Cloudflare Workers

### 7.3 Deferred to v2

- SWIG support: canvas mode, `swig.transform` engine utility, validation
  against worked examples from Richardson and Robins (2013), MCP tool
  `transform_to_swig`
- A separate `suggest_confounders` tool that takes an exposure, outcome, and
  study population and returns literature-grounded candidate confounders.
  This crosses the boundary from formal analysis into domain knowledge and is
  philosophically distinct — see [`FDA_GUIDANCE_ALIGNMENT.md`](./FDA_GUIDANCE_ALIGNMENT.md) §6.

### 7.4 Out of scope (permanent)

The MCP will not provide tools for: data source assessment, sample size and
power calculation, estimand specification, missing data handling, multiplicity
adjustment, or ethical review. These are not graph-theoretic. Pretending
otherwise would undermine the trust the validation work establishes. See
[`FDA_GUIDANCE_ALIGNMENT.md`](./FDA_GUIDANCE_ALIGNMENT.md) §4.3 for the full
list of FDA elements treated as permanently out of scope.

Bundling the dagitty reference engine into the published npm package is also
permanently out of scope for license-compatibility reasons (dagitty is GPL-2.0,
the MCP package is MIT); concordance is enforced at release time per §5.3, not
at runtime.

---

## 8. Open questions

A few decisions deserve explicit resolution before implementation begins.

**Engine module format.** ESM-only is cleaner; CJS interop expands the
audience. Recommend ESM with an explicit `exports` map; revisit if a serious
consumer reports CJS friction.

**Concordance behavior on gate disagreement.** When the CI gate finds a
discrepancy between DAG Studio and dagitty on a canonical case, the release
is blocked. The case is investigated, the resolution (engine fix, dagitty
upstream report, or canonical-suite refinement) is captured in the changelog,
and only then does `engine_version` increment. Releases never ship with
unresolved discrepancies and are never silently flagged with
`concordance: false`.

**Default seed for `simulate_data`.** A fixed default is reproducible across
agent calls, which is desirable for sensitivity analysis comparison; a random
default surfaces stochastic variation. Recommend a fixed default of `42`
(matching the canvas), with the seed always present in the response.

**Tool descriptor wording.** The descriptions agents read at tool-discovery
time are load-bearing for whether tools are used well or used badly. Worth a
focused review pass once the package is otherwise complete; consider testing
descriptions against an LLM with realistic prompts before the first npm
publish.

---

## 9. References

The methodological references are listed in [`FDA_GUIDANCE_ALIGNMENT.md`](./FDA_GUIDANCE_ALIGNMENT.md) §8.

Implementation references:

- Anthropic. *Model Context Protocol specification.* [modelcontextprotocol.io](https://modelcontextprotocol.io)
- Ankerl, M. et al. `dagitty` JavaScript implementation. [dagitty/dagitty (GitHub)](https://github.com/jtextor/dagitty)
- Colin McDonnell. `zod`. [github.com/colinhacks/zod](https://github.com/colinhacks/zod)

---

*DAG Studio v0.1.0 · Black Swan Causal Labs, LLC · Apache License 2.0 · [github.com/Black-Swan-Causal-Labs/dagstudio-mcp](https://github.com/Black-Swan-Causal-Labs/dagstudio-mcp)*
