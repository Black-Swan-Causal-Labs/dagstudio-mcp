// dag-studio-mcp Worker entry. Same nine tools as the stdio server, exposed
// over HTTP (Streamable HTTP at /mcp, SSE at /sse) via Cloudflare's McpAgent
// + Durable Object pattern. The dispatch logic mirrors src/index.ts exactly
// so the two transports stay behavior-identical.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { McpAgent } from 'agents/mcp';

import { ATTESTATION } from '../attestation.js';
import { ENGINE_VERSION } from '../version.js';

import * as analyzeDag from '../tools/analyze_dag.js';
import * as checkOveradjustment from '../tools/check_overadjustment.js';
import * as classifyEffectModification from '../tools/classify_effect_modification.js';
import * as computeBias from '../tools/compute_bias.js';
import * as generateCode from '../tools/generate_code.js';
import * as getCanonicalExample from '../tools/get_canonical_example.js';
import * as parseDagitty from '../tools/parse_dagitty.js';
import * as simulateData from '../tools/simulate_data.js';
import * as validateEngine from '../tools/validate_engine.js';

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

interface Env {
  MCP_OBJECT: DurableObjectNamespace;
}

export class DagStudioMCP extends McpAgent<Env> {
  server = new McpServer(
    { name: 'dag-studio-mcp', version: '0.1.0' },
    { capabilities: { tools: {} } }
  );

  async init() {
    this.server.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: DESCRIPTORS,
    }));

    this.server.server.setRequestHandler(CallToolRequestSchema, async (request) => {
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
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/mcp') {
      return DagStudioMCP.serve('/mcp').fetch(request, env, ctx);
    }
    if (url.pathname === '/sse' || url.pathname === '/sse/message') {
      return DagStudioMCP.serveSSE('/sse').fetch(request, env, ctx);
    }
    if (url.pathname === '/') {
      const concordance = ATTESTATION.validated_at
        ? `${ATTESTATION.cases_concordant}/${ATTESTATION.cases_validated}`
        : 'unvalidated';
      const body =
        `DAG Studio MCP\n` +
        `POST /mcp  — Streamable HTTP transport\n` +
        `GET  /sse  — SSE transport (legacy clients)\n` +
        `engine_version=${ENGINE_VERSION} · concordance=${concordance} · tools=${DESCRIPTORS.length}\n`;
      return new Response(body, {
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }

    return new Response('Not found', { status: 404 });
  },
};
