// MCP tool: check_overadjustment (spec §4.4).
// Detects overadjustment in a proposed adjustment set against a DAG.
// Distinguishes three failure modes (spec §5.2):
//   OVERADJ_DESCENDANT             — Z[i] is a descendant of the exposure
//   OVERADJ_COLLIDER               — Z[i] is a collider whose conditioning is
//                                    not justified by another set member
//   OVERADJ_DESCENDANT_OF_COLLIDER — Z[i] is a descendant of an unconditioned
//                                    collider whose conditioning would open
//                                    a non-causal path

import { z } from 'zod';

import {
  allPaths,
  backdoorPaths,
  descendants,
  hasCycle,
  isCollider,
  pathBlocked,
} from '../../../dag-engine.js';
import type { EngineEdge, EngineNode } from '../../../dag-engine.js';

import {
  CITATIONS,
  CitationSchema,
  DAGSchema,
  FLAG_SEVERITY,
  RegulatoryBlockSchema,
} from '../schemas.js';
import type { Citation, DAG, FlagCode, RegulatoryBlock } from '../schemas.js';
import { ENGINE_VERSION } from '../version.js';

import * as parseDagitty from './parse_dagitty.js';

type Reason = 'descendant_of_exposure' | 'collider' | 'descendant_of_collider';

const REASON_TO_FLAG: Record<Reason, FlagCode> = {
  descendant_of_exposure: 'OVERADJ_DESCENDANT',
  collider: 'OVERADJ_COLLIDER',
  descendant_of_collider: 'OVERADJ_DESCENDANT_OF_COLLIDER',
};

// Two input shapes: { dag, adjustment_set } or { dagitty_string, adjustment_set }.
// The spec (§4.4) names the first; the second mirrors analyze_dag's pattern
// for consistency across the tool surface.
const AdjustmentSetSchema = z.array(z.string());

export const InputSchema = z.union([
  z.object({ dag: DAGSchema, adjustment_set: AdjustmentSetSchema }),
  z.object({ dagitty_string: z.string().min(1), adjustment_set: AdjustmentSetSchema }),
]);
export type Input = z.infer<typeof InputSchema>;

export const OutputSchema = z.object({
  ok: z.boolean(),
  problematic_variables: z.array(z.object({
    id: z.string(),
    reason: z.enum(['descendant_of_exposure', 'collider', 'descendant_of_collider']),
    explanation: z.string(),
  })),
  recommendation: z.string(),
  regulatory_considerations: RegulatoryBlockSchema,
  engine_version: z.string(),
  citations: z.array(CitationSchema),
});
export type Output = z.infer<typeof OutputSchema>;

export const descriptor = {
  name: 'check_overadjustment',
  description:
    "Given a DAG and a proposed adjustment set, identify variables whose inclusion biases " +
    "the estimate. Detects three failure modes:\n" +
    "  • descendant_of_exposure — variable is caused by the exposure; conditioning on it " +
    "blocks part of the causal effect being estimated, changing the estimand " +
    "(Schisterman 2009).\n" +
    "  • collider — variable is a collider on a non-causal X→Y path whose conditioning " +
    "opens that path; conditioning is unjustified unless another set member re-blocks it.\n" +
    "  • descendant_of_collider — variable is downstream of an unconditioned collider; " +
    "conditioning induces the same M-bias as conditioning on the collider directly " +
    "(Greenland 2003).\n\n" +
    "Serves FDA RWE-guidance §III.E bullet 4 (\"Evaluation of potential overadjustment of " +
    "intermediate variables on the causal pathway\"). Accepts either a canonical DAG object " +
    "or a dagitty_string; both forms must be paired with adjustment_set.\n\n" +
    "Outputs are conditional on the encoded structure. DAG Studio verifies analyses given a " +
    "DAG; it does not verify the DAG correctly encodes domain knowledge.",
  // MCP requires inputSchema.type === 'object' at the top level (oneOf-only
  // schemas fail SDK validation and clients drop the whole tools list). Both
  // variants live in a single flat object; runtime Zod union enforces XOR.
  inputSchema: {
    type: 'object',
    description:
      "Provide either `dag` (canonical DAG object) or `dagitty_string`, plus the " +
      "`adjustment_set` to evaluate.",
    properties: {
      dag: {
        type: 'object',
        description: 'Canonical DAG object (nodes + edges + exposure + outcome).',
      },
      dagitty_string: {
        type: 'string',
        minLength: 1,
        description: "Alternative DAG input: dagitty('dag { ... }') DSL.",
      },
      adjustment_set: {
        type: 'array',
        items: { type: 'string' },
        description: 'Array of node ids proposed for adjustment.',
      },
    },
    required: ['adjustment_set'],
  },
} as const;

export function handler(input: Input): Output {
  // Discriminate on dagitty_string variant.
  let dag: DAG;
  if ('dagitty_string' in input) {
    dag = parseDagitty.handler({ dagitty_string: input.dagitty_string });
  } else {
    dag = input.dag;
  }
  const Z = input.adjustment_set;

  // Standard DAG-level validation (mirrors analyze_dag).
  if (!dag.exposure || !dag.outcome) {
    throw new Error(
      "DAG must declare both exposure and outcome. Set them via the DAG's " +
      "`exposure`/`outcome` fields, or via `[exposure]`/`[outcome]` annotations in the " +
      "dagitty DSL."
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

  // Adjustment-set validation.
  for (const z of Z) {
    if (!nodeIds.has(z)) {
      throw new Error(
        `adjustment_set member '${z}' is not a node in the DAG. ` +
        `Remove it from the set or add a corresponding node.`
      );
    }
    if (z === dag.exposure) {
      throw new Error(
        `adjustment_set must not contain the exposure ('${z}'). Conditioning on the exposure ` +
        `removes the variation whose effect is being estimated.`
      );
    }
    if (z === dag.outcome) {
      throw new Error(
        `adjustment_set must not contain the outcome ('${z}').`
      );
    }
  }

  const problematic = classifyAdjustmentSet(dag, Z, engineNodes, engineEdges);
  const ok = problematic.length === 0;

  // Citations: pearl_backdoor always; schisterman on any DESCENDANT;
  // greenland_collider on any COLLIDER or DESCENDANT_OF_COLLIDER (per spec §5.4).
  const citationKeys = new Set<keyof typeof CITATIONS>(['pearl_backdoor']);
  if (problematic.some(p => p.reason === 'descendant_of_exposure')) {
    citationKeys.add('schisterman_overadjustment_2009');
  }
  if (problematic.some(p => p.reason === 'collider' || p.reason === 'descendant_of_collider')) {
    citationKeys.add('greenland_collider_2003');
  }
  const citations: Citation[] = [...citationKeys].map(k => ({ ...CITATIONS[k] }));

  // Build flags from the per-variable classification.
  const flags: RegulatoryBlock['flags'] = problematic.map(p => ({
    severity: FLAG_SEVERITY[REASON_TO_FLAG[p.reason]],
    code: REASON_TO_FLAG[p.reason],
    message: p.explanation,
    fda_reference: '§III.E bullet 4',
  }));

  // identifiability: any *critical* overadjustment flag (descendant or collider)
  // means the proposed estimand is biased; descendant_of_collider is a warning,
  // not critical, so doesn't flip identifiability. (Severity is fixed per code
  // in FLAG_SEVERITY.)
  const hasCriticalOveradj = flags.some(f => f.severity === 'critical');

  const regulatory: RegulatoryBlock = {
    identifiability: hasCriticalOveradj ? 'unidentifiable' : 'identifiable',
    unmeasured_confounding_present: false,
    overadjustment_detected: !ok,
    overadjustment_variables: ok ? undefined : problematic.map(p => p.id),
    flags,
  };

  const recommendation = buildRecommendation(problematic, Z);

  return {
    ok,
    problematic_variables: problematic,
    recommendation,
    regulatory_considerations: regulatory,
    engine_version: ENGINE_VERSION,
    citations,
  };
}

interface Problematic {
  id: string;
  reason: Reason;
  explanation: string;
}

function classifyAdjustmentSet(
  dag: DAG,
  Z: string[],
  engineNodes: EngineNode[],
  engineEdges: EngineEdge[]
): Problematic[] {
  const exp = dag.exposure!;
  const out = dag.outcome!;
  const descOfExp = descendants(exp, engineEdges);
  const xyPaths = allPaths(exp, out, engineEdges);

  const problematic: Problematic[] = [];

  for (const z of Z) {
    // Priority 1: descendant of exposure (most direct violation — blocks
    // part of the causal effect itself).
    if (descOfExp.has(z)) {
      problematic.push({
        id: z,
        reason: 'descendant_of_exposure',
        explanation:
          `'${z}' is a descendant of the exposure. Conditioning on it blocks part of the ` +
          `causal effect being estimated, changing the estimand from total effect to a ` +
          `controlled-direct or natural-direct effect.`,
      });
      continue;
    }

    // Priority 2 & 3: did adding z to Z open a previously-blocked X-Y path?
    // If yes, find the responsible collider on that path.
    const Zwithout = Z.filter(x => x !== z);
    let isResponsibleCollider = false;
    let isDescendantOfResponsibleCollider = false;

    for (const path of xyPaths) {
      const wasBlocked = pathBlocked(path, Zwithout, engineEdges);
      const isNowBlocked = pathBlocked(path, Z, engineEdges);
      if (!wasBlocked || isNowBlocked) continue;

      // Path was blocked under Z\{z} and unblocked under Z → adding z opened it.
      // The responsible collider is the one whose conditioning (or whose
      // descendant being in Z) flipped the blocking status.
      for (let i = 1; i < path.length - 1; i++) {
        const c = path[i]!;
        const prev = path[i - 1]!;
        const next = path[i + 1]!;
        if (!isCollider(c, prev, next, engineEdges)) continue;
        if (c === z) {
          isResponsibleCollider = true;
        } else if (descendants(c, engineEdges).has(z)) {
          isDescendantOfResponsibleCollider = true;
        }
      }
    }

    if (isResponsibleCollider) {
      problematic.push({
        id: z,
        reason: 'collider',
        explanation:
          `'${z}' is a collider on at least one non-causal X→Y path. Conditioning on it ` +
          `opens that path and induces selection bias unless another set member also lies ` +
          `on the path and re-blocks it.`,
      });
    } else if (isDescendantOfResponsibleCollider) {
      problematic.push({
        id: z,
        reason: 'descendant_of_collider',
        explanation:
          `'${z}' is a descendant of an unconditioned collider on a non-causal X→Y path. ` +
          `Conditioning on it induces the same M-bias as conditioning on the collider ` +
          `directly (Greenland 2003).`,
      });
    }
  }

  return problematic;
}

function buildRecommendation(problematic: Problematic[], Z: string[]): string {
  if (problematic.length === 0) {
    if (Z.length === 0) {
      return "The empty adjustment set contains no overadjustment problems by construction. " +
             "Run analyze_dag to verify identifiability separately.";
    }
    return `The proposed adjustment set {${Z.join(', ')}} is free of overadjustment per the ` +
           `three checks above. Run analyze_dag to verify it actually blocks all open ` +
           `backdoor paths.`;
  }
  const remove = problematic.map(p => `'${p.id}'`).join(', ');
  return `Remove ${remove} from the adjustment set. Each is biasing the estimate per the ` +
         `reasons listed in problematic_variables.`;
}

