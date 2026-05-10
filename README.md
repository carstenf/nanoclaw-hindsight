# nanoclaw-hindsight

[NanoClaw](https://github.com/qwibitai/nanoclaw) install skill that wires
agent groups to a separately-running [Hindsight](https://hindsight.vectorize.io/)
memory backend. Agents get three MCP tools — `memory_retain`,
`memory_recall`, `memory_reflect` — namespaced per group folder.

## Scope

This repo used to bundle a Hindsight Docker stack plus an MCP wrapper. That
was a mistake — the MCP wrapper is generic (any client can use it, not just
NanoClaw) and the Hindsight stack is operator-owned, not agent-owned.

The wrapper now lives in its own private repo as the **universal
hindsight-mcp** (deployed once per host, multi-tenant via per-client
bearer tokens). This repo holds only the NanoClaw-side glue, two
artifacts:

| Path | What it is | When it runs |
|------|-----------|--------------|
| `.claude/skills/add-hindsight/SKILL.md` | **Install skill.** Walks the operator through wiring an existing NanoClaw install to a running hindsight-mcp. | Once per install, by the human operator. |
| `container/skills/hindsight/SKILL.md` | **Container (runtime) skill.** Mounted into every agent session, teaches the agent recall/retain discipline (when to call which tool, what counts as "durable", anti-patterns). | Continuously, in every agent session, in-band. |

Both are needed. Without the install skill the agent has no MCP server
wired. Without the container skill the agent has the tools but no
discipline — it tends to over-retain or hallucinate "saved".

## Install

In your NanoClaw v2 install:

```bash
# 1. Copy both skills into your install
mkdir -p .claude/skills/add-hindsight container/skills/hindsight
cp <this-repo>/.claude/skills/add-hindsight/SKILL.md .claude/skills/add-hindsight/
cp <this-repo>/container/skills/hindsight/SKILL.md container/skills/hindsight/

# 2. Run the install skill
/add-hindsight
```

The container skill `hindsight` will be available to every agent on the
next container spawn (NanoClaw mounts `container/skills/` as `/app/skills:ro`
and exposes them via the agent's `Skill` tool).

The skill walks you through:

1. Verifying the universal hindsight-mcp is reachable from your host
2. Adding the binary path to your nanoclaw mount-allowlist
3. Wiring each agent group's `container.json` (per-agent stdio MCP server +
   read-only volume mount of the binary)
4. (Optional) Patching `src/group-init.ts` so newly-created groups are
   auto-wired

It assumes the universal hindsight-mcp is **already deployed** by the
operator who owns the Hindsight engine. If that hasn't happened yet, the
skill won't help — talk to that operator first.

## Architecture (after install)

```
NanoClaw agent container ──── stdio ────► hindsight-mcp-stdio binary ──── HTTP ────► Hindsight engine
  (MCP client, per-session)               (mounted read-only from host)            (separate compose stack on the host)
```

Each agent group writes/reads its own bank under `<prefix>:<group-folder>`,
where `<prefix>` is set per-install via `HINDSIGHT_BANK_PREFIX` env (default
`nanoclaw`). Banks are isolated; an agent in group A cannot touch group B's
memory.

## Why a separate skill instead of an `/add-mcp-server` flow

Hindsight needs three things wired at once that no generic flow handles:
a host-path volume mount under nanoclaw's allowlist, a stdio command line
referencing the mounted binary path, and a runtime discipline skill for
the agent. `/add-hindsight` ships them as one idempotent recipe; manual
wiring is fragile (the path-prefix gotcha alone bit me once — see the
skill's pitfalls section).

## Legacy

The previous v1 bundled stack (Dockerfile + docker-compose + MCP wrapper
TS source) is preserved on the `legacy/v1-bundled-stack` branch. Use it
only if you actually want to run a Hindsight instance bundled with a
single NanoClaw install — for new installs, prefer the universal
hindsight-mcp.

## License

MIT.
