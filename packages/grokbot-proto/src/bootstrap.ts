/**
 * Bootstrap ConnectRPC response builders (aiserver.v1.*) — the minimum set of
 * gate responses that let the Grok Bot frontend pass auth/access checks and render.
 *
 * Field numbers + enum values were extracted from the client bundle's protobuf
 * descriptors (see docs/protocol-reference.md). Gate values:
 *   SandAccessState.GRANTED = 1, SandAccessBlockReason.NONE = 1, SandTrialClaimStatus.NONE = 1.
 */
import { message, pbStr, pbVar, pbBool, pbMsg, pbF64, readVarintField, unframe } from "./encode.js";
import { pbStruct, readStringMapField, type StructValue } from "./struct.js";
import {
  LOCAL_PLUGINS, plugin, userPluginInstall, accountIdentifier, splitAccountIdentifier, toolStatus,
  currentPeriodUsage, listMarketplaces, availableMcpServers, listMarketplacePlugins, listMarketplacePluginsJson, getEffectiveUserPlugins, getEffectiveUserPluginsJson,
  type PluginEntry,
} from "./bootstrap-plugins.js";
import { bootstrapStatsigJson } from "./feature-gates.js";
import { listMarketplaceResponse, templateImportDetailsResponse, publicListingResponse, type MarketplacePort } from "./marketplace-rpc.js";
export { statsigBootstrapConfig, bootstrapStatsigJson } from "./feature-gates.js";
// Giữ nguyên bề mặt công khai: nơi khác vẫn `import { listMarketplaces } from "@grokbot2/proto"`.
export {
  currentPeriodUsage, listMarketplaces, availableMcpServers, listMarketplacePlugins, listMarketplacePluginsJson, getEffectiveUserPlugins, getEffectiveUserPluginsJson,
  type PluginEntry,
} from "./bootstrap-plugins.js";

import { readString, readStrings, readVarint, readVarints, readMessages, readBytes } from "./decode.js";
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
  "ListSandMcpTools",
  "GetMcpConfig",
  "RenameMcpOAuthAccount",
  "DeleteMcpOAuthAccount",
  "TranscribeAudio",
] as const;

/**
 * Per-request context handed to every bootstrap builder.
 *
 * `user` is decoded from the request's `Authorization` header by the backend (auth.ts
 * `verifyJwt`); it is `null` for an unauthenticated call. Threaded but not yet consumed —
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
  /**
   * Tên plan của người gọi ("free"/"pro"), cho `grok_plan_label` của trang Usage & Billing.
   * Absent khi billing tắt — builder khi đó trả đúng stub lịch sử, không thêm field nào.
   */
  plan?: string;
  /**
   * Trang gói/thanh toán CỦA MÌNH, cho khối On-Demand của trang Usage & Billing (field 13).
   *
   * Vắng ⇒ **không phát field 13 và không bật cổng `sand_on_demand_settings`** — hai thứ đi cùng
   * nhau có chủ ý, xem chú thích của `GetSandUsageStatus`. Backend đưa xuống (`GROKBOT2_CHECKOUT_URL`);
   * gói này thuần protobuf, không đọc env.
   */
  dashboardUrl?: string;
  /** The raw (unframed) request body, for the one RPC whose argument matters: InstallUserPlugin. */
  body?: Buffer;
  /**
   * Vé cổng dành riêng cho người gọi, đóng vào bản mô tả box (`EnsureSandBox`, trường 11).
   *
   * Gói này không tự sinh ra được — nó thuần protobuf, không giữ bí mật nào. Backend đưa xuống.
   * Vắng mặt ⇒ vé dùng chung như trước, tức mọi máy là một người.
   */
  gatewayTicket?: string;
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
  /**
   * The URL to send somebody to, for a server that wants a sign-in.
   *
   * `CheckHttpMcpStatusResponse.auth_url` is a field the BACKEND fills — the client opens whatever it
   * is given and listens on `oauth_redirect_uri` for the callback. Returning nothing means the
   * Authenticate button has nowhere to go, which is exactly how it failed silently.
   */
  authUrlFor?(serverUrl: string, redirectUri: string, accountKey?: string): string | undefined;
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
    /**
     * The sign-ins this connector holds, one row each in the pane's Accounts section.
     *
     * The client has always supported several accounts per server — `McpAccountInfo` and the
     * `account_key` that rides along with every token RPC exist for exactly that. Sending a single
     * hard-coded "default" row spent none of it, so a connector that reaches many services through
     * one endpoint had nothing per service to show and no per service button to press.
     */
    accounts?: { key: string; hasToken: boolean }[];
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
  /**
   * Turn recorded audio into text, for the composer's microphone.
   *
   * Absent ⇒ `TranscribeAudio` answers an empty text, which is what it did for its whole life: the
   * button recorded, sent, and got nothing back. A backend with no transcriber installed says so in
   * the log rather than pretending.
   */
  transcribe?(audio: Buffer, mimeType: string, language?: string): Promise<{ text: string; ms: number }>;
  /**
   * Marketplace bot + mẫu công khai (0.43 gọi từ main: `listPublicBotMarketplace`, `getPublicBotTemplate`).
   * Vắng ⇒ Marketplace trống và mọi shareId là NotFound — app vẽ danh sách rỗng, không vỡ.
   */
  marketplace?: MarketplacePort;
  /**
   * The caller's MCP config as the client wants to read it back.
   *
   * `GetMcpConfig` is the second most called RPC in the whole plugin surface and answered an empty
   * message for its entire life. The client parses `config_json` into `{mcpServers}` and keeps the
   * name -> server_id map beside it; that pair is what the OAuth flow validates an auth URL against.
   * `redactSecrets` is the client's own flag and is honoured, not ignored.
   */
  mcpConfig?(redactSecrets: boolean): { json: string; ids: Record<string, { serverId: number; pluginId?: number }> } | undefined;
  /**
   * Acting on one account row of a connector.
   *
   * Both RPCs answer an empty message, so the wire was never wrong — the ACTION was missing. Save
   * on a renamed account reverted a second later, which is the shape of bug this project keeps
   * finding: the call succeeds, nothing happens, and the UI quietly undoes itself.
   */
  accounts?: {
    rename(serverId: number, accountKey: string, newAccountKey: string): void;
    remove(serverId: number, accountKey: string): void;
  };
}

/**
 * Map of RPC method name -> bare protobuf response body.
 *
 * A builder may answer asynchronously. Only one does — transcription has to wait for a model — and
 * the dispatcher awaits whatever it gets, so every other builder stays the plain synchronous
 * function it was.
 */
export const bootstrapResponses: Record<string, (ctx: RpcCtx) => Buffer | Promise<Buffer>> = {
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

  /*
   * DashboardService.GetSandUsageStatus — nguồn CHÍNH của trang Settings → Usage & Billing.
   *
   * Field trích 03/09 từ proto trong `electron-main` 0.30 (docs/plan/usage-billing-page.md):
   *   1 current_period_start (Timestamp) · 2 next_reset_timestamp_utc (Timestamp)
   *   3 usage_percent (double, opt)      · 4 included_limit_zero (bool)
   *   7 has_available_usage (bool)       · 8 has_non_zero_included_limit (bool)
   *   11 sand_trial_cancelable (bool)    · 15 grok_plan_label (string, opt)
   *
   * FE tự ẨN từng khối khi field vắng mặt: không `usage_percent` thì không có thanh %, không
   * `on_demand_settings` (field 13) thì cả khối On-Demand biến mất. Trả thiếu tốt hơn trả bịa.
   *
   * SỬA 05/09 — chú thích cũ ở đây viết *"field 13 đơn vị là CENTS, số của ta là TOKEN"*. **Sai.**
   * Trích lại `SandOnDemandSettings` trong `main.cjs` 0.30: `{1 visible, 2 eligible, 3 enabled,
   * 4 dashboard_url}` — không một trường tiền nào. Cả `SandUpgradeRecommendation` cũng vậy:
   * `{1 cta (ErrorButton), 2 disabled, 3 supporting_text, 4 kind}`. Nghĩa là **chính hãng cũng không
   * gửi giá qua RPC này** — họ chỉ gửi một URL bảng điều khiển và một cái nút.
   *
   * Nên lý do THẬT ta chưa phát field 13 không phải "sai đơn vị", mà là **chưa có trang thanh toán
   * để trỏ tới** (`GROKBOT2_CHECKOUT_URL` chưa đặt). Có trang rồi thì phát
   * `{visible:true, eligible:true, enabled:false, dashboard_url:<trang của mình>}` là khối
   * On-Demand hiện, đúng cách hãng làm.
   *
   * NỐI 09/09, sau khi ĐỌC người tiêu thụ ở renderer 0.43 thay vì suy từ tên trường
   * (`chunk-usage-pane-Ddtsn1Jl.js`, hàm `js`):
   *
   *     const r = Me("sand_on_demand_settings");
   *     if (!r || t === null || !t.visible || !t.eligible) return null;
   *     const f = ze(authId);                    // → https://cursor.com/dashboard/spending
   *     const h = () => { a(t.dashboardUrl ?? f) };
   *
   * Bốn dữ kiện, mỗi cái đổi thiết kế một chút:
   *  1. Có **cổng tính năng** `sand_on_demand_settings` đứng trước. Phát field 13 mà không bật cổng
   *     là phát vào hư không — nên hai thứ buộc đi cùng nhau (`bootstrapStatsigJson` nhận `extra`).
   *  2. `visible` VÀ `eligible` phải cùng `true`. Bỏ trống `eligible` cho "thành thật" là thẻ biến
   *     mất — đúng họ bẫy *"validator của client có điều kiện KHÔNG ghi trong schema"*.
   *  3. `dashboardUrl` mà vắng thì nút rơi về `ze()` = **trang của HÃNG**. Nên phát `visible+eligible`
   *     khi chưa có URL của mình là đặt một nút mở `cursor.com` vào app của người dùng mình. Vì thế
   *     cả khối chỉ phát khi `ctx.dashboardUrl` có mặt, không có nhánh nào phát thiếu.
   *  4. `enabled` chỉ chọn CÂU MÔ TẢ, không mở/khoá gì. Ta không có cơ chế on-demand nào ⇒ `false`.
   *
   * Còn một điều bảng byte không nói được và phải quyết ở tầng sản phẩm: **chữ trên thẻ là của hãng,
   * nướng trong renderer** — nút ghi *"Open Cursor Dashboard"*, mô tả ghi *"Enable on-demand spend in
   * the Cursor dashboard."* Backend không đổi được chúng; muốn thẻ nói tiếng của mình thì phải vá
   * renderer rồi PHÁT HÀNH. Nên mặc định ở đây là TẮT (không đặt `GROKBOT2_CHECKOUT_URL` thì không
   * có gì đổi), và bật là một quyết định đi kèm một lần phát hành.
   *
   * Ctx hoàn toàn rỗng vẫn cho ra đúng stub lịch sử: không `dashboardUrl` ⇒ không field 13 ⇒ byte
   * không đổi. Lời hứa "inert" ở dưới còn nguyên.
   *
   * Ba nhánh, phân biệt bằng ctx:
   *   billing tắt  (không plan, không usage) → đúng stub lịch sử, byte không đổi — inert.
   *   plan không trần (pro: usage absent)    → không thanh %, chỉ nhãn plan; 8=false vì
   *                                            "included limit" thật sự không tồn tại.
   *   plan có trần (free: usage đủ bốn số)   → % + hai mốc chu kỳ + nhãn plan.
   */
  GetSandUsageStatus: (ctx) => {
    // google.protobuf.Timestamp: {1 seconds (varint)} — bỏ nanos, độ phân giải giây là thừa đủ.
    const moc = (ms: number) => message(pbVar(1, Math.max(0, Math.floor(ms / 1000))));
    // field 13 SandOnDemandSettings {1 visible, 2 eligible, 3 enabled, 4 dashboard_url} — cả bốn
    // hoặc không cái nào (lý do ở chú thích trên: thiếu 4 thì nút mở trang của hãng).
    const onDemand = ctx.dashboardUrl
      ? pbMsg(13, message(pbBool(1, true), pbBool(2, true), pbBool(3, false), pbStr(4, ctx.dashboardUrl)))
      : null;
    const u = ctx.usage;
    if (!u) {
      return ctx.plan == null
        ? message(pbBool(4, false), pbBool(7, true), pbBool(8, true), pbBool(11, false), onDemand)
        : message(pbBool(4, false), pbBool(7, true), pbBool(8, false), pbBool(11, false), onDemand, pbStr(15, ctx.plan));
    }
    const pct = u.limit > 0 ? Math.max(0, (u.used / u.limit) * 100) : 0;
    return message(
      pbMsg(1, moc(u.cycleStartMs)),
      pbMsg(2, moc(u.cycleEndMs)),
      pbF64(3, pct),
      pbBool(4, u.limit <= 0),
      pbBool(7, u.used < u.limit),
      pbBool(8, u.limit > 0),
      pbBool(11, false),
      onDemand,
      ...(ctx.plan == null ? [] : [pbStr(15, ctx.plan)]),
    );
  },

  // DashboardService.GetSandTrialClaimStatus -> NONE(1)
  GetSandTrialClaimStatus: () => message(pbVar(1, 1)),

  // GrokBotService.EnsureSandBox -> descriptor pointing the box gateway/vnc/exec at this backend.
  // Override these URLs in production to point at the real VPS box.
  EnsureSandBox: (ctx) => ensureSandBox(undefined, ctx.gatewayTicket),
  EnsureSandBoxWindow: (ctx) => ensureSandBox(undefined, ctx.gatewayTicket),

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
  /**
   * aiserver.v1.TranscribeAudio — the microphone button, which did nothing at all.
   *
   * Request: audio (1, bytes), mime_type (2), language (3, optional). Response: text (1),
   * transcription_time_ms (2). Read as BYTES, not as a string: the two share a wire type, and
   * decoding audio as UTF-8 corrupts it silently.
   *
   * A failure answers empty text rather than an error status. The client puts whatever it is given
   * into the composer, and an empty box the person can retype is a better outcome than an error
   * dialog over a dictation attempt.
   */
  // GrokBotService — Marketplace bot + template công khai (xem marketplace-rpc.ts). Lỗi ném ra là
  // `ConnectRpcError`; ACL đổi thành HTTP/JSON đúng giao thức, không phải reply rỗng 200.
  ListPublicGrokBotMarketplaceListings: (ctx) => listMarketplaceResponse(ctx.marketplace, ctx.body),
  GetGrokBotTemplateImportDetails: (ctx) => templateImportDetailsResponse(ctx.marketplace, ctx.body),
  GetPublicGrokBotMarketplaceListing: (ctx) => publicListingResponse(ctx.marketplace, ctx.body),

  TranscribeAudio: async (ctx) => {
    const body = ctx.body ? unframe(ctx.body) : null;
    const audio = body ? readBytes(body, 1) : Buffer.alloc(0);
    if (!audio.length || !ctx.transcribe) return message(pbStr(1, ""), pbVar(2, 0));
    try {
      const { text, ms } = await ctx.transcribe(audio, readString(body!, 2), readString(body!, 3) || undefined);
      return message(pbStr(1, text), pbVar(2, ms));
    } catch (e) {
      console.warn(`[grokbot2] transcription failed: ${(e as Error).message}`);
      return message(pbStr(1, ""), pbVar(2, 0));
    }
  },

  /**
   * aiserver.v1.GetMcpConfig — the config the client reads back, and the name -> id map beside it.
   *
   * Request: team_scope (1), team_id (2), redact_secrets (3). Response: config_json (1) and
   * server_metadata_by_name (2) of ServerMetadata{1 plugin_id, 2 server_id}. A zero server_id is
   * dropped by the client's own reader, so ids here are the same 1-based numbers
   * `GetAvailableMcpServers` hands out — anything else and the two views disagree.
   *
   * Team scope answers empty: this backend has no teams, and inventing one would put a phantom
   * team's servers in the pane.
   */
  GetMcpConfig: (ctx) => {
    const body = ctx.body ? unframe(ctx.body) : null;
    if (body && readVarint(body, 1)) return message();
    const cfg = ctx.mcpConfig?.(Boolean(body && readVarint(body, 3)));
    if (!cfg) return message();
    return message(
      pbStr(1, cfg.json),
      ...Object.entries(cfg.ids).map(([name, meta]) => pbMsg(2, message(
        pbStr(1, name),
        pbMsg(2, message(
          ...(meta.pluginId ? [pbVar(1, meta.pluginId)] : []),
          pbVar(2, meta.serverId),
        )),
      ))),
    );
  },

  /** aiserver.v1.RenameMcpOAuthAccount — server_id (1), account_key (2), new_account_key (3). */
  RenameMcpOAuthAccount: (ctx) => {
    const body = ctx.body ? unframe(ctx.body) : null;
    if (body) ctx.accounts?.rename(readVarint(body, 1) ?? 0, readString(body, 2), readString(body, 3));
    return message();
  },

  /** aiserver.v1.DeleteMcpOAuthAccount — server_id (1), account_key (2). */
  DeleteMcpOAuthAccount: (ctx) => {
    const body = ctx.body ? unframe(ctx.body) : null;
    if (body) ctx.accounts?.remove(readVarint(body, 1) ?? 0, readString(body, 2));
    return message();
  },

  /**
   * aiserver.v1.ListSandMcpTools — the per-ACCOUNT status the pane draws beside each row.
   *
   * Never answered before, and the pane said so in its own words: an account row read "Not reported
   * by backend / Error" while the connector behind it was working. The connector's status is not
   * this RPC's answer — one endpoint can hold several sign-ins, and each row asks about its own.
   *
   * Request: `server_identifiers` (1, repeated) — the strings sent as `McpAccountInfo.server_identifier`,
   * i.e. `name:accountKey`. Response: `servers` (1) of
   * Server{1 server_identifier, 2 status, 3 tools, 4 account_label, 5 row_server_identifier}, where
   * `row_server_identifier` is what groups several rows into one connector.
   */
  ListSandMcpTools: (ctx) => {
    const wanted = ctx.body ? readStrings(unframe(ctx.body), 1) : [];
    const all = ctx.mcpServers ?? [];
    return message(...wanted.flatMap((identifier) => {
      const [serverName, accountKey] = splitAccountIdentifier(identifier);
      const server = all.find((s) => s.name === serverName);
      if (!server) return [];

      // The client asks by CONNECTOR name and expects the split to come back in the answer: one row
      // per account, all carrying the same `row_server_identifier`. Answering the question as asked
      // — one row for "zernio" — left every account row without a status of its own, which the pane
      // prints as "Not reported by backend".
      const accounts = accountKey
        ? (server.accounts ?? []).filter((a) => a.key === accountKey)
        : server.accounts ?? [];
      if (!accounts.length) {
        return [pbMsg(1, message(pbStr(1, identifier), pbStr(2, toolStatus(server.status)), pbStr(5, serverName)))];
      }
      return accounts.map((a) => pbMsg(1, message(
        pbStr(1, accountIdentifier(serverName, a.key)),
        // An account with no sign-in is `needsAuth` however healthy the connector is; one that has a
        // sign-in inherits the connector's own state, because that is what its calls will hit.
        pbStr(2, a.hasToken ? toolStatus(server.status) : "needsAuth"),
        // `account_label` reads like a display name and is not one: electron-main joins the tools
        // answer to an account with `o.accountLabel === s.accountKey`. Sending "Facebook" instead of
        // "facebook" broke that join silently, and the row printed "Not reported by backend".
        pbStr(4, a.key),
        pbStr(5, serverName),
      )));
    }));
  },

  CheckHttpMcpStatus: (ctx) => {
    const all = ctx.mcpServers ?? [];
    const body = ctx.body ? unframe(ctx.body) : null;
    const wanted = body ? readVarints(body, 1) : [];
    const ids = wanted.length ? wanted : all.map((_, i) => i + 1);
    const redirectUri = body ? readString(body, 2) : "";
    // account_key (8) is how the client says WHICH sign-in the button belongs to. Ignoring it is
    // why every account row on a connector could only ever be offered the one server-wide URL.
    const accountKey = body ? readString(body, 8) : "";
    return httpMcpStatusResponse(ids.flatMap((id) => {
      const s = all[id - 1];
      if (!s?.url) return [];          // stdio rows are not this RPC's business
      const account = accountKey ? s.accounts?.find((a) => a.key === accountKey) : undefined;
      // An account row answers for itself: it wants a sign-in when IT has no token, whatever the
      // connector as a whole is doing. Without this a signed-in connector reported every one of its
      // accounts as fine, and the unconnected ones never got a button.
      const requiresAuth = account ? !account.hasToken : s.status === "needsAuth";
      const hasToken = account ? account.hasToken : Boolean(s.hasToken);
      // The URL is asked for only when it is needed, and only when the client told us where to send
      // the callback — building one against a redirect it is not listening on cannot complete.
      const authUrl = requiresAuth && redirectUri && !hasToken
        ? ctx.authUrlFor?.(s.url, redirectUri, accountKey || undefined)
        : undefined;
      return [{
        id,
        isAvailable: s.status !== "error",
        requiresAuth,
        ...(authUrl ? { authUrl } : {}),
        hasValidToken: hasToken,
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
  /*
   * Cổng tính năng. Trước đây rơi vào nhánh mặc định `"{}"` — đúng 200 nhưng thiếu khoá `config`,
   * nên client không dựng được Statsig và mọi cổng về mặc định đóng. Đó là lý do "Teach a task"
   * không có trong menu "+". Xem `feature-gates.ts`.
   *
   * Danh tính đi vào chuỗi bootstrap để mỗi người có `userID` riêng — cùng lối với phần còn lại
   * của backend đa người dùng. Không có `ctx.user` (gọi trước khi đăng nhập) thì dùng một tên
   * chung; cổng của ta không phân biệt theo người nên giá trị vẫn đúng.
   */
  // Cổng `sand_on_demand_settings` bật ĐÚNG KHI `GetSandUsageStatus` phát được field 13 — cùng một
  // điều kiện, viết ở hai chỗ thì sẽ lệch (§7 "một danh sách sống ở HAI nơi").
  BootstrapStatsig: (ctx) =>
    bootstrapStatsigJson(ctx.user?.authId ?? "grokbot2-local", {
      sand_on_demand_settings: Boolean(ctx.dashboardUrl),
    }),
};

/**
 * Box descriptor. Field numbers and the URL shapes match a real box (see
 * docs/architecture/box-architecture.md): one pod exposing noVNC, an exec daemon and the gateway.
 *
 * `vnc_url` must be a full noVNC URL — `vnc.html` plus a `path` that reaches websockify —
 * because the app opens it as given. Point GROKBOT2_VNC_URL at a self-hosted box
 * (infra/vps/grok-box-up.sh brings one up); without it the pane stays unreachable.
 */
export function ensureSandBox(base = "http://localhost:8788", gatewayTicket?: string): Buffer {
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
    // Vé **của người gọi** khi backend đưa một cái; nếu không thì vé dùng chung như trước.
    // Đây là chỗ hai tài khoản đang dùng chung dữ liệu: app dội lại đúng chuỗi này trên mọi lời
    // gọi /gw, nên một vé dùng chung nghĩa là mọi máy desktop đều là một người.
    // Xem services/grokbot-backend/src/gateway-ticket.ts.
    pbStr(11, gatewayTicket || process.env.GROKBOT2_GATEWAY_TOKEN || "gw-token"), // gateway_token
    // The viewer config wants primaryUrl + forkBaseUrl + networkToken together; leaving the
    // fork base empty makes the whole vncProxy block invalid, so default it to the same box.
    pbStr(12, process.env.GROKBOT2_FORK_VNC_URL ?? new URL(vncUrl).origin), // fork_vnc_base_url
  );
}

