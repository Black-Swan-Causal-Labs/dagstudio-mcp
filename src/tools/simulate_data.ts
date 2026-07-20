// MCP tool: simulate_data (spec §4.5).
// Generate synthetic data from a Linear Gaussian SEM consistent with the DAG.
// Deterministic given seed. Output is for sensitivity analysis and structural
// demonstration only — not a substitute for analysis of real data.

import { z } from 'zod';

import {
  dataToCSV,
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

const DEFAULT_N = 1000;
const DEFAULT_SEED = 42;

export const InputSchema = z.object({
  dag: DAGSchema,
  n: z.number().int().positive().max(
    MAX_SAMPLE_SIZE,
    `n exceeds the ${MAX_SAMPLE_SIZE}-row limit. Rows are returned inline, and larger simulations exceed Worker CPU/memory limits.`
  ).optional(),
  seed: z.number().int().optional(),
  coefficients: z.record(z.number()).optional(),
  format: z.enum(['json', 'csv']).optional(),
});
export type Input = z.infer<typeof InputSchema>;

export const OutputSchema = z.object({
  data: z.union([z.array(z.record(z.number())), z.string()]),
  format: z.enum(['json', 'csv']),
  topological_order: z.array(z.string()),
  n: z.number().int().positive(),
  seed: z.number().int(),
  assumptions: z.object({
    model: z.literal('linear_gaussian_sem'),
    root_distribution: z.literal('N(0,1)'),
    edge_coefficient_default: z.literal(0.5),
    error_distribution: z.literal('N(0, 0.25)'),
  }),
  diagnostics: DiagnosticsBlockSchema,
  citations: z.array(CitationSchema),
  engine_version: z.string(),
});
export type Output = z.infer<typeof OutputSchema>;

export const descriptor = {
  name: 'simulate_data',
  description:
    "Generate synthetic data from a Linear Gaussian Structural Equation Model consistent " +
    "with the DAG. Root variables are sampled N(0,1); each non-root is a linear combination " +
    "of its parents (default β = 0.5 per edge, overridable via `coefficients`) plus N(0, " +
    "0.25) noise. Output is deterministic given seed (default 42).\n\n" +
    "Useful for sensitivity analysis and for demonstrating structural claims (e.g., " +
    "'adjustment for {age, smoking} eliminates the confounding shown by these data'). " +
    "Outputs are consistent with the DAG under the linear Gaussian model only — real " +
    "datasets generated under unknown processes will not in general match these distributions.",
  inputSchema: {
    type: 'object',
    properties: {
      dag: { type: 'object' },
      n: { type: 'integer', minimum: 1, maximum: 10000, description: 'Sample size. Default 1000, maximum 10000.' },
      seed: { type: 'integer', description: 'Deterministic seed. Default 42.' },
      coefficients: {
        type: 'object',
        additionalProperties: { type: 'number' },
        description:
          "Optional edge-keyed coefficient overrides, e.g. {'X->Y': 0.8}. Edges not listed " +
          "use the default 0.5.",
      },
      format: { type: 'string', enum: ['json', 'csv'], description: "Output format. Default 'json'." },
    },
    required: ['dag'],
  },
} as const;

export function handler(input: Input): Output {
  const dag = input.dag;
  const n = input.n ?? DEFAULT_N;
  const seed = input.seed ?? DEFAULT_SEED;
  const coefficients = input.coefficients ?? {};
  const format = input.format ?? 'json';

  const engineNodes = dag.nodes as EngineNode[];
  const engineEdges = dag.edges as EngineEdge[];

  if (engineNodes.length === 0) {
    throw new Error('DAG has no nodes; cannot simulate.');
  }
  if (hasCycle(engineNodes, engineEdges)) {
    throw new Error('DAG must be acyclic; found a directed cycle. Cannot simulate.');
  }
  // Validate coefficient keys reference real edges, since silent fallthrough
  // to 0.5 would mask typos in agent-supplied coefficient maps.
  const edgeKeys = new Set(engineEdges.map(e => `${e.src}->${e.tgt}`));
  for (const k of Object.keys(coefficients)) {
    if (!edgeKeys.has(k)) {
      throw new Error(
        `coefficients key '${k}' does not match any edge in the DAG. ` +
        `Use the format 'src->tgt' with ids that exist in the graph.`
      );
    }
  }

  const { data, order } = simulateData(engineNodes, engineEdges, n, seed, coefficients);

  let dataField: Output['data'];
  if (format === 'csv') {
    const nodeMap: Record<string, EngineNode> = {};
    for (const nd of engineNodes) nodeMap[nd.id] = nd;
    dataField = dataToCSV(data, order, nodeMap);
  } else {
    dataField = data;
  }

  const flags: DiagnosticsBlock['flags'] = [
    {
      severity: FLAG_SEVERITY['SIM_LINEAR_GAUSSIAN_ASSUMPTION'],
      code: 'SIM_LINEAR_GAUSSIAN_ASSUMPTION',
      message:
        'Output is conditional on the linear Gaussian SEM (root variables N(0,1); edges β=0.5 ' +
        'by default; errors N(0, 0.25)). Results do not generalize to nonlinear, non-Gaussian, ' +
        'or non-additive processes.',
    },
    {
      severity: FLAG_SEVERITY['SIM_SEED_DETERMINISTIC'],
      code: 'SIM_SEED_DETERMINISTIC',
      message:
        `Output is deterministic given seed=${seed}; vary seed and aggregate across runs to ` +
        'characterize stochastic variation.',
    },
  ];

  const diagnostics: DiagnosticsBlock = {
    identifiability: 'identifiable',
    unmeasured_confounding_present: false,
    overadjustment_detected: false,
    flags,
  };

  const citations: Citation[] = [{ ...CITATIONS['pearl_sem'] }];

  return {
    data: dataField,
    format,
    topological_order: order,
    n,
    seed,
    assumptions: {
      model: 'linear_gaussian_sem',
      root_distribution: 'N(0,1)',
      edge_coefficient_default: 0.5,
      error_distribution: 'N(0, 0.25)',
    },
    diagnostics,
    citations,
    engine_version: ENGINE_VERSION,
  };
}

