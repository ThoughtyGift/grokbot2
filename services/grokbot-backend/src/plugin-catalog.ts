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
 * A row must NEVER carry a real credential: this file is meant to be shared, and a token in it
 * would be committed and then handed to every tenant who installed the row. Write the placeholder
 * the credential is called instead — `"${GITHUB_PERSONAL_ACCESS_TOKEN}"`, in `env` or in `args` —
 * and secrets.ts substitutes it at spawn from the machine actually running the server.
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
  /**
   * Nhóm hiển thị trong pane Plugins (chữ thường). Hàng chip lọc sinh ra từ đúng trường này, và
   * thiếu nó thì client 0.29 **sập cả pane** — xem `pluginJson` trong `bootstrap-plugins.ts`.
   */
  category?: string;
  /**
   * The service this row connects, when its MCP server fronts several.
   *
   * Six rows here install the same Zernio endpoint, so the connector cannot say which service the
   * person meant. This is what becomes an account row in the Plugins pane, with its own connect
   * button — see social-connect.ts.
   */
  platform?: string;
  /** The MCP server this plugin installs. `command`/`args`/`env` are install spec, never wire data. */
  mcp?: {
    name: string;
    description: string;
    /** stdio row: the command to spawn. */
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    /** remote row: a Streamable HTTP endpoint instead of a command. */
    url?: string;
    /** remote row: sent on every request — where a `Bearer ${TOKEN}` credential goes. */
    headers?: Record<string, string>;
  };
  skill?: { name: string; description: string };
  /**
   * An https image for the row's icon. The client fetches it in the MAIN process and rejects any
   * other scheme, so `data:` and `http://localhost` do not work — measured in `resolvePluginLogo`.
   * Omit it for a plugin the client already has a built-in brand icon for (github, gmail, notion,
   * playwright and a dozen more): the built-in is drawn locally and costs no request.
   */
  logoUrl?: string;
  /** Wording for the credential form. The credentials themselves come from the spec placeholders. */
  credentials?: Record<string, { title?: string; description?: string; required?: boolean }>;
  /** JSON Schema the client renders as the setup form. Derived by `catalog()`, not written by hand. */
  variablesSchema?: { properties: Record<string, Record<string, string>>; required: string[] };
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
      ...(typeof p.logoUrl === "string" && /^https:\/\//i.test(p.logoUrl) ? { logoUrl: p.logoUrl } : {}),
      /*
       * `category` — nhóm hiển thị trong pane Plugins, và hàng chip lọc sinh ra từ chính nó.
       *
       * Chỗ này là một cái bẫy im lặng: hàm trên **lọc trắng** danh sách trường, dựng một object
       * mới chứ không sao chép cả hàng. Thêm `category` vào `plugin-registry.json` mà quên dòng
       * này thì nó bị vứt trên đường đi — registry có, client không thấy, và không ai báo lỗi gì.
       *
       * Chuẩn hoá về chữ thường: renderer tự viết hoa từng chữ để làm tiêu đề nhóm
       * (`_t(a.category)`), nhưng khoá nhóm lại là `category:${a.category.toLowerCase()}`. Để lẫn
       * "Design" và "design" là hai nhóm cùng tên nằm cạnh nhau.
       */
      ...(typeof p.category === "string" && p.category.trim()
        ? { category: p.category.trim().toLowerCase() }
        : {}),
      // Lower-cased and stripped: it becomes an `account_key` on the wire and is matched against
      // what the connector reports, so "Instagram" and "instagram" must not be two platforms.
      ...(typeof p.platform === "string" && /^[a-z0-9_]+$/i.test(p.platform)
        ? { platform: p.platform.toLowerCase() }
        : {}),
      ...(p.credentials && typeof p.credentials === "object" ? { credentials: p.credentials } : {}),
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
      return withSchema(cached.rows);
    }
    void refreshRemoteCatalog(src);
    return withSchema(BUILT_IN);   // first call, nothing fetched yet
  }

  const file = src ? (isAbsolute(src) ? src : join(repoRoot, src)) : DEFAULT_FILE;
  if (!existsSync(file)) return withSchema(BUILT_IN);
  try {
    const rows = parse(JSON.parse(readFileSync(file, "utf8")));
    return withSchema(rows.length ? rows : BUILT_IN);
  } catch (e) {
    console.warn(`[grokbot2] [plugins] ${file} is not readable JSON: ${(e as Error).message}`);
    return withSchema(cached?.rows ?? BUILT_IN);
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

/**
 * The credential form the client shows when someone clicks Add.
 *
 * Nothing new is declared for it: a row ALREADY says which credentials it needs, because
 * secrets.ts substitutes `${NAME}` in the spec at spawn. Deriving the form from those placeholders
 * keeps one source of truth — a row cannot ask for a credential it never uses, or use one it never
 * asks for.
 *
 * Required follows the same split spawn already makes, so the form promises exactly what the spawn
 * enforces:
 *   a placeholder in `args` is REQUIRED  — the spawn refuses without it (arguments are positional)
 *   a placeholder in `env`  is optional  — the spawn drops the key and the server runs degraded
 *
 * The shape is JSON Schema because that is what the client parses: `properties` becomes the fields,
 * `title` the label, `description` the hint, and it marks a field secret on its own when the key
 * matches /TOKEN|SECRET|KEY|PASSWORD|CREDENTIAL/ — which our names already do.
 */
const PLACEHOLDER = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

function credentialSchema(row: PluginEntry): PluginEntry["variablesSchema"] | undefined {
  const names = (values: string[]): string[] =>
    [...new Set(values.flatMap((v) => [...v.matchAll(PLACEHOLDER)].map((m) => m[1])))];

  // A header credential is required for the same reason an arg one is: without it the server is not
  // reachable at all (a remote server answers 401), so asking for it later is asking too late.
  const required = names([...(row.mcp?.args ?? []), ...Object.values(row.mcp?.headers ?? {})]);
  const optional = names(Object.values(row.mcp?.env ?? {})).filter((n) => !required.includes(n));
  if (required.length + optional.length === 0) return undefined;

  const properties: Record<string, Record<string, string>> = {};
  for (const name of [...required, ...optional]) {
    const note = row.credentials?.[name];
    properties[name] = {
      type: "string",
      ...(note?.title ? { title: note.title } : {}),
      ...(note?.description ? { description: note.description } : {}),
    };
  }
  // A row may override the split — `required: false` on an arg placeholder, or true on an env one.
  const isRequired = (n: string): boolean => row.credentials?.[n]?.required ?? required.includes(n);
  return { properties, required: [...required, ...optional].filter(isRequired) };
}

/** Attach the derived form to a row. Kept out of `parse` so it also covers the built-in fallback. */
const withSchema = (rows: PluginEntry[]): PluginEntry[] =>
  rows.map((r) => { const v = credentialSchema(r); return v ? { ...r, variablesSchema: v } : r; });

/** The install spec for a catalog id — what `plugins.ts` writes into the user's MCP config. */
export function serverSpecFor(pluginId: number): { name: string; spec: Record<string, unknown> } | null {
  const row = catalog().find((p) => p.id === pluginId);
  // A row installs a server if it names EITHER a command (stdio) or a url (remote). Requiring a
  // command dropped every remote row on the floor: installed, and with nothing to connect to.
  if (!row?.mcp?.command && !row?.mcp?.url) return null;
  const m = row.mcp;
  return {
    name: m.name,
    spec: {
      ...(m.command ? { command: m.command } : {}),
      ...(m.args ? { args: m.args } : {}),
      ...(m.env ? { env: m.env } : {}),
      ...(m.url ? { url: m.url } : {}),
      ...(m.headers ? { headers: m.headers } : {}),
    },
  };
}

/** True when the id exists in the catalog at all (a skill-only row installs no server). */
export const isKnownPlugin = (pluginId: number): boolean => catalog().some((p) => p.id === pluginId);
