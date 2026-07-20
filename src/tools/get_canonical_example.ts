// MCP tool: get_canonical_example (spec §4.8).
// Returns one of the canonical validated DAGs from the test suite by ID
// (T01–T15 for the main suite, EM01–EM20 for effect modification). Useful for
// few-shot prompting, regression testing, and education.
//
// Per spec §5.4, citations come from the test's own per-test metadata, not
// from the global citation catalog.

import { z } from 'zod';

import { TESTS, EM_TESTS } from '../../dag-engine.js';
import type { TestCase, EMTestCase } from '../../dag-engine.js';

import { CitationSchema, DAGSchema, NodeTypeSchema } from '../schemas.js';
import type { Citation, DAG } from '../schemas.js';
import { ENGINE_VERSION } from '../version.js';

export const InputSchema = z.object({
  id: z.string().min(1, 'id must be a non-empty string (e.g., "T01" or "EM03")'),
});
export type Input = z.infer<typeof InputSchema>;

export const OutputSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.string(),
  source: z.string(),
  description: z.string(),
  dag: DAGSchema,
  expected_backdoor_count: z.number().int().nonnegative().optional(),
  expected_adjustment_sets: z.array(z.array(z.string())).optional(),
  no_adjustment_possible: z.boolean().optional(),
  expected_em_classifications: z.array(z.string()).optional(),
  modifiers: z.array(z.object({
    id: z.string(),
    src: z.string(),
    tgtEdge: z.string(),
  })).optional(),
  citations: z.array(CitationSchema),
  engine_version: z.string(),
});
export type Output = z.infer<typeof OutputSchema>;

export const descriptor = {
  name: 'get_canonical_example',
  description:
    "Return one of the canonical validated DAGs from the engine's test suite by ID " +
    "(T01–T15 for backdoor / adjustment-set canonical structures, EM01–EM20 for effect-" +
    "modification structures from VanderWeele-Robins 2007 and Weinberg 2007). Useful for " +
    "few-shot prompting, regression checks, and teaching. The returned DAG is the same one " +
    "the engine is validated against, so analyze_dag's output on it will match the listed " +
    "expected values.",
  inputSchema: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        minLength: 1,
        description: "Test ID. Main-suite IDs are T01–T15; effect-modification IDs are EM01–EM20.",
      },
    },
    required: ['id'],
    additionalProperties: false,
  },
} as const;

export function handler(input: Input): Output {
  const id = input.id;
  if (id.startsWith('T')) {
    const t = TESTS.find(x => x.id === id);
    if (!t) throw new Error(unknownIdError(id, 'T'));
    return tToOutput(t);
  }
  if (id.startsWith('EM')) {
    const t = EM_TESTS.find(x => x.id === id);
    if (!t) throw new Error(unknownIdError(id, 'EM'));
    return emToOutput(t);
  }
  throw new Error(
    `Unknown test ID '${id}'. Main-suite IDs are T01–T15, effect-modification IDs are EM01–EM20.`
  );
}

function unknownIdError(id: string, prefix: 'T' | 'EM'): string {
  const list = prefix === 'T'
    ? TESTS.map(t => t.id).join(', ')
    : EM_TESTS.map(t => t.id).join(', ');
  return `Unknown ${prefix}-prefixed test ID '${id}'. Available: ${list}.`;
}

function tToOutput(t: TestCase): Output {
  const dag: DAG = {
    nodes: t.nodes.map(n => ({
      id: n.id,
      label: n.label,
      type: n.type as z.infer<typeof NodeTypeSchema> | undefined,
    })),
    edges: t.edges.map(e => ({ src: e.src, tgt: e.tgt, id: e.id })),
    exposure: t.exp,
    outcome: t.out,
  };
  return {
    id: t.id,
    name: t.name,
    category: t.category,
    source: t.refs.map(r => r.cite).join('; '),
    description: t.description,
    dag,
    expected_backdoor_count: t.expected.backdoorCount,
    expected_adjustment_sets: t.expected.adjSets,
    no_adjustment_possible: t.expected.noAdjPossible,
    citations: t.refs.map(refToCitation),
    engine_version: ENGINE_VERSION,
  };
}

function emToOutput(t: EMTestCase): Output {
  // EM tests bake target-edge references in via tgtEdgeIdx (an index into
  // edges). Mirror runEMTest's wrapper logic so consumers receive the same
  // synthesized edge ids the engine uses internally.
  const edgesWithIds = t.edges.map((e, i) => ({ src: e.src, tgt: e.tgt, id: `_e${i}` }));
  const modifiersWithIds = t.modifiers.map((m, i) => ({
    id: `_m${i}`,
    src: m.src,
    tgtEdge: `_e${m.tgtEdgeIdx}`,
  }));
  const dag: DAG = {
    nodes: t.nodes.map(n => ({
      id: n.id,
      label: n.label,
      type: n.type as z.infer<typeof NodeTypeSchema> | undefined,
    })),
    edges: edgesWithIds,
    exposure: t.exp,
    outcome: t.out,
    modifiers: modifiersWithIds.map(m => ({
      id: m.id,
      src: m.src,
      tgtEdge: m.tgtEdge,
    })),
  };
  return {
    id: t.id,
    name: t.name,
    category: 'Effect Modification',
    source: t.source,
    description: t.description,
    dag,
    expected_em_classifications: t.expected,
    modifiers: modifiersWithIds,
    citations: [{ source: t.source, reference: t.source }],
    engine_version: ENGINE_VERSION,
  };
}

function refToCitation(ref: { cite: string; url?: string }): Citation {
  // Test refs use "Author · Pub Year" format. Split on " · " when present so
  // source and reference fields aren't redundant; fall back to cite-as-both
  // when the format doesn't match.
  const parts = ref.cite.split(' · ');
  if (parts.length === 2) {
    return { source: parts[0]!, reference: parts[1]!, ...(ref.url ? { url: ref.url } : {}) };
  }
  return { source: ref.cite, reference: ref.cite, ...(ref.url ? { url: ref.url } : {}) };
}
