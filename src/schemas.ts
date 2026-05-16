// Shared Zod schemas + stable-API catalogs (spec §5).
// Per-tool input/output schemas live alongside each tool in src/tools/.

import { z } from 'zod';

// ─── Canonical DAG (spec §3) ────────────────────────────────────────────────

export const NodeTypeSchema = z.enum([
  'exposure', 'outcome', 'confounder', 'mediator',
  'latent', 'modifier', 'unclassified',
]);

export const NodeSchema = z.object({
  id: z.string(),
  label: z.string(),
  type: NodeTypeSchema.optional(),
  x: z.number().optional(),
  y: z.number().optional(),
});

export const EdgeSchema = z.object({
  src: z.string(),
  tgt: z.string(),
  id: z.string().optional(),
  bend: z.number().optional(),
});

export const ModifierSchema = z.object({
  id: z.string().optional(),
  src: z.string(),
  tgtEdge: z.string().optional(),
  emType: z.string().nullable().optional(),
});

export const DAGSchema = z.object({
  nodes: z.array(NodeSchema),
  edges: z.array(EdgeSchema),
  exposure: z.string().optional(),
  outcome: z.string().optional(),
  modifiers: z.array(ModifierSchema).optional(),
});

export type DAG = z.infer<typeof DAGSchema>;

// ─── Flag catalog (spec §5.2) ───────────────────────────────────────────────
// Stable API surface. Codes are not renamed or removed without a major
// version bump. Severity is fixed per code so agents can switch on it.

export const FLAG_SEVERITY = {
  IDENT_OK: 'info',
  IDENT_NONE: 'critical',
  IDENT_EMPTY_SET: 'info',
  IDENT_MULTIPLE_SETS: 'info',
  CONF_LATENT_ON_BACKDOOR: 'warning',
  OVERADJ_DESCENDANT: 'critical',
  OVERADJ_COLLIDER: 'critical',
  OVERADJ_DESCENDANT_OF_COLLIDER: 'warning',
  EM_DIRECT: 'info',
  EM_INDIRECT: 'warning',
  EM_COMMON_CAUSE: 'warning',
  EM_PROXY: 'info',
  EM_PURE_INTERACTION: 'info',
  STRUCT_LABEL_MISMATCH: 'warning',
  SIM_LINEAR_GAUSSIAN_ASSUMPTION: 'info',
  SIM_SEED_DETERMINISTIC: 'info',
} as const;

export type FlagCode = keyof typeof FLAG_SEVERITY;
export type FlagSeverity = (typeof FLAG_SEVERITY)[FlagCode];

export const FlagSchema = z.object({
  severity: z.enum(['info', 'warning', 'critical']),
  code: z.string(),
  message: z.string(),
});

export const DiagnosticsBlockSchema = z.object({
  identifiability: z.enum(['identifiable', 'unidentifiable', 'partially_identifiable']),
  unmeasured_confounding_present: z.boolean(),
  overadjustment_detected: z.boolean(),
  overadjustment_variables: z.array(z.string()).optional(),
  flags: z.array(FlagSchema),
});

export type DiagnosticsBlock = z.infer<typeof DiagnosticsBlockSchema>;

// ─── Citation catalog (spec §5.4) ───────────────────────────────────────────

export const CITATIONS = {
  pearl_backdoor: {
    source: 'Pearl 2009',
    reference: 'Theorem 3.3.2 (backdoor criterion); Cambridge University Press, 2nd ed.',
  },
  pearl_dseparation: {
    source: 'Pearl 2009',
    reference: 'Definition 1.2.3 (d-separation); Cambridge University Press, 2nd ed.',
  },
  pearl_sem: {
    source: 'Pearl 2009',
    reference: 'Chapter 5 (causal inference in linear systems); Cambridge University Press, 2nd ed.',
  },
  greenland_pearl_robins_1999: {
    source: 'Greenland, Pearl & Robins 1999',
    reference: 'Causal Diagrams for Epidemiologic Research, Epidemiology 10(1):37–48',
  },
  textor_dagitty_2016: {
    source: 'Textor et al. 2016',
    reference: "Robust causal inference using directed acyclic graphs: the R package 'dagitty', International Journal of Epidemiology 45(6):1887–1894",
  },
  schisterman_overadjustment_2009: {
    source: 'Schisterman, Cole & Platt 2009',
    reference: 'Overadjustment bias and unnecessary adjustment in epidemiologic studies, Epidemiology 20(4):488–495',
  },
  greenland_collider_2003: {
    source: 'Greenland 2003',
    reference: 'Quantifying biases in causal models: classical confounding versus collider-stratification bias, Epidemiology 14(3):300–306',
  },
  vanderweele_robins_em_2007: {
    source: 'VanderWeele & Robins 2007',
    reference: 'Four types of effect modification: a classification based on directed acyclic graphs, Epidemiology 18(5):561–568',
  },
  weinberg_em_2007: {
    source: 'Weinberg 2007',
    reference: 'Can DAGs clarify effect modification?, Epidemiology 18(5):569–572',
  },
} as const;

export type CitationKey = keyof typeof CITATIONS;

export const CitationSchema = z.object({
  source: z.string(),
  reference: z.string(),
  url: z.string().optional(),
});

export type Citation = z.infer<typeof CitationSchema>;

// ─── Concordance attestation (spec §5.3) ────────────────────────────────────

export const ConcordanceAttestationSchema = z.object({
  reference_engine: z.literal('dagitty'),
  reference_version: z.string(),
  reference_commit: z.string(),
  validated_at: z.string().nullable(),
  cases_validated: z.number().int().nonnegative(),
  cases_concordant: z.number().int().nonnegative(),
});

export type ConcordanceAttestation = z.infer<typeof ConcordanceAttestationSchema>;
