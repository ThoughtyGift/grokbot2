/**
 * The plugin catalog — what Marketplace lists.
 *
 * It was two rows hardcoded in `@grokbot2/proto`, which made the marketplace a demo: nobody could
 * add an entry without editing the protobuf package. The catalog is DATA, so it belongs here, where
 * it can come from a file or a URL and a community registry becomes a config change.
 *
 * Source, first match wins:
 *   1. `GROKBOT2_PLUGIN_REGISTRY` — a path, or an http(s) URL
 *   2. `plugin-registry.json` at the repo root
 *   3. the two built-in rows (unchanged behaviour when nothing is configured)
 *
 * Shape (same as the wire entry plus the install spec):
 *   { "plugins": [ { "id": 1, "name": "memory", "displayName": "…", "description": "…",
 *                    "mcp": { "name": "memory", "description": "…",
 *                             "command": "npx", "args": ["-y", "…"], "env": { … } } } ] }
 *
 * A URL registry is fetched ONCE per TTL and cached; a fetch failure keeps the last good catalog
 * rather than emptying the marketplace, because an unreachable registry is not the same as a
 * registry with no plugins. `env` never reaches the wire — see bootstrap.ts availableMcpServers.
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * A catalog row. Declared HERE, not imported from `@grokbot2/proto`, because the domain owns its
 * catalog and no service module may import protobuf (boundaries.test.ts). The shapes are checked
 * against each other structurally at the one call site that hands these to the wire — index.ts
 * passes them as `RpcCtx.catalog`, so a drift is a typecheck failure, not a silent mismatch.
 */
export interface PluginEntry {
  id: number;
  name: string;
  displayName: string;
  description: string;
  /** The MCP server this plugin installs. `command`/`args`/`env` are install spec, never wire data. */
  mcp?: { name: string; description: string; command?: string; args?: string[]; env?: Record<string, string> };
  skill?: { name: string; description: string };
}

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const DEFAULT_FILE = join(repoRoot, "plugin-registry.json");
const TTL_MS = 60_000;

/** The rows that shipped hardcoded, kept as the fallback so an unconfigured install is unchanged. */
const BUILT_IN: PluginEntry[] = [
  {
    id: 1,
    name: "memory",
    displayName: "Grokbot2 Memory",
    description: "Local MCP test plugin.",
    mcp: {
      name: "memory",
      description: "From .mcp.json",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-memory"],
    },
  },
  {
    id: 2,
    name: "skill",
    displayName: "Grokbot2 Skill",
    description: "Local skill test plugin.",
    skill: { name: "local-skill", description: "Yours Private row" },
  },
];

let cached: { at: number; rows: PluginEntry[] } | null = null;

/** Keep only well-formed rows — a malformed registry entry must not break the whole marketplace. */
function parse(raw: unknown): PluginEntry[] {
  const list = (raw as { plugins?: unknown })?.plugins;
  if (!Array.isArray(list)) return [];
  return list.flatMap((r): PluginEntry[] => {
    const p = r as Partial<PluginEntry>;
    if (typeof p?.id !== "number" || typeof p?.name !== "string") return [];
    return [{
      id: p.id,
      name: p.name,
      displayName: typeof p.displayName === "string" ? p.displayName : p.name,
      description: typeof p.description === "string" ? p.description : "",
      ...(p.mcp && typeof p.mcp.name === "string"
        ? { mcp: { ...p.mcp, description: p.mcp.description ?? "" } }
        : {}),
      ...(p.skill && typeof p.skill.name === "string"
        ? { skill: { ...p.skill, description: p.skill.description ?? "" } }
        : {}),
    }];
  });
}

/**
 * The current catalog. Synchronous by design — the bootstrap builders are sync, and a remote
 * registry is refreshed in the background by `refreshRemoteCatalog` rather than blocking a request.
 */
export function catalog(): PluginEntry[] {
  const src = process.env.GROKBOT2_PLUGIN_REGISTRY?.trim();

  if (src && /^https?:\/\//i.test(src)) {
    if (cached) {
      if (Date.now() - cached.at > TTL_MS) void refreshRemoteCatalog(src);   // stale-while-revalidate
      return cached.rows;
    }
    void refreshRemoteCatalog(src);
    return BUILT_IN;   // first call, nothing fetched yet
  }

  const file = src ? (isAbsolute(src) ? src : join(repoRoot, src)) : DEFAULT_FILE;
  if (!existsSync(file)) return BUILT_IN;
  try {
    const rows = parse(JSON.parse(readFileSync(file, "utf8")));
    return rows.length ? rows : BUILT_IN;
  } catch (e) {
    console.warn(`[grokbot2] [plugins] ${file} is not readable JSON: ${(e as Error).message}`);
    return cached?.rows ?? BUILT_IN;
  }
}

/** Fetch a URL registry into the cache. Failure keeps whatever was cached — never empties it. */
export async function refreshRemoteCatalog(url: string): Promise<void> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rows = parse(await res.json());
    if (rows.length) cached = { at: Date.now(), rows };
  } catch (e) {
    console.warn(`[grokbot2] [plugins] registry ${url} unreachable: ${(e as Error).message}`);
    if (cached) cached.at = Date.now();   // back off; keep serving the last good catalog
  }
}

/** The install spec for a catalog id — what `plugins.ts` writes into the user's MCP config. */
export function serverSpecFor(pluginId: number): { name: string; spec: Record<string, unknown> } | null {
  const row = catalog().find((p) => p.id === pluginId);
  if (!row?.mcp?.command) return null;
  return {
    name: row.mcp.name,
    spec: {
      command: row.mcp.command,
      ...(row.mcp.args ? { args: row.mcp.args } : {}),
      ...(row.mcp.env ? { env: row.mcp.env } : {}),
    },
  };
}

/** True when the id exists in the catalog at all (a skill-only row installs no server). */
export const isKnownPlugin = (pluginId: number): boolean => catalog().some((p) => p.id === pluginId);
