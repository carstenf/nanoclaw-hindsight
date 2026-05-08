// nanoclaw-hindsight-mcp — MCP server wrapping vectorize.io Hindsight
//
// Exposes the two-tool generic memory contract that NanoClaw's
// MEMORY_MCP_URL provider uses:
//
//   memory_recall(group: string, query: string)
//     → returns relevant memories as text content (or empty content if
//       nothing applicable).
//
//   memory_retain(group: string, content: string)
//     → stores the conversation. Fire-and-forget (returns ack).
//
// Internally calls Hindsight via @vectorize-io/hindsight-client. The bank-
// id we hand to Hindsight is the per-group folder name passed by NanoClaw,
// so each group gets isolated memory. (Pre-extraction code used a single
// 'operator' bank; this version does proper per-group isolation as
// originally intended.)
//
// Transport: streamable HTTP, mounted on /mcp. Default port 4412 (configurable
// via PORT env). Same docker-compose stack ships Hindsight itself on
// 4410/4411.

import http from 'node:http';
import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { HindsightClient } from '@vectorize-io/hindsight-client';

const PORT = Number(process.env.PORT ?? 4412);
const HINDSIGHT_URL =
  process.env.HINDSIGHT_URL ?? 'http://hindsight:8888';

const hindsight = new HindsightClient({ baseUrl: HINDSIGHT_URL });

function bankIdFor(group: string): string {
  // Per-group isolation: derive a stable bank id from the group folder.
  // Sanitize to alphanumerics + underscore so Hindsight accepts it.
  const sanitized = group.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
  return sanitized || 'default';
}

function makeServer(): McpServer {
  const server = new McpServer(
    { name: 'nanoclaw-hindsight-mcp', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );

  server.tool(
    'memory_recall',
    'Recall relevant memories for a group + query. Returns concatenated memory texts as a single string, or empty if nothing applicable.',
    {
      group: z
        .string()
        .min(1)
        .describe('Group identifier — typically the per-group folder name. Maps to a Hindsight bank.'),
      query: z
        .string()
        .min(1)
        .describe('The current query / prompt. Used to retrieve relevant past memories.'),
    },
    async (args) => {
      const bankId = bankIdFor(args.group);
      try {
        const response = await hindsight.recall(bankId, args.query, {
          budget: 'mid',
        });
        if (!response.results || response.results.length === 0) {
          return {
            content: [{ type: 'text' as const, text: '' }],
          };
        }
        const text = response.results.map((r) => r.text).join('\n');
        return {
          content: [{ type: 'text' as const, text }],
        };
      } catch (err) {
        // Don't crash the caller — return empty so memory degrades silently.
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(
          JSON.stringify({
            event: 'memory_recall_failed',
            bank: bankId,
            err: msg,
          }) + '\n',
        );
        return {
          content: [{ type: 'text' as const, text: '' }],
          isError: false,
        };
      }
    },
  );

  server.tool(
    'memory_retain',
    'Store a conversation in the group memory for future recall. Fire-and-forget — returns ack.',
    {
      group: z.string().min(1),
      content: z.string().min(1),
    },
    async (args) => {
      const bankId = bankIdFor(args.group);
      try {
        await hindsight.retain(bankId, args.content);
        return { content: [{ type: 'text' as const, text: 'ok' }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(
          JSON.stringify({
            event: 'memory_retain_failed',
            bank: bankId,
            err: msg,
          }) + '\n',
        );
        return {
          content: [{ type: 'text' as const, text: 'failed' }],
          isError: true,
        };
      }
    },
  );

  return server;
}

async function main(): Promise<void> {
  const app = express();
  app.use(express.json({ limit: '4mb' }));

  app.get('/health', (_req, res) => {
    res.json({ ok: true, hindsight_url: HINDSIGHT_URL, port: PORT });
  });

  // Per-session McpServer (Pitfall 1 / SDK Issue #1405). Fresh server +
  // transport on every POST /mcp; the transport pumps the request/response
  // and closes when the JSON-RPC exchange is done.
  app.post('/mcp', async (req, res) => {
    const server = makeServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless mode — no session reuse
    });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(
        JSON.stringify({ event: 'mcp_request_failed', err: msg }) + '\n',
      );
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'internal error' },
          id: null,
        });
      }
    }
  });

  const httpServer = http.createServer(app);
  httpServer.listen(PORT, '0.0.0.0', () => {
    process.stdout.write(
      JSON.stringify({
        event: 'listening',
        port: PORT,
        hindsight_url: HINDSIGHT_URL,
      }) + '\n',
    );
  });

  const shutdown = (signal: string): void => {
    process.stdout.write(
      JSON.stringify({ event: 'shutdown', signal }) + '\n',
    );
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

void main();
