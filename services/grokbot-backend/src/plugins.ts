/**
 * Plugin installs — what the Marketplace "Add" button actually does.
 *
 * The catalog itself lives in `@grokbot2/proto` (it is wire data the app decodes). This module owns
 * the STATE: which plugins an account has installed, and the side effect that makes an install real
 * — writing the plugin's MCP server into that user's config, the per-user `.data/mcp/<authId>.json`
 * from multi-tenant Phase 6 (the default identity keeps the repo-root `.mcp.json`).
 *
 * Before this, `InstallUserPlugin` answered an empty message: the row appeared in Marketplace, Add
 * did nothing, and nothing was ever installed. Now Add writes a server the agent can actually call.
 *
 * Installs are per owner, so two tenants adding the same plugin get two configs with their own
 * credentials — the isolation Phase 6 established.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_USER } from "./auth.js";
import { currentOwner } from "./request-context.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", ".data");

/** Same resolution as mcp.ts — kept in step with it deliberately, not shared, to avoid a cycle. */
function configPathFor(owner: string): string {
  if (owner === DEFAULT_USER.authId) return process.env.GROKBOT2_MCP_CONFIG ?? join(repoRoot, ".mcp.json");
  return join(DATA_DIR, "mcp", `${owner.replace(/[^a-zA-Z0-9._-]/g, "_")}.json`);
}

/** Where the installed-id list per owner is kept — beside the MCP config it drives. */
const installsPath = (owner: string): string =>
  join(DATA_DIR, "plugin-installs", `${owner.replace(/[^a-zA-Z0-9._-]/g, "_")}.json`);

/**
 * The MCP server a catalog plugin brings with it.
 *
 * The two built-in rows are local test servers; a real registry entry would carry its own command.
 * Unknown ids install nothing, which is why `install()` reports false rather than pretending.
 */
const SERVER_FOR: Record<number, { name: string; spec: Record<string, unknown> } | undefined> = {
  1: { name: "memory", spec: { command: "npx", args: ["-y", "@modelcontextprotocol/server-memory"] } },
  2: undefined,   // skill-only row: nothing to spawn
};

export function installedIds(owner: string = currentOwner()): number[] {
  try {
    const raw = JSON.parse(readFileSync(installsPath(owner), "utf8"));
    return Array.isArray(raw?.installed) ? raw.installed.filter((n: unknown) => typeof n === "number") : [];
  } catch {
    return [];
  }
}

/**
 * Record the install and write its MCP server into the owner's config.
 *
 * Returns false for an id with no catalog entry. Writing the server is best-effort-but-loud: a
 * failure throws rather than reporting success, because "installed" that installed nothing is the
 * exact silent failure this replaces.
 */
export function installPlugin(pluginId: number, owner: string = currentOwner()): boolean {
  if (!(pluginId in SERVER_FOR)) return false;

  const ids = installedIds(owner);
  if (!ids.includes(pluginId)) {
    const f = installsPath(owner);
    mkdirSync(dirname(f), { recursive: true });
    writeFileSync(f, `${JSON.stringify({ installed: [...ids, pluginId] }, null, 2)}\n`);
  }

  const server = SERVER_FOR[pluginId];
  if (server) {
    const cfgPath = configPathFor(owner);
    let cfg: { mcpServers?: Record<string, unknown> } = {};
    if (existsSync(cfgPath)) {
      try { cfg = JSON.parse(readFileSync(cfgPath, "utf8")) ?? {}; } catch { cfg = {}; }
    }
    cfg.mcpServers = { ...(cfg.mcpServers ?? {}), [server.name]: server.spec };
    mkdirSync(dirname(cfgPath), { recursive: true });
    writeFileSync(cfgPath, `${JSON.stringify(cfg, null, 2)}\n`);
  }
  return true;
}

/** The port shape `RpcCtx.plugins` expects, bound to one owner. */
export const pluginsPortFor = (owner: string) => ({
  installedIds: installedIds(owner),
  install: (id: number) => installPlugin(id, owner),
});
