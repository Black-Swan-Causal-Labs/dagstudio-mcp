// MCP tool: validate_engine (spec §4.9).
// Runs the canonical T01–T15 + EM01–EM20 suites and reports pass/fail per case.
// Lets agents verify trust in the engine before relying on its output. Per
// spec §4.9, the response carries reference_implementations rather than a
// citations array.

import { z } from 'zod';

import { EM_TESTS, runEMTest, runTest, TESTS } from '../../dag-engine.js';
import { ENGINE_VERSION } from '../version.js';

export const InputSchema = z.object({
  suite: z.enum(['main', 'effect_modification', 'all']).optional(),
});
export type Input = z.infer<typeof InputSchema>;

export const OutputSchema = z.object({
  passed: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  all_pass: z.boolean(),
  results: z.array(z.object({
    id: z.string(),
    name: z.string(),
    category: z.string(),
    pass: z.boolean(),
    expected: z.unknown(),
    got: z.unknown(),
  })),
  engine_version: z.string(),
  reference_implementations: z.array(z.string()),
});
export type Output = z.infer<typeof OutputSchema>;

export const descriptor = {
  name: 'validate_engine',
  description:
    "Run the canonical validation suite (T01–T15 backdoor / adjustment-set cases, EM01–EM20 " +
    "effect-modification structures from VanderWeele-Robins 2007 and Weinberg 2007) against " +
    "the current engine and return pass/fail per case. Use this when an agent or reviewer " +
    "wants to verify the engine is trustworthy before relying on analyze_dag, " +
    "check_overadjustment, or classify_effect_modification.",
  inputSchema: {
    type: 'object',
    properties: {
      suite: {
        type: 'string',
        enum: ['main', 'effect_modification', 'all'],
        description:
          "'main' runs T01–T15. 'effect_modification' runs EM01–EM20. 'all' runs both. " +
          "Default: 'all'.",
      },
    },
    additionalProperties: false,
  },
} as const;

export function handler(input: Input): Output {
  const suite = input.suite ?? 'all';
  const results: Output['results'] = [];

  if (suite === 'main' || suite === 'all') {
    for (const t of TESTS) {
      const r = runTest(t);
      results.push({
        id: t.id,
        name: t.name,
        category: t.category,
        pass: r.pass,
        expected: t.expected,
        got: { backdoorCount: r.gotBackdoor, adjSets: r.gotSets },
      });
    }
  }

  if (suite === 'effect_modification' || suite === 'all') {
    for (const t of EM_TESTS) {
      const r = runEMTest(t);
      results.push({
        id: t.id,
        name: t.name,
        category: 'Effect Modification',
        pass: r.pass,
        expected: r.expected,
        got: r.got,
      });
    }
  }

  const passed = results.filter(r => r.pass).length;
  return {
    passed,
    total: results.length,
    all_pass: passed === results.length,
    results,
    engine_version: ENGINE_VERSION,
    reference_implementations: ['Pearl 2009', 'dagitty (Textor et al. 2016)'],
  };
}
