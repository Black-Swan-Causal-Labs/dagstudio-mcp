// MCP tool: parse_dagitty (spec §4.2).
// Pure transformation. No regulatory_considerations / citations / engine_version
// (per spec §5.2 emission table — parser tools don't emit those).

import { z } from 'zod';

import { parseDagitty as engineParse } from '../../../dag-engine.js';
import type { ParsedDagitty } from '../../../dag-engine.js';
import { DAGSchema } from '../schemas.js';
import type { DAG } from '../schemas.js';

export const InputSchema = z.object({
  dagitty_string: z.string().min(1, 'dagitty_string must be a non-empty string'),
});
export type Input = z.infer<typeof InputSchema>;

export const OutputSchema = DAGSchema;
export type Output = DAG;

export const descriptor = {
  name: 'parse_dagitty',
  description:
    "Parse a dagitty DSL string into the canonical DAG shape used by other DAG Studio tools. " +
    "Accepts dagitty('dag { ... }'), dagitty(\"...\"), and dagitty::dagitty(...) forms. " +
    "Bidirected (<->) and undirected (--) edges are skipped — DAG Studio represents only " +
    "directed edges.\n\n" +
    "This tool parses notation; it does not validate that the encoded DAG is a correct or " +
    "complete causal model. That is a domain-knowledge question outside the scope of any " +
    "graph tool.",
  inputSchema: {
    type: 'object',
    properties: {
      dagitty_string: {
        type: 'string',
        minLength: 1,
        description:
          "A dagitty DSL string, e.g., \"dagitty('dag { X [exposure]; Y [outcome]; X -> Y }')\".",
      },
    },
    required: ['dagitty_string'],
    additionalProperties: false,
  },
} as const;

export function handler(input: Input): Output {
  const parsed = engineParse(input.dagitty_string);
  return toDAG(parsed);
}

function toDAG(parsed: ParsedDagitty): DAG {
  return {
    nodes: parsed.nodes.map(n => ({
      id: n.id,
      label: n.label,
      type: roleToType(n.role),
    })),
    edges: parsed.edges.map(e => ({ src: e.src, tgt: e.tgt })),
    exposure: parsed.exposure ?? undefined,
    outcome: parsed.outcome ?? undefined,
  };
}

type Role = ParsedDagitty['nodes'][number]['role'];

function roleToType(role: Role): DAG['nodes'][number]['type'] {
  switch (role) {
    case 'exposure': return 'exposure';
    case 'outcome': return 'outcome';
    case 'latent': return 'latent';
    case null: return 'unclassified';
  }
}
