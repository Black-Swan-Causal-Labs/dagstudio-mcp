#!/usr/bin/env node
// dag-studio-mcp server entry. Boots an MCP server over stdio and dispatches
// tool calls to handlers in src/tools/. Each tool module exports
// { InputSchema, OutputSchema, descriptor, handler } — the registry below
// glues those into the SDK's request handlers.
//
// Smoke test:
//   npm run build && node dist/index.js
//   (process should print engine_version to stderr and wait on stdin)
//
// Interactive:
//   npx @modelcontextprotocol/inspector node dist/index.js

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { ATTESTATION } from './attestation.js';
import { ENGINE_VERSION } from './version.js';

import * as parseDagitty from './tools/parse_dagitty.js';
import * as analyzeDag from './tools/analyze_dag.js';
import * as checkOveradjustment from './tools/check_overadjustment.js';
import * as getCanonicalExample from './tools/get_canonical_example.js';
import * as validateEngine from './tools/validate_engine.js';
import * as generateCode from './tools/generate_code.js';
import * as classifyEffectModification from './tools/classify_effect_modification.js';
import * as simulateData from './tools/simulate_data.js';
import * as computeBias from './tools/compute_bias.js';

// Tool registry. Add new tools here as they land.
const TOOLS = [
  parseDagitty,
  analyzeDag,
  checkOveradjustment,
  getCanonicalExample,
  validateEngine,
  generateCode,
  classifyEffectModification,
  simulateData,
  computeBias,
] as const;
type ToolModule = (typeof TOOLS)[number];

const HANDLERS: Record<string, ToolModule> = Object.fromEntries(
  TOOLS.map(t => [t.descriptor.name, t])
);
const DESCRIPTORS = TOOLS.map(t => t.descriptor);

const server = new Server(
  { name: 'dag-studio-mcp', version: '0.1.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: DESCRIPTORS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: rawArgs } = request.params;
  const tool = HANDLERS[name];
  if (!tool) {
    return {
      content: [{ type: 'text' as const, text: `Unknown tool: ${name}` }],
      isError: true,
    };
  }

  try {
    const input = tool.InputSchema.parse(rawArgs ?? {});
    // Each tool's handler expects its own narrowed Input; the registry maps
    // name → module, so we accept any-shaped Input from the perspective of
    // dispatch and trust the per-tool Zod parse to gate it.
    const output = (tool.handler as (i: unknown) => unknown)(input);
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(output) }],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: 'text' as const, text: message }],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);

process.stderr.write(
  `dag-studio-mcp running on stdio · engine_version=${ENGINE_VERSION} · concordance=${
    ATTESTATION.validated_at ? `${ATTESTATION.cases_concordant}/${ATTESTATION.cases_validated}` : 'unvalidated'
  } · tools=${DESCRIPTORS.length}\n`
);
