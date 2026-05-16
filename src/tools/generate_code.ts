// MCP tool: generate_code (spec §4.3).
// Emit idiomatic Python (networkx.DiGraph) or R (dagitty DSL) representing
// the DAG. The identifier_map lets agents trace canvas labels to sanitized
// code identifiers when these differ.
//
// Pure transformation per spec §5.2 — no diagnostics, no citations, no concordance.

import { z } from 'zod';

import {
  generatePythonCode,
  generateRCode,
  _identMap,
} from '../../../dag-engine.js';
import type { EngineEdge, EngineNode } from '../../../dag-engine.js';

import { DAGSchema } from '../schemas.js';

export const InputSchema = z.object({
  dag: DAGSchema,
  language: z.enum(['python', 'r']),
});
export type Input = z.infer<typeof InputSchema>;

export const OutputSchema = z.object({
  code: z.string(),
  identifier_map: z.record(z.string()),
  language: z.enum(['python', 'r']),
});
export type Output = z.infer<typeof OutputSchema>;

export const descriptor = {
  name: 'generate_code',
  description:
    "Emit idiomatic Python (networkx.DiGraph) or R (dagitty DSL) source representing the " +
    "DAG. The identifier_map lets agents trace canvas labels to sanitized code identifiers " +
    "when these differ (e.g., when labels contain spaces or special characters that aren't " +
    "valid Python/R identifiers). Useful for handing the DAG to a downstream analysis " +
    "pipeline.",
  inputSchema: {
    type: 'object',
    properties: {
      dag: { type: 'object', description: 'Canonical DAG object.' },
      language: { type: 'string', enum: ['python', 'r'] },
    },
    required: ['dag', 'language'],
  },
} as const;

export function handler(input: Input): Output {
  // Default missing x/y to 0 so the engine's coord-mapping helper doesn't
  // produce NaN coordinates in the optional layout block. Real canvas DAGs
  // always carry coordinates; agent-supplied DAGs often don't.
  const nodes: EngineNode[] = input.dag.nodes.map(n => ({
    id: n.id,
    label: n.label,
    type: n.type,
    x: n.x ?? 0,
    y: n.y ?? 0,
  }));
  const edges = input.dag.edges as EngineEdge[];
  const exposure = input.dag.exposure;
  const outcome = input.dag.outcome;

  const code = input.language === 'python'
    ? generatePythonCode(nodes, edges, exposure, outcome)
    : generateRCode(nodes, edges, exposure, outcome);

  return {
    code,
    identifier_map: _identMap(nodes),
    language: input.language,
  };
}
