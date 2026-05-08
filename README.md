# nanoclaw-hindsight

MCP-pluggable memory provider for [NanoClaw](https://github.com/qwibitai/nanoclaw),
backed by [Hindsight](https://hindsight.vectorize.io/) (vectorize.io biomimetic
agentic memory).

This repo ships a Docker stack and a small MCP-server wrapper that satisfies
NanoClaw's generic `MEMORY_MCP_URL` contract — namely the two tools
`memory_recall` and `memory_retain`. NanoClaw's trunk knows nothing about
Hindsight; it just speaks MCP. Other memory backends (mem0, letta, etc.)
can drop in by exposing the same two tools — no NanoClaw changes.

## Architecture

```
  NanoClaw (host) ─── MCP/HTTP ──→ hindsight-mcp ─── HTTP ──→ hindsight
       │                              :4412                   :8888
       │                              (this repo)             (vectorize)
       │
       └── src/memory.ts (~120 LoC, generic MCP client; no provider-specific code)
```

The wrapper service is a tiny streamable-HTTP MCP server. Per call it
translates `memory_recall(group, query)` and `memory_retain(group, content)`
into Hindsight's per-bank API. Bank-id is derived per group folder, so
each group gets isolated memory.

## Install

This repo is consumed by the NanoClaw `/add-hindsight` skill — typically
you don't run anything manually. The skill walks through:

1. Cloning this repo onto the host.
2. Asking for a Hindsight LLM API key (OpenAI etc.) → writes `.env`.
3. `docker compose up -d` → starts both `hindsight` and `hindsight-mcp`.
4. Setting `MEMORY_MCP_URL=http://localhost:4412/mcp` in NanoClaw's `.env`.
5. Restarting NanoClaw → memory provider auto-connects on first call.

If you want to set it up by hand:

```bash
git clone https://github.com/carstenf/nanoclaw-hindsight.git
cd nanoclaw-hindsight
cp .env.example .env
# edit .env and set HINDSIGHT_LLM_API_KEY=...
docker compose up -d
# verify
curl -s http://localhost:4412/health
```

Then in NanoClaw's `.env`:

```
MEMORY_MCP_URL=http://localhost:4412/mcp
```

Restart NanoClaw and watch its log for `memory_mcp_connected`.

## Ports

All bound to `127.0.0.1` by default:

| Port | Service          |
|------|------------------|
| 4410 | Hindsight HTTP   |
| 4411 | Hindsight Web UI |
| 4412 | hindsight-mcp    |

## Development

```bash
npm install
npm run dev            # tsx src/server.ts — talks to a Hindsight at HINDSIGHT_URL
npm run build          # tsc → dist/
docker build -t nanoclaw-hindsight-mcp:dev .
```

## License

MIT.
