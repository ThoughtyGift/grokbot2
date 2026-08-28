/**
 * Plugin, marketplace và tài khoản — nửa "danh mục" của bootstrap.
 *
 * Tách khỏi `bootstrap.ts` vì hai lý do đo được: file kia đã 862 dòng (quá ngưỡng 800 của kho), và
 * hai nửa đổi vì hai lý do khác nhau — nửa kia là **hợp đồng RPC** với client, nửa này là **danh mục
 * hàng** mình tự quyết. Không có phụ thuộc ngược: khối này không dùng gì của `bootstrap.ts`.
 */
import { message, pbStr, pbVar, pbBool, pbMsg } from "./encode.js";
import { pbStruct, type StructValue } from "./struct.js";

/** Keep each Plugin message under 127 bytes so every length prefix is a 1-byte varint. */
export const LOCAL_PLUGINS = [
  {
    id: 1,
    name: "memory",
    displayName: "Grokbot2 Memory",
    description: "Local MCP test plugin.",
    mcp: { name: "memory", description: "From .mcp.json" },
  },
  {
    id: 2,
    name: "skill",
    displayName: "Grokbot2 Skill",
    description: "Local skill test plugin.",
    skill: { name: "local-skill", description: "Yours Private row" },
  },
] as const;

function mcpDescriptor(name: string, description: string): Buffer {
  return message(pbStr(1, name), pbStr(2, description));
}

function skillDescriptor(name: string, description: string): Buffer {
  return message(pbStr(1, name), pbStr(2, description));
}

/** aiserver.v1.Plugin — only fields the overlay's yPa() reads. No large int64 timestamps. */
/**
 * One catalog row on the wire. The BACKEND supplies these (it can read a file or a URL); this
 * package only encodes them, so a community registry never means protobuf changes.
 */
export interface PluginEntry {
  id: number;
  name: string;
  displayName: string;
  description: string;
  /** The MCP server this plugin installs. `command`/`args`/`env` are the install spec, not wire data. */
  mcp?: { name: string; description: string; command?: string; args?: string[]; env?: Record<string, string> };
  skill?: { name: string; description: string };
  /** https image for the row's icon. Any other scheme is rejected by the client's own fetcher. */
  logoUrl?: string;
  /**
   * Nhóm hiển thị trong pane Plugins. Bỏ trống thì rơi về `"featured"` — xem `pluginJson`, và đọc
   * kỹ chỗ đó trước khi bỏ trường này đi: thiếu nó, client 0.29 **sập cả pane**, không phải thiếu
   * một dòng.
   */
  category?: string;
  /**
   * The service this row connects, when its MCP server fronts several.
   *
   * One Zernio endpoint reaches Facebook, Instagram, TikTok and the rest, so the connector alone
   * cannot say which of them the person wanted. This is what turns an installed row into an account
   * row in the pane — and into a button that connects that one service.
   */
  platform?: string;
  /** JSON Schema for the credential form. Built by the backend from the spec's `${…}` placeholders. */
  variablesSchema?: { properties: Record<string, Record<string, string>>; required: string[] };
}

export function plugin(p: PluginEntry): Buffer {
  return message(
    pbVar(1, p.id),
    pbStr(2, p.name),
    pbStr(3, p.displayName),
    pbStr(4, p.description),
    pbVar(6, 3),
    // logo_url (10). Absent for a plugin the client already draws from its built-in brand set —
    // github, gmail→google, notion, playwright and a dozen more resolve locally, no request.
    p.logoUrl ? pbStr(10, p.logoUrl) : null,
    pbBool(12, true),
    pbStr(24, "https://local.test"),
    pbStr(27, "local.test"),
    "skill" in p && p.skill ? pbMsg(28, skillDescriptor(p.skill.name, p.skill.description)) : null,
    "mcp" in p && p.mcp ? pbMsg(32, mcpDescriptor(p.mcp.name, p.mcp.description)) : null,
    // variables (38), a google.protobuf.Struct holding JSON Schema. A non-empty one is what makes
    // the client open its "setup" form on Add instead of installing straight away — the reason a
    // plugin needing FACEBOOK_ACCESS_TOKEN had nowhere to type it.
    p.variablesSchema ? pbStruct(38, p.variablesSchema as unknown as Record<string, StructValue>) : null,
    pbVar(41, 1),
  );
}

function pluginJson(p: PluginEntry): Record<string, unknown> {
  return {
    id: String(p.id),
    name: p.name,
    ...(p.logoUrl ? { logoUrl: p.logoUrl } : {}),
    ...(p.variablesSchema ? { variables: p.variablesSchema } : {}),
    displayName: p.displayName,
    description: p.description,
    status: "PLUGIN_STATUS_APPROVED",
    isPublished: true,
    gitUrl: "https://local.test",
    fullRef: "local.test",
    ...("skill" in p && p.skill ? { skills: [{ name: p.skill.name, description: p.skill.description }] } : {}),
    ...("mcp" in p && p.mcp ? { mcpServers: [{ name: p.mcp.name, description: p.mcp.description }] } : {}),
    lifecycleState: "PLUGIN_LIFECYCLE_STATE_PUBLIC_LISTED",
    /**
     * `category` — thiếu trường này thì **cả pane Plugins sập**, không phải vẽ thiếu một dòng.
     *
     * Đo bằng cách bấm trong app 0.29 đã vá (28/08): pane hiện ra "This view failed to load."
     * Console chỉ đúng chỗ, trong `assets/view-*.js`:
     *
     *     function _t(a){ return a.replace(/\S+/g, e => e.charAt(0).toUpperCase()+e.slice(1)) }
     *     function Un(a){
     *       if (a.marketplace != null) return { key: "team-plugins", … };
     *       const e = _t(a.category);                       // ← a.category là undefined
     *       return { key: `category:${a.category.toLowerCase()}`, title: e, … };
     *     }
     *
     * Pane nhóm danh mục THEO `category`, không có đường thoát khi trường vắng: một `undefined`
     * ném `TypeError` trong lúc dựng nhóm, error boundary của router bắt, và toàn bộ màn Plugins
     * biến mất. Hai mươi lăm mục đều thiếu, nên nó sập ngay lần mở đầu tiên.
     *
     * `"featured"` là hằng số của chính renderer (`jt="featured"`), và nó xếp hạng 0 — tức nhóm
     * hiện trên cùng. Danh mục ở đây do người dùng tự khai trong `plugin-registry.json`, chưa có
     * phân loại thật, nên xếp tất cả vào nhóm đầu là đúng thay vì bịa ra dăm cái tên nhóm.
     *
     * Không có bài test tự động nào bắt được cái này: hợp đồng đếm tên lệnh, unit test gọi hàm.
     * Chỉ có mở app ra bấm.
     */
    category: p.category?.trim() || "featured",
  };
}

/**
 * aiserver.v1.GetCurrentPeriodUsageResponse — the app's usage bar.
 *
 * Field numbers read verbatim from the vendor bundle (`electron-main/main.cjs`):
 *   1 billing_cycle_start (int64)   2 billing_cycle_end (int64)   3 plan_usage (PlanUsage)
 *   6 enabled (bool)                7 display_message (string)
 * PlanUsage: 1 total_spend · 2 included_spend · 4 remaining · 5 limit (all int32).
 *
 * "Spend" is the vendor's unit; grokbot2 has no per-token price, so it reports ESTIMATED TOKENS —
 * the same number the meter records (compaction.estimateTokens). Labelling it in `display_message`
 * keeps that honest rather than implying a currency amount.
 *
 * With no usage in ctx (billing off, or an unknown caller) this answers `enabled:false`, which is
 * what the app reads as "no usage bar" — identical in effect to the empty message it used to get.
 */
export function currentPeriodUsage(u?: { used: number; limit: number; cycleStartMs: number; cycleEndMs: number; message?: string }): Buffer {
  if (!u) return message(pbBool(6, false));
  const used = Math.max(0, Math.round(u.used));
  const limit = Math.max(0, Math.round(u.limit));
  const planUsage = message(
    pbVar(1, used),                          // total_spend
    pbVar(2, limit),                         // included_spend
    pbVar(4, Math.max(0, limit - used)),     // remaining
    pbVar(5, limit),                         // limit
  );
  return message(
    pbVar(1, Math.round(u.cycleStartMs)),
    pbVar(2, Math.round(u.cycleEndMs)),
    pbMsg(3, planUsage),
    pbBool(6, true),
    pbStr(7, u.message ?? `${used.toLocaleString("en-US")} / ${limit.toLocaleString("en-US")} tokens (ước lượng)`),
  );
}

/**
 * aiserver.v1.ListMarketplacesResponse — which registries this install offers plugins from.
 *
 * Marketplace fields verbatim from the bundle: 1 id (int64), 2 name, 3 display_name, 4 description,
 * 5 git_url, 10 created_at (int64). One entry: this backend itself, so the pane names a real source
 * instead of showing none. `git_url` is a marker, not a fetch target — the catalog comes from
 * ListMarketplacePlugins on this same server.
 */
function marketplaceRow(): Buffer {
  return message(
    pbVar(1, 1),
    pbStr(2, "grokbot2-local"),
    pbStr(3, "Grokbot2 (self-hosted)"),
    pbStr(4, "Plugins served by this local backend."),
    pbStr(5, process.env.GROKBOT2_MARKETPLACE_URL ?? "https://local.test"),
    pbVar(10, 0),
  );
}

export function listMarketplaces(): Buffer {
  return message(pbMsg(1, marketplaceRow()));
}

/**
 * aiserver.v1.GetAvailableMcpServersResponse — the account's configured MCP servers.
 *
 * McpServerInfo fields verbatim: 1 id (int32), 2 name, 3 is_team_server, 4 enabled, 5 type,
 * 6 command, 7 args (repeated string), 8 url, 10 is_unseen, 12 is_required,
 * 13 managed_by_team_plugin_policy, 14 disabled_by_team_admin_policy, 15 server_identifier.
 *
 * `type` is "stdio" for a spawned command and "http" for a URL — the two transports the config
 * shape distinguishes. NOTHING from `env` is emitted: those hold live tokens, and this response
 * crosses to the renderer.
 */
export function availableMcpServers(
  servers?: {
    name: string; command?: string; args?: string[]; url?: string; hasToken?: boolean; pluginId?: number;
    accounts?: { key: string; hasToken: boolean }[];
  }[],
): Buffer {
  if (!servers?.length) return message();
  const rows = servers.map((s, i) =>
    pbMsg(1, message(
      pbVar(1, i + 1),
      pbStr(2, s.name),
      pbBool(3, false),
      pbBool(4, true),
      pbStr(5, s.url ? "http" : "stdio"),
      ...(s.command ? [pbStr(6, s.command)] : []),
      ...(s.args ?? []).map((a) => pbStr(7, a)),
      ...(s.url ? [pbStr(8, s.url)] : []),
      // plugin_id (9) ties the server back to the row that installed it, so the pane can put a
      // connector under its plugin instead of listing it loose.
      ...(s.pluginId ? [pbVar(9, s.pluginId)] : []),
      pbBool(10, false),
      // user_has_access_token (11) is how the ACCOUNT surface says "signed in", and it was the
      // missing piece: the Plugins pane reads a connector's sign-in state from here, not from the
      // box list this backend was carefully filling in. Never having sent it is why a remote row
      // read "Not reported by backend" — the client's own words for a status it was never given.
      pbBool(11, Boolean(s.hasToken)),
      pbBool(12, false),
      pbBool(13, false),
      pbBool(14, false),
      pbStr(15, s.name),
      // accounts (17) — McpAccountInfo{1 account_key, 2 server_identifier, 3 user_has_access_token}.
      // A caller that supplies none still gets the single "default" row: for an ordinary connector
      // that is the whole truth, and the pane has drawn it that way since this field was added.
      ...(s.accounts?.length
        ? s.accounts.map((a) =>
            pbMsg(17, message(pbStr(1, a.key), pbStr(2, accountIdentifier(s.name, a.key)), pbBool(3, a.hasToken))))
        : [pbMsg(17, message(pbStr(1, "default"), pbStr(2, s.name), pbBool(3, Boolean(s.hasToken))))]),
    )),
  );
  return message(...rows);
}

/** aiserver.v1.ListMarketplacePluginsResponse: plugins (1) repeated, has_more (3). */
export function listMarketplacePlugins(catalog: readonly PluginEntry[] = LOCAL_PLUGINS): Buffer {
  return message(...catalog.map((p) => pbMsg(1, plugin(p))), pbBool(3, false));
}

export function listMarketplacePluginsJson(catalog: readonly PluginEntry[] = LOCAL_PLUGINS): string {
  return JSON.stringify({ plugins: catalog.map(pluginJson), hasMore: false });
}

/**
 * aiserver.v1.GetEffectiveUserPluginsResponse.
 *
 * Plugin 1 is marked installed+enabled so Yours → Installed has a row to inspect. Plugin 2 stays
 * catalog-only so Marketplace still has an Add button.
 */
/**
 * aiserver.v1.UserPluginInstall — what `InstallUserPlugin` hands back.
 *
 * Fields verbatim from the vendor bundle: 1 user_id (int32), 2 plugin_id (int64), 4 is_enabled,
 * 6 created_at, 7 updated_at, 8 plugin (the same Plugin message the catalog uses).
 */
export function userPluginInstall(p: PluginEntry): Buffer {
  const now = Date.now();
  return message(
    pbVar(1, 1),
    pbVar(2, p.id),
    pbBool(4, true),
    pbVar(6, now),
    pbVar(7, now),
    pbMsg(8, plugin(p)),
  );
}

/**
 * Which plugins this account has installed.
 *
 * With no `installedIds` from the backend this keeps the historical stub (plugin 1 installed) so a
 * caller that does not supply the port sees exactly what it used to.
 */
export function getEffectiveUserPlugins(installedIds?: number[], catalog: readonly PluginEntry[] = LOCAL_PLUGINS): Buffer {
  const rows = installedIds
    ? catalog.filter((p) => installedIds.includes(p.id))
    : [LOCAL_PLUGINS[0]];
  // ALWAYS emit field 2 `marketplaces`, even with no installs.
  //
  // The response declares two repeated fields (1 plugins, 2 marketplaces) and only field 1 was ever
  // sent. That was harmless while a stub row was hardcoded, but once an account can legitimately
  // have zero installs the message became ZERO BYTES — and the app's "Yours" tab then crashed with
  // `Cannot read properties of undefined (reading 'length')`, closing the panel. Measured 2026-08-23
  // via CDP. A never-empty body is also simply the more complete answer: the tab groups plugins by
  // marketplace, so it needs the marketplace even when the plugin list is empty.
  return message(
    ...rows.map((p) => pbMsg(1, message(pbMsg(1, plugin(p)), pbBool(4, true)))),
    pbMsg(2, marketplaceRow()),
  );
}

export function getEffectiveUserPluginsJson(installedIds?: number[], catalog: readonly PluginEntry[] = LOCAL_PLUGINS): string {
  const rows = installedIds ? catalog.filter((p) => installedIds.includes(p.id)) : [LOCAL_PLUGINS[0]];
  return JSON.stringify({ plugins: rows.map((p) => ({ plugin: pluginJson(p), isEnabled: true })) });
}

/**
 * How the client names one account of a server: `name--accountKey`.
 *
 * Not a format worth inventing — it is `BWe` in electron-main, and the whole join depends on
 * matching it exactly. Sending `name:accountKey` instead looked reasonable and left a connected
 * account reading "Not reported by backend", because the status lookup silently found nothing.
 * The default account is the bare name, with no suffix at all.
 */
const DEFAULT_ACCOUNT_KEY = "default";

export function accountIdentifier(serverName: string, accountKey: string): string {
  return accountKey === DEFAULT_ACCOUNT_KEY ? serverName : `${serverName}--${accountKey}`;
}

/** The inverse. An identifier with no `--` is a plain connector, not an account of one. */
export function splitAccountIdentifier(identifier: string): [string, string | null] {
  const at = identifier.lastIndexOf("--");
  return at <= 0 ? [identifier, null] : [identifier.slice(0, at), identifier.slice(at + 2)];
}

/**
 * The four statuses this RPC's reader understands.
 *
 * The client maps anything else to error/"Not reported by backend" — which it did for a signed-in
 * Facebook account, because the connector was reported as `disconnected`: true of the socket, and
 * useless as a verdict on an account that has a working sign-in. Idle is not broken, so anything
 * outside the vocabulary is reported as connected rather than as a failure nobody can act on.
 */
export function toolStatus(status: string | undefined): string {
  return status === "needsAuth" || status === "error" || status === "loading" || status === "initializing"
    ? (status === "initializing" ? "loading" : status)
    : "connected";
}
