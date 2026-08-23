/**
 * Bootstrap ConnectRPC response builders (aiserver.v1.*) — the minimum set of
 * gate responses that let the Grok Bot frontend pass auth/access checks and render.
 *
 * Field numbers + enum values were extracted from the client bundle's protobuf
 * descriptors (see docs/protocol-reference.md). Gate values:
 *   SandAccessState.GRANTED = 1, SandAccessBlockReason.NONE = 1, SandTrialClaimStatus.NONE = 1.
 */
import { message, pbStr, pbVar, pbBool, pbMsg, readVarintField, unframe } from "./encode.js";
import { pbStruct, readStringMapField, type StructValue } from "./struct.js";
import { readString, readStrings, readVarint, readVarints, readMessages } from "./decode.js";
import {
  storePendingStateResponse, getPendingStateResponse, completeResponse, storeTokenResponse, httpMcpStatusResponse,
  getTokensResponse, validateTokensResponse, refreshLockBeginResponse, type OAuthPort,
} from "./oauth.js";

export const SPIKE_AUTH_ID = "auth0|grokbot2-user";

/**
 * Gate RPCs the stock app hits before the workspace (protocol-reference.md + plugins overlay).
 * `WatchSandBoxMigration` is listed by the client and has no builder here — empty proto 200.
 * F0 baseline `bootstrap.have` is how many of these have an explicit body in `bootstrapResponses`.
 */
export const BOOTSTRAP_GATE_METHODS = [
  "GetSandAccessStatus",
  "GetMe",
  "GetUserPrivacyMode",
  "GetSandUsageStatus",
  "GetSandTrialClaimStatus",
  "EnsureSandBox",
  "EnsureSandBoxWindow",
  "WatchSandBoxMigration",
  "ListMarketplacePlugins",
  "GetEffectiveUserPlugins",
  "GetCurrentPeriodUsage",
  "InstallUserPlugin",
  "UpdateUserPluginInstall",
  "StoreMcpOAuthPendingState",
  "GetMcpOAuthPendingState",
  "CompleteMcpOAuth",
  "StoreMcpOAuthToken",
  "GetMcpOAuthTokens",
  "ValidateMcpOAuthTokens",
  "DeleteMcpOAuthToken",
  "McpOAuthRefreshLockBegin",
  "McpOAuthRefreshLockRelease",
  "CheckHttpMcpStatus",
  "UninstallUserPlugin",
  "ListMarketplaces",
  "GetAvailableMcpServers",
] as const;

/**
 * Per-request context handed to every bootstrap builder.
 *
 * `user` is decoded from the request's `Authorization` header by the backend (auth.ts
 * `userFromToken`); it is `null` for an unauthenticated call. Threaded but not yet consumed —
 * builders still return constants (GRANTED, the fixed GetMe). Step ④ is where GetSandAccessStatus
 * reads `ctx.user` to gate on a plan. NOTE for ④: the fixed GetMe returns auth_id `"grokbot2-user"`
 * while a token's `sub` is `"auth0|grokbot2-user"` — the two are NOT interchangeable, so switching
 * GetMe to `ctx.user` is a deliberate output change, not a refactor.
 */
export interface RpcCtx {
  user: { authId: string; email: string } | null;
  /**
   * The access decision, computed by the backend (it owns the plan/quota DB — this package stays
   * pure protobuf, no storage). Absent/`"granted"` keeps the historical constant GRANTED, so an
   * unset ctx is inert. `"payment_required"` is what the backend returns under GROKBOT2_BILLING
   * enforce once a user is over quota.
   */
  access?: "granted" | "payment_required";
  /**
   * This period's usage for the caller, computed by the backend (it owns the `usage` table).
   * Absent ⇒ `GetCurrentPeriodUsage` answers `enabled:false`, i.e. the app draws no usage bar —
   * the historical behaviour when the RPC returned an empty message.
   */
  usage?: { used: number; limit: number; cycleStartMs: number; cycleEndMs: number; message?: string };
  /** The raw (unframed) request body, for the one RPC whose argument matters: InstallUserPlugin. */
  body?: Buffer;
  /**
   * Plugin installs for the caller, owned by the backend (it writes the per-user `.mcp.json`).
   * Absent ⇒ the historical hardcoded behaviour: plugin 1 shown installed, `Add` a no-op.
   */
  /**
   * Where an OAuth sign-in is remembered, owner-scoped by the backend.
   *
   * Absent ⇒ the OAuth RPCs answer empty, exactly as they did before they were handled — an
   * embedder with no store stays where it was instead of half-enabling a flow it cannot finish.
   */
  oauth?: OAuthPort;
  plugins?: {
    installedIds: number[];
    /**
     * Install by catalog id; false when the id is unknown. Writes the user's MCP config, and stores
     * `values` — what they typed into the credential form — where the spawn reads them from.
     */
    install(pluginId: number, values?: Record<string, string>): boolean;
    /** Remove an install; false when it was not installed. Takes its server out of the config. */
    uninstall?(pluginId: number): boolean;
    /** Re-save the credential form for an already-installed plugin (the "edit" flow). */
    setVariables?(pluginId: number, values: Record<string, string>): void;
  };
  /**
   * The MCP servers configured for the caller, from their own config (backend-owned, per-user under
   * multi-tenant Phase 6). Absent ⇒ `GetAvailableMcpServers` answers an empty list, as before.
   */
  mcpServers?: {
    name: string; command?: string; args?: string[]; url?: string;
    /** How the server is actually doing — `CheckHttpMcpStatus` answers from this, not from a probe. */
    status?: string;
    /** Whether a sign-in is stored for it, so the pane can tell "needs auth" from "signed in". */
    hasToken?: boolean;
    /** The catalog row that installed it, for McpServerInfo.plugin_id. */
    pluginId?: number;
  }[];
  /**
   * The plugin catalog, loaded by the backend (file or URL — see services/.../plugin-catalog.ts).
   * Absent ⇒ the two built-in rows, so a caller that supplies nothing behaves as before.
   */
  catalog?: readonly PluginEntry[];
}

/** Map of RPC method name -> bare protobuf response body. */
export const bootstrapResponses: Record<string, (ctx: RpcCtx) => Buffer> = {
  // DashboardService.GetSandAccessStatus. Enum numbers verified against the vendor bundle
  // (SandAccessState / SandAccessBlockReason): GRANTED=1/NONE=1, PAYMENT_REQUIRED=3/PAYWALL_INDIVIDUAL=7.
  // Default (ctx.access unset or "granted") is the historical constant, so this stays inert until
  // the backend returns "payment_required" under GROKBOT2_BILLING enforce.
  GetSandAccessStatus: (ctx) =>
    ctx.access === "payment_required" ? message(pbVar(1, 3), pbVar(3, 7)) : message(pbVar(1, 1), pbVar(3, 1)),

  // DashboardService.GetMe
  GetMe: () =>
    message(
      pbStr(1, "grokbot2-user"), // auth_id
      pbVar(2, 1), // user_id
      pbStr(3, "user@localhost"), // email
      pbStr(4, "Grok"), // first_name
      pbStr(5, "Local"), // last_name
      pbBool(9, false), // is_enterprise_user
    ),

  // DashboardService.GetUserPrivacyMode -> NO_STORAGE(1), acknowledged, not enforced
  GetUserPrivacyMode: () =>
    message(pbVar(1, 1), pbVar(2, 0), pbBool(3, false), pbBool(4, false), pbBool(6, true)),

  // DashboardService.GetSandUsageStatus -> usage available
  GetSandUsageStatus: () => message(pbBool(4, false), pbBool(7, true), pbBool(8, true), pbBool(11, false)),

  // DashboardService.GetSandTrialClaimStatus -> NONE(1)
  GetSandTrialClaimStatus: () => message(pbVar(1, 1)),

  // GrokBotService.EnsureSandBox -> descriptor pointing the box gateway/vnc/exec at this backend.
  // Override these URLs in production to point at the real VPS box.
  EnsureSandBox: () => ensureSandBox(),
  EnsureSandBoxWindow: () => ensureSandBox(),

  // Plugins overlay. Empty proto used to decode as plugins:[] → Marketplace "isn't available".
  // These are local stubs (not Cursor.com). yPa drops a Plugin with no mcp_servers and no skills.
  ListMarketplacePlugins: (ctx) => listMarketplacePlugins(ctx.catalog),
  GetEffectiveUserPlugins: (ctx) => getEffectiveUserPlugins(ctx.plugins?.installedIds, ctx.catalog),

  // The Marketplace "Add" button. Decodes plugin_id (field 1) from the request and asks the backend
  // to install it; the app then reloads its MCP servers and the row moves to "Yours → Installed".
  InstallUserPlugin: (ctx) => {
    const body = ctx.body ? unframe(ctx.body) : null;
    const id = body ? readVarintField(body, 1) : null;
    const row = id == null ? undefined : (ctx.catalog ?? LOCAL_PLUGINS).find((p) => p.id === id);
    // variables (5) carries whatever the person typed into the setup form. Empty when the plugin
    // declared none, so the no-credentials path is byte-identical to what it was.
    const values = body ? readStringMapField(body, 5) : {};
    if (!row || !ctx.plugins?.install(row.id, values)) return message();   // unknown id / no port
    return message(pbMsg(1, userPluginInstall(row)));
  },

  // "Edit" on an installed plugin submits the same form again. Request is
  // UpdateUserPluginInstallRequest{plugin_id @1, is_enabled @3, pinned_git_ref @5, variables @6};
  // without this the pencil saved nothing and the app reported success anyway.
  UpdateUserPluginInstall: (ctx) => {
    const body = ctx.body ? unframe(ctx.body) : null;
    const id = body ? readVarintField(body, 1) : null;
    const row = id == null ? undefined : (ctx.catalog ?? LOCAL_PLUGINS).find((p) => p.id === id);
    if (!row) return message();
    ctx.plugins?.setVariables?.(row.id, body ? readStringMapField(body, 6) : {});
    return message(pbMsg(1, userPluginInstall(row)));
  },


  /**
   * `CheckHttpMcpStatusRequest`: 1 server_ids (repeated int32) · 2 oauth_redirect_uri · … · 8 account_key
   * Response: 1 statuses — ServerStatus{1 id · 2 is_available · 3 requires_auth · 4 auth_url · 5 error · 6 has_valid_token}
   *
   * This is where the Plugins pane learns whether a REMOTE server wants a sign-in. Answering it
   * empty — which is what an unhandled RPC does — left the app with no status for an http row, and
   * it drew "Error" over a connector that was merely waiting to be authorised.
   *
   * Answered from what the backend already knows, never from a fresh probe: these builders are
   * synchronous, and the status the connection attempt recorded is better evidence than a second
   * request would be. `auth_url` is left empty deliberately — the client runs its own discovery and
   * builds the authorize URL with its own PKCE verifier, so a URL invented here would be one it
   * cannot complete.
   *
   * `server_ids` index the same list `GetAvailableMcpServers` numbers, 1-based.
   */
  CheckHttpMcpStatus: (ctx) => {
    const all = ctx.mcpServers ?? [];
    const body = ctx.body ? unframe(ctx.body) : null;
    const wanted = body ? readVarints(body, 1) : [];
    const ids = wanted.length ? wanted : all.map((_, i) => i + 1);
    return httpMcpStatusResponse(ids.flatMap((id) => {
      const s = all[id - 1];
      if (!s?.url) return [];          // stdio rows are not this RPC's business
      return [{
        id,
        isAvailable: s.status !== "error",
        requiresAuth: s.status === "needsAuth",
        hasValidToken: Boolean(s.hasToken),
      }];
    }));
  },

  // ── MCP OAuth ───────────────────────────────────────────────────────────────
  //
  // Ten RPCs, all storage. The client runs the OAuth itself — PKCE, dynamic registration, the token
  // exchange, and a loopback listener it binds — and persists each step through these. Answering
  // nothing was worse than refusing: an unhandled RPC replies 200 with an empty body, so a sign-in
  // reported success and saved nothing.
  //
  // With no `oauth` port these fall back to the previous empty replies, which keeps an embedder that
  // has no store exactly where it was rather than half-enabling a flow it cannot finish.

  // StoreMcpOAuthPendingStateRequest: 1 server_url · 2 code_verifier · 3 client_id · 4 client_secret
  // · 5 redirect_uri · 6 service_account_id · 7 account_key
  StoreMcpOAuthPendingState: (ctx) => {
    const b = ctx.body ? unframe(ctx.body) : null;
    if (!b || !ctx.oauth) return message();
    return storePendingStateResponse(ctx.oauth.storePending({
      serverUrl: readString(b, 1),
      codeVerifier: readString(b, 2),
      clientId: readString(b, 3) || undefined,
      clientSecret: readString(b, 4) || undefined,
      redirectUri: readString(b, 5) || undefined,
      serviceAccountId: readString(b, 6) || undefined,
      accountKey: readString(b, 7),
    }));
  },

  // GetMcpOAuthPendingStateRequest: 1 state_id
  GetMcpOAuthPendingState: (ctx) => {
    const b = ctx.body ? unframe(ctx.body) : null;
    if (!b || !ctx.oauth) return message();
    return getPendingStateResponse(ctx.oauth.getPending(readString(b, 1)));
  },

  // CompleteMcpOAuthRequest: 1 state_id · 2 authorization_code
  CompleteMcpOAuth: (ctx) => {
    const b = ctx.body ? unframe(ctx.body) : null;
    if (!b || !ctx.oauth) return message();
    return completeResponse(ctx.oauth.complete(readString(b, 1), readString(b, 2)));
  },

  // StoreMcpOAuthTokenRequest: 1 server_url · 2 refresh_token · 3 client_id · 4 client_secret
  // · 5 redirect_uri · 6 access_token · 7 service_account_id · 8 client_token_created_at_ms
  // · 9 source · 10 account_key
  StoreMcpOAuthToken: (ctx) => {
    const b = ctx.body ? unframe(ctx.body) : null;
    if (!b || !ctx.oauth) return message();
    const redirectUri = readString(b, 5);
    return storeTokenResponse(ctx.oauth.storeToken(
      readString(b, 1),
      readString(b, 10),
      {
        refreshToken: readString(b, 2) || undefined,
        clientId: readString(b, 3),
        clientSecret: readString(b, 4) || undefined,
        redirectUris: redirectUri ? [redirectUri] : [],
        accessToken: readString(b, 6) || undefined,
      },
      readVarint(b, 8),
    ));
  },

  // GetMcpOAuthTokensRequest: 1 server_urls (repeated) · 2 service_account_id · 3 account_key
  GetMcpOAuthTokens: (ctx) => {
    const b = ctx.body ? unframe(ctx.body) : null;
    if (!b || !ctx.oauth) return message();
    return getTokensResponse(ctx.oauth.getTokens(readStrings(b, 1), readString(b, 3)));
  },

  // ValidateMcpOAuthTokensRequest: 1 server_urls (repeated) · 2 service_account_id
  // · 3 targets (repeated Target{1 server_url · 2 account_key})
  //
  // Two ways of naming the same thing: older callers send bare urls, newer ones send targets that
  // carry an account. Reading only one of them would report "not signed in" for the other.
  ValidateMcpOAuthTokens: (ctx) => {
    const b = ctx.body ? unframe(ctx.body) : null;
    if (!b || !ctx.oauth) return message();
    const targets = readMessages(b, 3).map((t) => ({ serverUrl: readString(t, 1), accountKey: readString(t, 2) }));
    const bare = readStrings(b, 1)
      .filter((u) => !targets.some((t) => t.serverUrl === u))
      .map((serverUrl) => ({ serverUrl, accountKey: "" }));
    return validateTokensResponse(ctx.oauth.validate([...targets, ...bare]));
  },

  // DeleteMcpOAuthTokenRequest: 1 server_url · 2 service_account_id · 3 source · 4 account_key
  DeleteMcpOAuthToken: (ctx) => {
    const b = ctx.body ? unframe(ctx.body) : null;
    if (b && ctx.oauth) ctx.oauth.deleteToken(readString(b, 1), readString(b, 4));
    return message();   // DeleteMcpOAuthTokenResponse has no fields
  },

  // McpOAuthRefreshLockBeginRequest: 1 server_url · 2 executor_kind · 3 executor_id
  // · 4 observed_updated_at_ms · 5 service_account_id · 6 account_key
  McpOAuthRefreshLockBegin: (ctx) => {
    const b = ctx.body ? unframe(ctx.body) : null;
    const who = b ? readString(b, 3) : "";
    return refreshLockBeginResponse(`lease:${who || "local"}`);
  },

  // McpOAuthRefreshLockReleaseRequest: 1 lease_handle · 2 reason. No response fields.
  McpOAuthRefreshLockRelease: () => message(),

  // The counterpart to Add. Request is UninstallUserPluginRequest{plugin_id @1}; the response is
  // UninstallUserPluginResponse{success @1}, so an unknown or not-installed id answers success:false
  // rather than an empty body the app would have to guess at.
  UninstallUserPlugin: (ctx) => {
    const id = ctx.body ? readVarintField(unframe(ctx.body), 1) : null;
    const ok = id != null && (ctx.plugins?.uninstall?.(id) ?? false);
    return message(pbBool(1, ok));
  },

  // DashboardService.GetCurrentPeriodUsage — the app's own usage bar ("your included API usage").
  GetCurrentPeriodUsage: (ctx) => currentPeriodUsage(ctx.usage),

  // The registry this install offers plugins from. One self-hosted entry rather than Cursor's —
  // the catalog is served by ListMarketplacePlugins from this same backend.
  ListMarketplaces: () => listMarketplaces(),

  // The MCP servers this account actually has configured, so the app's MCP pane lists real rows
  // instead of nothing. Read from the caller's own config (per-user under Phase 6).
  GetAvailableMcpServers: (ctx) => availableMcpServers(ctx.mcpServers),
};

/** Connect `application/json` bodies — proto JSON names (camelCase, enums as names, int64 as string). */
export const bootstrapJsonResponses: Record<string, (ctx: RpcCtx) => string> = {
  ListMarketplacePlugins: (ctx) => listMarketplacePluginsJson(ctx.catalog),
  GetEffectiveUserPlugins: (ctx) => getEffectiveUserPluginsJson(ctx.plugins?.installedIds, ctx.catalog),
};

/**
 * Box descriptor. Field numbers and the URL shapes match a real box (see
 * docs/architecture/box-architecture.md): one pod exposing noVNC, an exec daemon and the gateway.
 *
 * `vnc_url` must be a full noVNC URL — `vnc.html` plus a `path` that reaches websockify —
 * because the app opens it as given. Point GROKBOT2_VNC_URL at a self-hosted box
 * (infra/vps/grok-box-up.sh brings one up); without it the pane stays unreachable.
 */
export function ensureSandBox(base = "http://localhost:8788"): Buffer {
  const vncUrl = process.env.GROKBOT2_VNC_URL ?? `${base}/vnc`;
  const execUrl = process.env.GROKBOT2_EXEC_URL ?? `${base}/exec`;
  const gatewayUrl = process.env.GROKBOT2_GATEWAY_URL ?? `${base}/gw`;
  return message(
    pbStr(1, process.env.GROKBOT2_CLUSTER ?? "local"), // cluster
    pbStr(2, "grokbot2"), // tenant_id
    pbStr(3, process.env.GROKBOT2_POD_ID ?? "local-pod"), // pod_id
    pbStr(4, "net-token"), // network_token
    pbStr(5, "exec-token"), // exec_daemon_auth_token
    pbStr(6, execUrl), // exec_daemon_url
    pbStr(7, vncUrl), // vnc_url
    pbStr(8, process.env.GROKBOT2_TERMINALS_FOLDER ?? "/workspace/terminals"), // terminals_folder
    pbStr(10, gatewayUrl), // gateway_url
    // The ticket the client presents on every /gw/* call. Minted per boot by the backend
    // (services/grokbot-backend/src/auth-gate.ts) — a literal here would be a credential written
    // in the source, which is no credential at all against a process that can read the repo.
    pbStr(11, process.env.GROKBOT2_GATEWAY_TOKEN ?? "gw-token"), // gateway_token
    // The viewer config wants primaryUrl + forkBaseUrl + networkToken together; leaving the
    // fork base empty makes the whole vncProxy block invalid, so default it to the same box.
    pbStr(12, process.env.GROKBOT2_FORK_VNC_URL ?? new URL(vncUrl).origin), // fork_vnc_base_url
  );
}

/** Keep each Plugin message under 127 bytes so every length prefix is a 1-byte varint. */
const LOCAL_PLUGINS = [
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
  /** JSON Schema for the credential form. Built by the backend from the spec's `${…}` placeholders. */
  variablesSchema?: { properties: Record<string, Record<string, string>>; required: string[] };
}

function plugin(p: PluginEntry): Buffer {
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
  servers?: { name: string; command?: string; args?: string[]; url?: string; hasToken?: boolean; pluginId?: number }[],
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
      // One account per server here; the shape exists so one server can be signed into twice.
      pbMsg(17, message(pbStr(1, "default"), pbStr(2, s.name), pbBool(3, Boolean(s.hasToken)))),
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
function userPluginInstall(p: PluginEntry): Buffer {
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
