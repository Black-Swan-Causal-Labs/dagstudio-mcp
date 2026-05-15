# dag-studio-mcp

Model Context Protocol server for the [DAG Studio](https://github.com/Black-Swan-Causal-Labs/dag-studio) causal-inference engine.

**v0.1.0 — work in progress.** Not yet published. The full v1 specification lives in [`MCP_REQUIREMENTS.md`](../MCP_REQUIREMENTS.md); the regulatory rationale lives in [`FDA_GUIDANCE_ALIGNMENT.md`](../FDA_GUIDANCE_ALIGNMENT.md).

## Status

Scaffold only. Boots an MCP server over stdio and advertises zero tools. Tools land in subsequent commits per spec §4.

## Development

```sh
npm install
npm run build
npm start              # runs dist/index.js
npm run dev            # runs src/index.ts via tsx (no rebuild needed)
```

For interactive use, the [MCP Inspector](https://modelcontextprotocol.io/docs/tools/inspector):

```sh
npx @modelcontextprotocol/inspector node dist/index.js
```

## License

MIT. The dagitty reference engine used at release-time CI for concordance is GPL-2.0 and is **not** bundled with the published npm package (spec §5.3, §7.4).
