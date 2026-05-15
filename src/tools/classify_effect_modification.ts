// MCP tool: classify_effect_modification (spec §4.7).
// For each modifier annotation on the DAG, classify the effect modification
// structure per VanderWeele & Robins (2007) and Weinberg (2007).
//
// Spec note: §4.7 lists `classifications` and `citations` as the output fields,
// but the §5.2 emission table says this tool emits EM_* flags, and §5.1 says
// every tool response includes engine_version. The spec is internally
// inconsistent on whether non-pure-transformation tools always carry a
// regulatory_considerations envelope. We adopt the more inclusive reading:
// regulatory_considerations + engine_version are present alongside the
// per-modifier classifications and citations.

import { z } from 'zod';

import {
  classifyEffectModification,
  EM_TYPE_DESCRIPTIONS,
  hasCycle,
} from '../../../dag-engine.js';
import type { EMType, EngineEdge, EngineModifier, EngineNode } from '../../../dag-engine.js';

import {
  CITATIONS,
  CitationSchema,
  DAGSchema,
  FLAG_SEVERITY,
  RegulatoryBlockSchema,
} from '../schemas.js';
import type { Citation, FlagCode, RegulatoryBlock } from '../schemas.js';
import { ENGINE_VERSION } from '../version.js';

export const InputSchema = z.object({
  dag: DAGSchema,
});
export type Input = z.infer<typeof InputSchema>;

export const OutputSchema = z.object({
  classifications: z.array(z.object({
    modifier_id: z.string(),
    target_edge: z.object({ src: z.string(), tgt: z.string() }),
    type: z.enum(['direct', 'indirect', 'common-cause', 'proxy', 'pure-interaction', 'invalid']),
    explanation: z.string(),
  })),
  regulatory_considerations: RegulatoryBlockSchema,
  engine_version: z.string(),
  citations: z.array(CitationSchema),
});
export type Output = z.infer<typeof OutputSchema>;

export const descriptor = {
  name: 'classify_effect_modification',
  description:
    "For each modifier annotation on the DAG, classify the effect-modification structure " +
    "per VanderWeele & Robins (2007) and Weinberg (2007). The five types and their " +
    "regulatory implications:\n" +
    "  • direct — modifier is structurally independent of the E-D system; subgroup-specific " +
    "effects are interpretable as pure modification.\n" +
    "  • indirect — modifier acts through a mediator; subgroup effects conflate modification " +
    "with mediation.\n" +
    "  • common-cause — modifier shares an ancestor with the exposure; subgroup effects are " +
    "confounded unless the ancestor is also adjusted.\n" +
    "  • proxy — modifier is unobserved; subgroup analyses rest on a downstream proxy.\n" +
    "  • pure-interaction — modifier has a direct edge to the outcome; the appropriate " +
    "estimand is the joint effect, not a subgroup-specific effect (Weinberg 2007).\n\n" +
    "Serves FDA RWE-guidance §III.E (\"Approach and rationale for subgroup analyses\"). " +
    "Outputs are conditional on the encoded structure.",
  inputSchema: {
    type: 'object',
    properties: {
      dag: { type: 'object', description: 'Canonical DAG with modifiers populated.' },
    },
    required: ['dag'],
  },
} as const;

const EM_TYPE_TO_FLAG: Record<EMType, FlagCode | null> = {
  'direct': 'EM_DIRECT',
  'indirect': 'EM_INDIRECT',
  'common-cause': 'EM_COMMON_CAUSE',
  'proxy': 'EM_PROXY',
  'pure-interaction': 'EM_PURE_INTERACTION',
  'invalid': null,
};

const EM_TYPE_FDA_REF = '§III.E subgroup analyses';

export function handler(input: Input): Output {
  const dag = input.dag;

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
  const engineNodes = dag.nodes as EngineNode[];
  const engineEdges = dag.edges as EngineEdge[];
  if (hasCycle(engineNodes, engineEdges)) {
    throw new Error("DAG must be acyclic; found a directed cycle.");
  }

  const modifiers = (dag.modifiers ?? []) as EngineModifier[];
  const edgeById = new Map(engineEdges.filter(e => e.id).map(e => [e.id!, e]));

  const raw = classifyEffectModification(
    engineNodes,
    engineEdges,
    modifiers,
    dag.exposure,
    dag.outcome
  );

  const classifications: Output['classifications'] = raw.map((c, i) => {
    const mod = modifiers[i];
    const targetEdge = mod?.tgtEdge ? edgeById.get(mod.tgtEdge) : undefined;
    return {
      modifier_id: c.modifierId ?? mod?.id ?? `(modifier ${i})`,
      target_edge: targetEdge
        ? { src: targetEdge.src, tgt: targetEdge.tgt }
        : { src: '', tgt: '' },
      type: c.emType,
      explanation: EM_TYPE_DESCRIPTIONS[c.emType] ?? '(unknown type)',
    };
  });

  // Flags: one per non-invalid classification. 'invalid' modifiers (where the
  // source node was deleted from the canvas) emit no flag.
  const flags: RegulatoryBlock['flags'] = [];
  for (const cls of classifications) {
    const code = EM_TYPE_TO_FLAG[cls.type];
    if (!code) continue;
    flags.push({
      severity: FLAG_SEVERITY[code],
      code,
      message: `Modifier '${cls.modifier_id}' is classified as ${cls.type}: ${cls.explanation}`,
      fda_reference: EM_TYPE_FDA_REF,
    });
  }

  const regulatory: RegulatoryBlock = {
    identifiability: 'identifiable',
    unmeasured_confounding_present: false,
    overadjustment_detected: false,
    flags,
  };

  // Citations per spec §5.4: vanderweele_robins_em_2007 always; weinberg_em_2007
  // conditional on any pure-interaction classification.
  const citationKeys: Array<keyof typeof CITATIONS> = ['vanderweele_robins_em_2007'];
  if (classifications.some(c => c.type === 'pure-interaction')) {
    citationKeys.push('weinberg_em_2007');
  }
  const citations: Citation[] = citationKeys.map(k => ({ ...CITATIONS[k] }));

  return {
    classifications,
    regulatory_considerations: regulatory,
    engine_version: ENGINE_VERSION,
    citations,
  };
}
