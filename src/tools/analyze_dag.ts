// MCP tool: analyze_dag (spec §4.1).
// Returns identifiability, minimal adjustment sets, backdoor and directed
// paths, plus diagnostics / concordance / citations / engine_version
// (spec §5).

import { z } from 'zod';

import {
  computeAdjustmentSets,
  isDirectedCausalPath,
  hasCycle,
  detectTypeConflicts,
} from '../../dag-engine.js';
import type { EngineEdge, EngineNode } from '../../dag-engine.js';

import {
  CITATIONS,
  CitationSchema,
  ConcordanceAttestationSchema,
  DAGSchema,
  DiagnosticsBlockSchema,
  FLAG_SEVERITY,
} from '../schemas.js';
import type {
  Citation,
  DAG,
  DiagnosticsBlock,
  FlagCode,
} from '../schemas.js';
import { ATTESTATION } from '../attestation.js';
import { ENGINE_VERSION } from '../version.js';

import * as parseDagitty from './parse_dagitty.js';

// Discriminated input: full DAG or { dagitty_string }. The descriptor
// promises that dagitty_string wins when both variants are present, so the
// preprocess step discriminates on the raw payload before union validation:
// a bare z.union would match DAGSchema first (stripping dagitty_string as an
// unknown key) and silently analyze the wrong graph. Stripping the DAG fields
// when dagitty_string is present also makes an *invalid* dagitty_string a
// validation error instead of a silent fallback to the DAG variant.
export const InputSchema = z.preprocess(
  raw => (raw !== null && typeof raw === 'object' && 'dagitty_string' in raw)
    ? { dagitty_string: (raw as Record<string, unknown>).dagitty_string }
    : raw,
  z.union([DAGSchema, parseDagitty.InputSchema])
);
export type Input = z.infer<typeof InputSchema>;

export const OutputSchema = z.object({
  identifiable: z.boolean(),
  backdoor_paths: z.array(z.array(z.string())),
  minimal_adjustment_sets: z.array(z.array(z.string())),
  all_directed_paths: z.array(z.array(z.string())),
  exposure: z.string(),
  outcome: z.string(),
  concordance: ConcordanceAttestationSchema,
  diagnostics: DiagnosticsBlockSchema,
  engine_version: z.string(),
  citations: z.array(CitationSchema),
});
export type Output = z.infer<typeof OutputSchema>;

export const descriptor = {
  name: 'analyze_dag',
  description:
    "Returns identifiability status and minimal adjustment sets given the DAG provided. " +
    "Specifically: open backdoor paths from exposure to outcome (Pearl 2009 Theorem 3.3.2), " +
    "the minimal sufficient adjustment sets that block them, and all directed paths.\n\n" +
    "Accepts either a canonical DAG object or a `dagitty_string`. Returns a diagnostics " +
    "block summarizing identifiability, unmeasured confounding, and any flagged issues, " +
    "plus a static concordance attestation for the engine release.\n\n" +
    "DAG Studio verifies analyses given a DAG. It does not verify that the DAG correctly " +
    "encodes domain knowledge or that the variables are measurable in any specific dataset. " +
    "Outputs are conditional on the encoded structure.\n\n" +
    "When the DAG is meant to depict a paper's causal model, the encoded structure should " +
    "reflect the paper's own structural assumptions, including those implicit in its " +
    "analytical approach (what is adjusted for, what is treated as exposure or outcome, " +
    "what is decomposed into mediators, what is acknowledged as unmeasured or latent " +
    "confounding, and what is conditioned on as a collider), rather than an external " +
    "theoretical framing imported from other literature. If the paper contains no explicit " +
    "DAG, surface the construct-vs-reproduce ambiguity to the user before treating " +
    "downstream analysis as a reproduction of the paper.",
  // MCP requires inputSchema to be a JSON-Schema object with type:"object" at
  // the top level; oneOf-only is rejected by the SDK and clients silently drop
  // the entire tools list when any descriptor fails validation. So both input
  // variants are merged into a single flat shape with no fields strictly
  // required — the handler discriminates on the dagitty_string property at
  // runtime (Zod union still enforces the XOR there).
  inputSchema: {
    type: 'object',
    description:
      "Provide either a canonical DAG (nodes + edges + optional exposure/outcome) OR a " +
      "dagitty_string. Mixing the two is allowed but only the dagitty_string is used when " +
      "present; the DAG fields are ignored, and an invalid dagitty_string is an error " +
      "rather than a fallback to the DAG fields.",
    properties: {
      nodes: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            label: { type: 'string' },
            type: {
              type: 'string',
              enum: ['exposure', 'outcome', 'confounder', 'mediator', 'latent', 'modifier', 'unclassified'],
            },
            x: { type: 'number' },
            y: { type: 'number' },
          },
          required: ['id', 'label'],
        },
      },
      edges: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            src: { type: 'string' },
            tgt: { type: 'string' },
            id: { type: 'string' },
            bend: { type: 'number' },
          },
          required: ['src', 'tgt'],
        },
      },
      exposure: { type: 'string' },
      outcome: { type: 'string' },
      dagitty_string: {
        type: 'string',
        minLength: 1,
        description: "Alternative input: dagitty('dag { ... }') DSL parsed before analysis.",
      },
    },
  },
} as const;

const ANALYZE_CITATION_KEYS = [
  'pearl_backdoor',
  'pearl_dseparation',
  'greenland_pearl_robins_1999',
  'textor_dagitty_2016',
] as const;

export function handler(input: Input): Output {
  // Discriminate on the dagitty_string variant.
  let dag: DAG;
  if ('dagitty_string' in input) {
    dag = parseDagitty.handler(input);
  } else {
    dag = input;
  }

  if (!dag.exposure || !dag.outcome) {
    throw new Error(
      "DAG must declare both exposure and outcome. Set them via the DAG's " +
      "`exposure`/`outcome` fields, or via `[exposure]`/`[outcome]` annotations in the " +
      "dagitty DSL."
    );
  }

  const nodeIds = new Set(dag.nodes.map(n => n.id));
  if (!nodeIds.has(dag.exposure)) {
    throw new Error(
      `exposure '${dag.exposure}' is not a node in the DAG. ` +
      `Add a node with id='${dag.exposure}' or change the exposure to an existing node id.`
    );
  }
  if (!nodeIds.has(dag.outcome)) {
    throw new Error(
      `outcome '${dag.outcome}' is not a node in the DAG. ` +
      `Add a node with id='${dag.outcome}' or change the outcome to an existing node id.`
    );
  }

  const engineNodes = dag.nodes as EngineNode[];
  const engineEdges = dag.edges as EngineEdge[];

  if (hasCycle(engineNodes, engineEdges)) {
    throw new Error(
      "DAG must be acyclic; found a directed cycle. Remove the cycle by deleting or " +
      "redirecting one of the edges that closes the loop."
    );
  }

  const result = computeAdjustmentSets(dag.exposure, dag.outcome, engineNodes, engineEdges);
  if (!result) {
    // Defensive: computeAdjustmentSets returns null only when exp/out are
    // falsy, which we checked above. Surface as internal error if it ever
    // happens.
    throw new Error('Internal error: computeAdjustmentSets returned null despite valid exposure/outcome.');
  }

  const allDirected = result.all.filter(p => isDirectedCausalPath(p, engineEdges));
  const diagnostics = buildDiagnosticsBlock(dag, result, engineNodes, engineEdges);

  const citations: Citation[] = ANALYZE_CITATION_KEYS.map(k => ({ ...CITATIONS[k] }));

  return {
    identifiable: result.sets.length > 0,
    backdoor_paths: result.backdoor,
    minimal_adjustment_sets: result.sets,
    all_directed_paths: allDirected,
    exposure: dag.exposure,
    outcome: dag.outcome,
    concordance: ATTESTATION,
    diagnostics,
    engine_version: ENGINE_VERSION,
    citations,
  };
}

function buildDiagnosticsBlock(
  dag: DAG,
  result: {
    sets: string[][];
    backdoor: string[][];
    all: string[][];
    truncated?: { candidates: boolean; paths: boolean };
  },
  engineNodes: EngineNode[],
  engineEdges: EngineEdge[]
): DiagnosticsBlock {
  const flags: DiagnosticsBlock['flags'] = [];

  // Truncation warnings: set-validity checks are exact d-separation tests,
  // but candidate enumeration and the displayed path lists are bounded.
  if (result.truncated?.candidates) {
    flags.push(makeFlag(
      'IDENT_CANDIDATES_TRUNCATED',
      'The DAG has more eligible adjustment candidates than the subset-enumeration cap; ' +
      'minimal_adjustment_sets may be incomplete. Reduce the covariate count or verify a ' +
      'proposed set directly with check_overadjustment.'
    ));
  }
  if (result.truncated?.paths) {
    flags.push(makeFlag(
      'IDENT_PATHS_TRUNCATED',
      'Path enumeration hit its budget; backdoor_paths and all_directed_paths may be ' +
      'incomplete. Adjustment-set validity is unaffected (checked by d-separation, not ' +
      'path lists).'
    ));
  }

  // Identifiability flags.
  if (result.backdoor.length === 0) {
    flags.push(makeFlag(
      'IDENT_EMPTY_SET',
      'No backdoor paths exist; the total effect is identifiable without adjustment.'
    ));
  } else if (result.sets.length === 0) {
    flags.push(makeFlag(
      'IDENT_NONE',
      'No subset of declared covariates blocks all backdoor paths; the total effect is not ' +
      'identifiable through covariate adjustment alone.'
    ));
  } else {
    flags.push(makeFlag(
      'IDENT_OK',
      'At least one minimal sufficient adjustment set blocks every backdoor path.'
    ));
    if (result.sets.length > 1) {
      flags.push(makeFlag(
        'IDENT_MULTIPLE_SETS',
        `${result.sets.length} minimal sufficient adjustment sets exist. The choice between ` +
        'them should be defended on measurement, precision, or sample-size grounds rather ' +
        'than left implicit.'
      ));
    }
  }

  // Latent on backdoor.
  const latentIds = new Set(dag.nodes.filter(n => n.type === 'latent').map(n => n.id));
  const latentOnBackdoor = result.backdoor.some(path => path.some(n => latentIds.has(n)));
  if (latentOnBackdoor) {
    const offenders = [...latentIds].filter(id =>
      result.backdoor.some(path => path.includes(id))
    );
    flags.push(makeFlag(
      'CONF_LATENT_ON_BACKDOOR',
      `Latent variable(s) ${offenders.map(s => `'${s}'`).join(', ')} lie on at least one open ` +
      'backdoor path. Identifiability through measured covariates alone is impossible without ' +
      'further structural assumptions; sensitivity analyses are warranted.'
    ));
  }

  // Label-vs-structure conflicts: one flag per conflict so each is actionable.
  const conflicts = detectTypeConflicts(engineNodes, engineEdges, dag.exposure, dag.outcome);
  for (const c of conflicts) {
    flags.push(makeFlag(
      'STRUCT_LABEL_MISMATCH',
      `Node '${c.label}' (id='${c.nodeId}') is ${c.message}. The DAG, not the label, is the ` +
      'analytical ground truth; reconcile the mismatch before relying on the result.'
    ));
  }

  return {
    identifiability: result.sets.length > 0 ? 'identifiable' : 'unidentifiable',
    unmeasured_confounding_present: latentOnBackdoor,
    overadjustment_detected: false,
    flags,
  };
}

function makeFlag(code: FlagCode, message: string) {
  return {
    severity: FLAG_SEVERITY[code],
    code,
    message,
  };
}
