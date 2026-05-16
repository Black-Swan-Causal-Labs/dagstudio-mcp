# Worker transport

Cloudflare Workers entrypoint for dag-studio-mcp. Subclasses `McpAgent` (from `agents/mcp`) and reuses the same nine tool handlers as the stdio server in `src/index.ts`. Dispatch logic is identical: ListTools returns the nine descriptors, CallTool parses input with each tool's Zod `InputSchema` and runs its `handler`. Routes: `POST /mcp` (Streamable HTTP), `GET /sse` (SSE legacy compat), `GET /` (plaintext orientation). Config lives in `wrangler.jsonc` at the repo root; local dev via `npm run worker:dev`, deploy via `npm run worker:deploy`.
