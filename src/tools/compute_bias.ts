// MCP tool: compute_bias (spec §4.6).
// Given a DAG and a proposed adjustment set, simulate data, fit crude (Y ~ X)
// and adjusted (Y ~ X + Z) regressions, and report the bias of each estimate
// against the true total causal effect computed from the SEM coefficients.
//
// Composes check_overadjustment.handler() to derive OVERADJ_* flags so the
// classification logic stays in one place.

import { z } from 'zod';

import {
  computeOLSCoefficients,
  computeTrueEffect,
  hasCycle,
  simulateData,
} from '../../dag-engine.js';
import type { EngineEdge, EngineNode } from '../../dag-engine.js';

import {
  CITATIONS,
  CitationSchema,
  DAGSchema,
  DiagnosticsBlockSchema,
  FLAG_SEVERITY,
  MAX_SAMPLE_SIZE,
} from '../schemas.js';
import type { Citation, DiagnosticsBlock } from '../schemas.js';
import { ENGINE_VERSION } from '../version.js';

import * as checkOveradjustment from './check_overadjustment.js';

const DEFAULT_N = 1000;
const DEFAULT_SEED = 42;

export const InputSchema = z.object({
  dag: DAGSchema,
  adjustment_set: z.array(z.string()),
  n: z.number().int().positive().max(
    MAX_SAMPLE_SIZE,
    `n exceeds the ${MAX_SAMPLE_SIZE}-row limit. Larger simulations exceed Worker CPU/memory limits.`
  ).optional(),
  seed: z.number().int().optional(),
  coefficients: z.record(z.number()).optional(),
});
export type Input = z.infer<typeof InputSchema>;

export const OutputSchema = z.object({
  true_effect: z.number(),
  crude_estimate: z.number(),
  crude_bias: z.number(),
  adjusted_estimate: z.number(),
  adjusted_bias: z.number(),
  bias_reduction: z.number(),
  n: z.number().int().positive(),
  seed: z.number().int(),
  diagnostics: DiagnosticsBlockSchema,
  citations: z.array(CitationSchema),
  engine_version: z.string(),
});
export type Output = z.infer<typeof OutputSchema>;

export const descriptor = {
  name: 'compute_bias',
  description:
    "Numerically demonstrate the bias of a proposed adjustment set. Computes the true total " +
    "effect analytically from the SEM edge coefficients (sum of products along all directed " +
    "X→Y paths), then fits two OLS regressions on simulated data: crude (Y ~ X) and adjusted " +
    "(Y ~ X + Z). Reports each estimate, each bias against the true effect, and the bias " +
    "reduction |crude_bias| − |adjusted_bias|.\n\n" +
    "Translates a structural claim (\"adjust for {age, smoking}\") into a numerical " +
    "demonstration. Composes check_overadjustment internally — any overadjustment flags " +
    "emitted there are surfaced in this tool's diagnostics as well, so a single call " +
    "captures both the numerical bias and the structural reason for it.\n\n" +
    "Outputs are conditional on the linear Gaussian SEM (see simulate_data for assumptions).",
  inputSchema: {
    type: 'object',
    properties: {
      dag: { type: 'object' },
      adjustment_set: { type: 'array', items: { type: 'string' } },
      n: { type: 'integer', minimum: 1, maximum: 10000, description: 'Sample size. Default 1000, maximum 10000.' },
      seed: { type: 'integer', description: 'Deterministic seed. Default 42.' },
      coefficients: {
        type: 'object',
        additionalProperties: { type: 'number' },
        description:
          "Optional edge-keyed coefficient overrides, e.g. {'X->Y': 0.8}. Edges not listed " +
          "use the default 0.5.",
      },
    },
    required: ['dag', 'adjustment_set'],
  },
} as const;

export function handler(input: Input): Output {
  const dag = input.dag;
  const Z = input.adjustment_set;
  const n = input.n ?? DEFAULT_N;
  const seed = input.seed ?? DEFAULT_SEED;
  const coefficients = input.coefficients ?? {};

  // Validation. Reuses the same error semantics as analyze_dag /
  // check_overadjustment so agents see consistent error messages across tools.
  if (!dag.exposure || !dag.outcome) {
    throw new Error(
      "DAG must declare both exposure and outcome. Set them via the DAG's " +
      "`exposure`/`outcome` fields, or via `[exposure]`/`[outcome]` annotations."
    );
  }
  const nodeIds = new Set(dag.nodes.map(n => n.id));
  if (!nodeIds.has(dag.exposure)) {
    throw new Error(`exposure '${dag.exposure}' is not a node in the DAG.`);
  }
  if (!nodeIds.has(dag.outcome)) {
    throw new Error(`outcome '${dag.outcome}' is not a node in the DAG.`);
  }
  for (const z of Z) {
    if (!nodeIds.has(z)) {
      throw new Error(`adjustment_set member '${z}' is not a node in the DAG.`);
    }
    if (z === dag.exposure) {
      throw new Error(`adjustment_set must not contain the exposure ('${z}').`);
    }
    if (z === dag.outcome) {
      throw new Error(`adjustment_set must not contain the outcome ('${z}').`);
    }
  }
  const engineNodes = dag.nodes as EngineNode[];
  const engineEdges = dag.edges as EngineEdge[];
  if (hasCycle(engineNodes, engineEdges)) {
    throw new Error('DAG must be acyclic; found a directed cycle.');
  }
  // Validate coefficient keys.
  const edgeKeys = new Set(engineEdges.map(e => `${e.src}->${e.tgt}`));
  for (const k of Object.keys(coefficients)) {
    if (!edgeKeys.has(k)) {
      throw new Error(
        `coefficients key '${k}' does not match any edge in the DAG. ` +
        `Use the format 'src->tgt' with ids that exist in the graph.`
      );
    }
  }

  // True effect (analytical, from SEM coefficients).
  const { totalEffect: trueEffect } = computeTrueEffect(
    dag.exposure, dag.outcome, engineEdges, coefficients
  );

  // Simulate data, then fit crude (Y ~ X) and adjusted (Y ~ X + Z) regressions.
  const { data } = simulateData(engineNodes, engineEdges, n, seed, coefficients);

  const crudeBeta = computeOLSCoefficients(data, dag.outcome, [dag.exposure]);
  if (!crudeBeta || crudeBeta.length < 2) {
    throw new Error(
      'Singular design matrix in crude regression. The simulated data may be degenerate; ' +
      'check the DAG and coefficient overrides.'
    );
  }
  const crudeEstimate = crudeBeta[1]!;

  const adjustedBeta = computeOLSCoefficients(data, dag.outcome, [dag.exposure, ...Z]);
  if (!adjustedBeta || adjustedBeta.length < 2) {
    throw new Error(
      'Singular design matrix in adjusted regression. Likely cause: an adjustment-set ' +
      'variable is collinear with the exposure under the simulated coefficients.'
    );
  }
  const adjustedEstimate = adjustedBeta[1]!;

  const crudeBias = crudeEstimate - trueEffect;
  const adjustedBias = adjustedEstimate - trueEffect;
  const biasReduction = Math.abs(crudeBias) - Math.abs(adjustedBias);

  // Compose with check_overadjustment to derive OVERADJ_* flags. We don't
  // surface that tool's full output (problematic_variables, recommendation);
  // we just lift its flags and per-variable detection.
  const overadj = checkOveradjustment.handler({ dag, adjustment_set: Z });
  const overadjFlags = overadj.diagnostics.flags;

  const flags: DiagnosticsBlock['flags'] = [
    {
      severity: FLAG_SEVERITY['SIM_LINEAR_GAUSSIAN_ASSUMPTION'],
      code: 'SIM_LINEAR_GAUSSIAN_ASSUMPTION',
      message:
        'Estimates are conditional on the linear Gaussian SEM. Real datasets generated under ' +
        'unknown processes will not in general match these biases.',
    },
    {
      severity: FLAG_SEVERITY['SIM_SEED_DETERMINISTIC'],
      code: 'SIM_SEED_DETERMINISTIC',
      message:
        `Output is deterministic given seed=${seed}; vary seed and aggregate to characterize ` +
        'stochastic variation in the bias estimates.',
    },
    ...overadjFlags,
  ];

  const hasCriticalOveradj = overadjFlags.some(f => f.severity === 'critical');

  const diagnostics: DiagnosticsBlock = {
    identifiability: hasCriticalOveradj ? 'unidentifiable' : 'identifiable',
    unmeasured_confounding_present: false,
    overadjustment_detected: !overadj.ok,
    overadjustment_variables: overadj.ok ? undefined : overadj.problematic_variables.map(p => p.id),
    flags,
  };

  // Citations: pearl_sem + pearl_backdoor always; conditional on OVERADJ flags.
  const citationKeys = new Set<keyof typeof CITATIONS>(['pearl_sem', 'pearl_backdoor']);
  if (overadj.problematic_variables.some(p => p.reason === 'descendant_of_exposure')) {
    citationKeys.add('schisterman_overadjustment_2009');
  }
  if (overadj.problematic_variables.some(p => p.reason === 'collider' || p.reason === 'descendant_of_collider')) {
    citationKeys.add('greenland_collider_2003');
  }
  const citations: Citation[] = [...citationKeys].map(k => ({ ...CITATIONS[k] }));

  return {
    true_effect: trueEffect,
    crude_estimate: crudeEstimate,
    crude_bias: crudeBias,
    adjusted_estimate: adjustedEstimate,
    adjusted_bias: adjustedBias,
    bias_reduction: biasReduction,
    n,
    seed,
    diagnostics,
    citations,
    engine_version: ENGINE_VERSION,
  };
}
