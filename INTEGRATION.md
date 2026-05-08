# Integration with NanoClaw

This file describes the contract between NanoClaw's host process and the
`hindsight-mcp` server in this repo.

## Contract: two MCP tools

NanoClaw's `src/memory.ts` connects via streamable HTTP to whatever URL
sits at `MEMORY_MCP_URL`, then calls these two tools:

### `memory_recall(group: string, query: string)`

**Request arguments:**
- `group` — string, the per-group folder name (NanoClaw's group identifier)
- `query` — string, the current incoming prompt that the agent is about to handle

**Response:**
- `content[]` with one or more `{ type: 'text', text: string }` items
- Concatenated text becomes the memory injection (NanoClaw wraps it in
  `<memory>...</memory>` tags before the prompt)
- Empty content → no memories, NanoClaw falls back to the raw prompt

### `memory_retain(group: string, content: string)`

**Request arguments:**
- `group` — string, same group identifier
- `content` — string, the prompt+conversation to remember

**Response:**
- `content[]` with one ack text (NanoClaw doesn't read it; fire-and-forget)

## NanoClaw side

In NanoClaw's `.env`:

```
MEMORY_MCP_URL=http://localhost:4412/mcp
```

That's the only NanoClaw-side change. `src/memory.ts` lazy-connects on
first recall/retain, caches the client, and survives restarts.

If `MEMORY_MCP_URL` is unset, NanoClaw runs in no-memory mode silently —
no errors, recall returns null, retain is a no-op.

## Why MCP and not plain HTTP

NanoClaw's broader architecture is moving toward MCP-pluggable services
(channels-as-MCP, providers-as-MCP, etc.). Memory follows the same
pattern: any memory backend that exposes the two tools above slots in.
This is why the wrapper exists at all instead of NanoClaw calling
Hindsight's HTTP API directly.

## Bank-id derivation

Hindsight's primitive is "banks" (named per-tenant memory stores). This
wrapper derives the bank-id from `group` by sanitizing it to alphanumerics
+ underscores + dashes, capped at 64 chars. Empty after sanitization
falls back to the literal string `default`.
