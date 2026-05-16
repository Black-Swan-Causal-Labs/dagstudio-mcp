# DAG Studio: Alignment with FDA Draft Guidance on Non-Interventional Studies

**Document status:** Working document, v0.1
**Last updated:** April 2026
**Related:** [`MCP_REQUIREMENTS.md`](./MCP_REQUIREMENTS.md)

---

## 1. Purpose

This document maps the capabilities of DAG Studio (and its forthcoming Model Context
Protocol server) onto the protocol elements described in FDA's draft guidance
*Real-World Evidence: Considerations Regarding Non-Interventional Studies for Drug and
Biological Products* (March 2024). Its audience is methodologists, sponsors, and
reviewers evaluating whether DAG Studio is appropriate for their workflow. It is
also intended as a reference for the methods section of the DAG Studio preprint.

The document does **not** claim DAG Studio satisfies, fulfills, or guarantees
compliance with any FDA expectation. Guidance is non-binding by definition, the
document in question is still in draft form, and tool-based approaches to
methodology are inherently limited (see §6). What is claimed is narrower: DAG
Studio is designed to produce the artifact and support the analyses that the
guidance describes, with explicit acknowledgment of the gaps.

---

## 2. Status of the guidance

The March 2024 draft remains in draft form as of April 2026; the 90-day comment
period closed in 2024 but FDA has not yet finalized the document. In the same
period, FDA has signaled active movement on RWE policy:

- On December 18, 2025, FDA finalized the parallel device-side guidance,
  *Use of Real-World Evidence to Support Regulatory Decision-Making for Medical
  Devices*, with sponsors expected to operationalize it by February 16, 2026.
- FDA has indicated it intends to consider parallel updates for drugs and
  biologics in the future.

The trajectory is clear even if the non-interventional studies document is not
yet final. Sponsors who anticipate the requirement now will be better positioned
when it lands. The mapping below is intended to support that anticipation.

---

## 3. The relevant footnote

Section III.C of the draft lists, as the first study-design element each protocol
must describe:

> *Schema to describe overall study design as well as a causal diagram[16] to
> specify the theorized causal relationship.*

Footnote 16 names directed acyclic graphs (DAGs; citing Greenland, Pearl, and
Robins 1999) and single-world intervention graphs (SWIGs; Richardson and Robins
2013) as examples of causal diagrams. FDA does not endorse a particular notation.

DAG Studio produces DAGs. SWIG support is identified as a v2 commitment in §5.

---

## 4. Protocol element mapping

The following tables map each protocol element FDA lists to (a) the corresponding
DAG Studio capability and (b) the MCP tool that exposes it to agentic workflows.
"Direct fit" means DAG Studio supports the element in its current form. "Partial
fit" means DAG Studio supports the underlying analysis but a templated workflow
or first-class field is not yet implemented. "Out of scope" means the element is
not graph-theoretic and DAG Studio should remain silent on it.

### 4.1 §III.B — Summary of the proposed approach

| FDA element | Fit | DAG Studio capability | MCP tool |
|---|---|---|---|
| Research question and hypothesis | Out of scope | — | — |
| Rationale for non-interventional design | Out of scope | — | — |
| Choice of study design (cohort, case-control, self-controlled) | Partial | Different designs imply different DAG structures (e.g., case-control conditions on outcome); DAG Studio can encode but does not currently template by design type | `get_design_implications` (v1.1) |
| Selection of data sources | Out of scope | — | — |
| Preliminary feasibility studies | Out of scope | — | — |
| Approach to support causal inference (e.g., target trial emulation) | Direct | DAG Studio's canvas is the natural medium for encoding the causal structure of a target trial emulation | `analyze_dag`, `get_canonical_example` |
| Ethical considerations | Out of scope | — | — |

### 4.2 §III.C — Study design

| FDA element | Fit | DAG Studio capability | MCP tool |
|---|---|---|---|
| Schema and causal diagram | Direct | The core artifact DAG Studio produces; export to PNG, SVG, PPTX, PDF with citation footer | `analyze_dag` (returns canonical structure); `generate_code` (returns dagitty / networkx representation) |
| Source population | Out of scope | — | — |
| Eligibility and study population | Out of scope | — | — |
| Conceptual and operational definitions of variables | Partial | Node typing (exposure, outcome, confounder, mediator, latent, modifier) is the conceptual layer; operational definitions are not currently a first-class field | `node.operational_definition` extension (v1.1) |
| Relevant covariates and bias-handling strategies | Direct | `computeAdjustmentSets` returns the minimal sufficient adjustment set under Pearl's backdoor criterion, with three-way concordance against dagitty | `analyze_dag` |
| Index date / time zero | Partial | Time-varying DAGs are supported (T14 in validation suite); a first-class index-date annotation is not yet implemented | `check_temporal_consistency` (v1.1) |
| Immortal time | Partial | Encodable as a time-varying DAG; no canonical immortal-time template currently in the library | Library extension (v1.1) |
| Start and end of follow-up, censoring | Out of scope | — | — |

### 4.3 §III.D — Data sources

This section is entirely out of scope for DAG Studio. Data source assessment is
the responsibility of the sponsor, supported by FDA's parallel guidance documents
on EHRs, claims data, and registries. The MCP should not claim coverage of any
element in this section.

| FDA element | Fit |
|---|---|
| Description of data sources | Out of scope |
| Rationale for choosing data sources | Out of scope |
| Relevance to the drug-outcome association | Out of scope |
| Appropriateness of confounder information | Out of scope (but see §6 — domain-knowledge limit) |
| Data reliability and accrual | Out of scope |
| Common data models (e.g., OMOP) | Out of scope |
| Timing of assessments and completeness | Out of scope |
| Operational coding of variables | Partial — see §III.C operational definitions |
| Appropriateness for target patient population | Out of scope |
| Quality assurance | Out of scope |
| Data linkage | Out of scope |
| Additional primary data collection | Out of scope |

### 4.4 §III.E — Analytic approach

| FDA element | Fit | DAG Studio capability | MCP tool |
|---|---|---|---|
| Feasibility, sample size, power | Out of scope | — | — |
| Statistical method, estimand specification | Out of scope | — | — |
| Approach to confounding (including unmeasured) | Direct | Latent variable nodes encode unmeasured confounders; T15 (proxy / surrogate confounder) covers the canonical case; an unidentifiable DAG returns an empty adjustment set | `analyze_dag`, `get_canonical_example('T15')` |
| Evaluation of overadjustment for intermediate variables | Direct | T11 (descendant of exposure) detects this; the edge classifier distinguishes causal-path edges from backdoor edges | `check_overadjustment` |
| Subgroup analyses | Partial | Effect modification is encoded via modifier annotations; the classifier follows VanderWeele & Robins (2007) and Weinberg (2007) | `classify_effect_modification` |
| Differential surveillance / misclassification | Partial | Encodable via measurement-error nodes (true → measured); no canonical template currently in the library | Library extension (v1.1) |
| Reverse causality | Direct | Structurally representable; can be flagged when an edge runs backward against declared time-zero ordering | `check_temporal_consistency` (v1.1) |
| Missing or misclassified data | Out of scope | — | — |
| Multiplicity | Out of scope | — | — |
| Sensitivity analyses on adjustment choices | Direct | Linear Gaussian SEM simulation with deterministic seeding; OLS regression on simulated data with and without proposed adjustment set; comparison to true effect computed from edge coefficients | `simulate_data`, `compute_bias` |

---

## 5. SWIGs as a v2 commitment

Footnote 16 names SWIGs alongside DAGs as acceptable causal diagrams. DAG Studio
does not currently support SWIG notation. Neither does dagitty natively, so this
is not a relative weakness against the field, but it is a real gap relative to
the guidance.

SWIGs are particularly relevant for the regimes where target trial emulation is
hardest: time-varying treatments, dynamic treatment strategies, and per-protocol
estimands. These are exactly the cases that arise most often in pharmacoepi
studies submitted to FDA. SWIG support is therefore a natural v2 milestone, and
one that would distinguish DAG Studio further from existing graph tools.

The proposed scope for v2 SWIG support:

- A SWIG mode in the canvas allowing nodes to be split into factual and
  counterfactual versions under a specified intervention
- A `swig.transform` utility on the engine that converts a DAG plus an
  intervention specification into the corresponding SWIG
- Validation against worked examples from Richardson and Robins (2013)
- An MCP tool `transform_to_swig(dag, intervention)`

This is not a v1 commitment. It is filed here as a named v2 deliverable so the
direction of travel is explicit.

---

## 6. Methodological caveats

The mapping in §4 makes a careful distinction between elements DAG Studio
addresses and elements it does not. A separate caveat applies even to the
elements it does address: **DAG Studio verifies analyses given a DAG. It does
not verify that the DAG is the correct DAG.**

This distinction is structural, not a flaw of the implementation. Whether smoking
belongs upstream of CRP, whether LDL mediates or confounds the statin–MI
relationship, whether claims-based "heart failure" is the same construct as
echocardiographic heart failure, whether a healthy-adherer effect should be
modeled as a single node or decomposed — none of these are graph-theoretic
questions. They are domain knowledge questions, and they require expertise in
the relevant clinical area, the relevant pharmacology, and the data source.

This is the same limitation that applies to any DAG analysis tool, including
dagitty. It becomes more visible in the MCP context because an LLM that
confidently feeds an under-specified DAG into a verified engine produces output
that *appears* authoritative. Sponsors and reviewers using the MCP should treat
its outputs as conditional on the encoded structure.

The honest framing: DAG Studio and its MCP make the formal causal-inference
layer trustworthy and composable. The domain knowledge layer above it remains
the researcher's responsibility, augmented but not replaced by other tools the
agent may have access to (literature databases, data dictionaries, clinical
references).

This caveat should be reproduced in the MCP server's `analyze_dag` tool
description, the tool's response payload, and the preprint methods section.

---

## 7. Validation as the basis for regulatory-aligned use

The case for using DAG Studio in protocols intended for FDA submission rests on
the validation work, not on any feature claim. The current state:

- Three-way concordance with Pearl (2009) as theoretical ground truth and
  the dagitty R package (Textor et al. 2016) as reference implementation,
  across 15 canonical test cases (T01–T15) covering confounding, mediation,
  collider structures, M-bias, selection bias, instruments, frontdoor,
  over-adjustment, and time-varying confounding.
- Effect modification classification validated against 20 canonical structures
  from VanderWeele and Robins (2007) and Weinberg (2007) (EM01–EM20).
- Independent reproduction supported via the supplementary scripts
  `dag-studio-concordance.R` (dagitty R) and `dag-studio-headless-test.js`
  (Node.js).

For the MCP server, this validation gains a runtime dimension. Each
`analyze_dag` response includes a `concordance` field reporting whether the
DAG Studio engine and dagitty.js (run in parallel) agree on the analysis. This
converts validation from a one-time claim into a per-call guarantee. Agents and
researchers can verify trust in the analysis at the moment they rely on it. As
far as we are aware, no other causal inference tool currently provides this.

The preprint will frame this as a four-way concordance: Pearl analytical, dagitty
analytical, DAG Studio analytical, and DAG Studio empirical (via the simulation
engine, which numerically demonstrates that adjustment under the prescribed set
recovers the true effect while non-adjustment does not).

---

## 8. References

Greenland, S., Pearl, J., and Robins, J.M. (1999). Causal Diagrams for
Epidemiologic Research. *Epidemiology*, 10(1):37–48.

Pearl, J. (2009). *Causality: Models, Reasoning, and Inference* (2nd ed.).
Cambridge University Press.

Richardson, T.S. and Robins, J.M. (2013). Single World Intervention Graphs
(SWIGs): A Unification of the Counterfactual and Graphical Approaches to
Causality. Working Paper 128, Center for the Statistics and the Social
Sciences, University of Washington.

Textor, J., van der Zander, B., Gilthorpe, M.S., Liśkiewicz, M., and Ellison,
G.T.H. (2016). Robust causal inference using directed acyclic graphs: the R
package 'dagitty'. *International Journal of Epidemiology*, 45(6):1887–1894.

VanderWeele, T.J. and Robins, J.M. (2007). Four types of effect modification:
A classification based on directed acyclic graphs. *Epidemiology*, 18(5):561–568.

Weinberg, C.R. (2007). Can DAGs clarify effect modification?
*Epidemiology*, 18(5):569–572.

U.S. Food and Drug Administration (March 2024). *Real-World Evidence:
Considerations Regarding Non-Interventional Studies for Drug and Biological
Products. Draft Guidance for Industry.* [https://www.fda.gov/media/177128/download](https://www.fda.gov/media/177128/download)

U.S. Food and Drug Administration (December 2025). *Use of Real-World Evidence
to Support Regulatory Decision-Making for Medical Devices. Guidance for
Industry and Food and Drug Administration Staff.*

---

*DAG Studio v0.1.0 · Black Swan Causal Labs, LLC · MIT License · [github.com/Black-Swan-Causal-Labs/dag-studio](https://github.com/Black-Swan-Causal-Labs/dag-studio)*
