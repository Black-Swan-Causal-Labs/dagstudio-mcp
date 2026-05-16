// MCP tool: generate_code (spec §4.3).
// Emit idiomatic Python (networkx.DiGraph) or R (dagitty DSL) representing
// the DAG. The identifier_map lets agents trace canvas labels to sanitized
// code identifiers when these differ. The dagstudio_url is a one-click
// deep-link into the DAG Studio canvas for the same DAG.
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

const DAGSTUDIO_CANVAS_URL = 'https://dagstudio.blackswancausallabs.com/';

export const InputSchema = z.object({
  dag: DAGSchema,
  language: z.enum(['python', 'r']),
});
export type Input = z.infer<typeof InputSchema>;

export const OutputSchema = z.object({
  code: z.string(),
  identifier_map: z.record(z.string()),
  language: z.enum(['python', 'r']),
  dagstudio_url: z.string().url(),
});
export type Output = z.infer<typeof OutputSchema>;

export const descriptor = {
  name: 'generate_code',
  description:
    "Emit idiomatic Python (networkx.DiGraph) or R (dagitty DSL) source representing the " +
    "DAG. The identifier_map lets agents trace canvas labels to sanitized code identifiers " +
    "when these differ (e.g., when labels contain spaces or special characters that aren't " +
    "valid Python/R identifiers). Useful for handing the DAG to a downstream analysis " +
    "pipeline. " +
    "Also returns dagstudio_url — a one-click deep-link that opens the same DAG on the " +
    "DAG Studio canvas at dagstudio.blackswancausallabs.com. Surface this URL to the user " +
    "alongside the generated code so they can paste-free open the DAG visually, regardless " +
    "of which language was requested.\n\n" +
    "If the DAG depicts a paper's causal model, whether the paper presents a DAG explicitly " +
    "or only implies one through its analytical approach, the emitted code should reflect " +
    "that paper's structural assumptions. Do not let the choice of downstream language " +
    "(Python or R analysis pipeline) become an opportunity to substitute external " +
    "theoretical commitments for what the paper actually claims as its estimand.",
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

  // Always compute the R-wrapped DSL — the canvas's ?dagitty= handler accepts
  // bare DSL or the R-wrapped form, so a URL works regardless of which
  // language the caller requested.
  const rCode = generateRCode(nodes, edges, exposure, outcome);
  const code = input.language === 'python'
    ? generatePythonCode(nodes, edges, exposure, outcome)
    : rCode;
  // Extract just the dag { ... } body from inside generateRCode's
  // dagitty('...') call. The full R source starts with "library(dagitty)"
  // and a comment header, which would fail the canvas's ^\s*dagitty\( auto-
  // wrap regex and produce a nonsense re-wrap. The canvas tolerates leading
  // whitespace and indented DSL, so trim is enough.
  const dslMatch = rCode.match(/dagitty\(\s*'([\s\S]*?)'\s*\)/);
  const dsl = (dslMatch && dslMatch[1]) ? dslMatch[1].trim() : 'dag { }';
  const dagstudio_url =
    `${DAGSTUDIO_CANVAS_URL}?dagitty=${encodeURIComponent(dsl)}`;

  return {
    code,
    identifier_map: _identMap(nodes),
    language: input.language,
    dagstudio_url,
  };
}
