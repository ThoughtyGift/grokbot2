/**
 * S13 native HTTP — `/v1/*` as specified in `docs/api/grokbot2-v0.yaml`.
 *
 * Calls directory / conversation / runtime directly. Does not import the Cursor adapter, does
 * not speak protobuf, and does not name Cursor commands. `/gw/*` stays up beside this until P8.
 */
import type { IncomingHttpHeaders } from "node:http";
import type { ServerResponse } from "node:http";
import { checkAuth, noteAuth, ensureGatewayToken, authMode } from "./auth-gate.js";
import { registerUser, loginUser } from "./web-auth.js";
import { loginAllowed, noteLoginFailure, noteLoginSuccess } from "./login-throttle.js";
import { bumpTokenVersion } from "./token-version.js";
import { setPlan, getUser, accessVerdict } from "./billing.js";
import { currentOwner, runWithOwner } from "./request-context.js";
import { hostSettingsRef, inflight } from "./chat/state.js";
import { uiPrefs, patchUiPrefs } from "./host-settings.js";
import { getAgentAutomations, createAgentAutomation, updateAgentAutomation, deleteAgentAutomation,
  setAgentAutomationEnabled, parseCron } from "./automations.js";
import { SUBAGENT_TYPES } from "./subagents.js";
import {
  agentById,
  avatarRejection,
  clearAgentAvatar,
  createAgent,
  deleteAgents,
  getAgentAvatar,
  listAgents,
  listAllAgents,
  ownerOf,
  searchAgents,
  setAgentAvatarBytes,
  setAgentHiddenFromSidebar,
  setAgentNotificationsEnabled,
  setAgentNotifyOnUpdates,
  setAgentUnread,
  updateAgent,
} from "./directory/index.js";
import { latestEntry, promptAcceptanceStatus, reactToMessage, transcriptTail } from "./conversation/index.js";
import type { Entry } from "./conversation/types.js";
import { subscribe, type DomainEvent } from "./events.js";
import { foreverBoxStatus } from "./forever-box.js";
import { interruptAgentRun, isAgentRunning, resolveLocalToolPermission, respondToWidget, sendPrompt } from "./runtime/turn.js";
import { attachmentHref, toNativeAgent, toNativeEntry, toNativeRoutine, toNativeTranscriptPage } from "./native-map.js";
import { readAttachmentImage, stageImage, stageFile } from "./attachments.js";
import { catalog } from "./plugin-catalog.js";
import { installedIds, installPlugin, uninstallPlugin } from "./plugins.js";

const STARTED_AT = Date.now();
let lastBusyAtMs = 0;

const AGENT_ID = /^agent-\d+$/;
/*
 * Nguồn được phép gọi có kèm giấy tờ. localhost cho lúc dev; thêm tên miền thật qua
 * `GROKBOT2_ALLOW_ORIGIN` (phẩy để nhiều cái) khi đưa BFF ra ngoài ở chặng 4.
 *
 * KHÔNG bao giờ trả `*` cùng `allow-credentials: true` — trình duyệt cấm, và nếu lách được thì đó là
 * cho mọi trang web trên đời mượn phiên đăng nhập của người dùng. Nên chỉ những nguồn khai rõ ở đây.
 */
const CORS_ORIGINS = new Set([
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  ...(process.env.GROKBOT2_ALLOW_ORIGIN ?? "").split(",").map((o) => o.trim()).filter(Boolean),
]);

/**
 * Native SSE clients, each tagged with its owner (multi-tenant Phase 3, second surface).
 *
 * `packages/cursor-acl/src/sse.ts` is the /gw stream; THIS is the independent /v1 stream grokbot-web
 * uses, and it broadcast every event to every client — one tenant's `agent.upserted` (with the whole
 * agent object) reached another's browser. Measured 2026-08-22: user B's stream carried user A's bot.
 * Now each connection carries the owner captured at open, and an event only goes to that owner's
 * streams.
 */
const sseClients = new Map<ServerResponse, string>();

const sseFrame = (res: ServerResponse, event: string, data: unknown): void => {
  try {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  } catch { /* client gone */ }
};

subscribe((e: DomainEvent) => {
  if (inflight.size > 0) lastBusyAtMs = Date.now();
  // Route per owner. The subscriber runs detached from any request, so the event's owner is the
  // AGENT's owner (ownerOf), never currentOwner(); a roster-wide event (no agentId) goes to all.
  // `teach.recording` là sự kiện DUY NHẤT không mang agentId ở cấp ngoài (trạng thái ghi tự mang
  // agentId bên trong), nên đọc thẳng `e.agentId` làm cả nhánh này không biên dịch được.
  const eventAgentId = "agentId" in e ? e.agentId : undefined;
  const eventOwner = eventAgentId ? ownerOf(eventAgentId) : undefined;
  for (const [res, owner] of sseClients) {
    if (eventOwner !== undefined && eventOwner !== owner) continue;   // another tenant's event
    // Build the payload AS that owner so agentById/listAllAgents scope to them.
    runWithOwner(owner, () => {
      if (e.type === "agent.upserted") {
        const agent = e.agentId ? agentById(e.agentId) : undefined;
        sseFrame(res, e.type, agent ? { agentId: e.agentId, agent: toNativeAgent(agent) } : { agents: listAllAgents().map(toNativeAgent) });
      } else if (e.type === "teach.recording") {
        // Trạng thái ghi đi nguyên khối: nó tự mang agentId bên trong.
        sseFrame(res, e.type, e.state);
      } else if (e.type === "computer.action") {
        sseFrame(res, e.type, { agentId: e.agentId, ...e.action });
      } else {
        sseFrame(res, e.type, { agentId: e.agentId });
      }
    });
  }
});

setInterval(() => {
  for (const res of sseClients.keys()) {
    try { res.write(": ping\n\n"); } catch { /* gone */ }
  }
}, 5000);

function corsHeaders(origin: string | undefined): Record<string, string> {
  const allow = origin && CORS_ORIGINS.has(origin) ? origin : "http://localhost:5173";
  return {
    "access-control-allow-origin": allow,
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "access-control-allow-credentials": "true",
    vary: "origin",
  };
}

function json(res: ServerResponse, value: unknown, status: number, origin: string | undefined): true {
  res.writeHead(status, { "content-type": "application/json", ...corsHeaders(origin) });
  res.end(JSON.stringify(value));
  return true;
}

function empty(res: ServerResponse, status: number, origin: string | undefined): true {
  res.writeHead(status, corsHeaders(origin));
  res.end();
  return true;
}

function originOf(headers: IncomingHttpHeaders): string | undefined {
  const raw = headers.origin ?? headers.Origin;
  return typeof raw === "string" ? raw : undefined;
}

function parseJson(body: Buffer): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  if (!body.length) return { ok: true, value: {} };
  try {
    const value = JSON.parse(body.toString("utf8")) as unknown;
    if (value && typeof value === "object" && !Array.isArray(value)) return { ok: true, value: value as Record<string, unknown> };
    return { ok: false, error: "body must be a JSON object" };
  } catch {
    return { ok: false, error: "bad json" };
  }
}

function nativeHealth(): Record<string, unknown> {
  const running = [...inflight.keys()];
  if (running.length > 0) lastBusyAtMs = Date.now();
  return {
    ok: true,
    pid: process.pid,
    isBusy: running.length > 0,
    activeAgentId: running[0] ?? null,
    startedAt: STARTED_AT,
    lastBusyAtMs,
  };
}

function exists(agentId: string): boolean {
  return Boolean(agentById(agentId));
}

function seqOf(agentId: string, entryId: string): number {
  const hit = transcriptTail({ agentId, limit: 1000 }).entries.find((e) => e.id === entryId);
  return hit?.seq ?? latestEntry(agentId)?.seq ?? 1;
}

function isNativePath(pathname: string): boolean {
  return (
    pathname === "/v1/health"
    || pathname === "/v1/session"
    || pathname === "/v1/login"
    || pathname === "/v1/register"
    || pathname === "/v1/logout"
    || pathname === "/v1/me"
    || pathname === "/v1/billing/webhook"
    || pathname === "/v1/events"
    || pathname === "/v1/agents"
    || pathname.startsWith("/v1/agents/")
    || pathname === "/v1/host/sidebar"
    || pathname === "/v1/host/settings"
    || pathname === "/v1/search"
    || pathname === "/v1/subagents"
    || pathname === "/v1/plugins"
    || pathname.startsWith("/v1/plugins/")
    || pathname === "/v1/attachments"
  );
}

/**
 * Returns true when this request is a native `/v1` route (including OPTIONS preflight).
 */
export async function handleNative(
  url: string,
  body: Buffer,
  res: ServerResponse,
  headers: IncomingHttpHeaders,
  method: string,
): Promise<boolean> {
  let parsed: URL;
  try {
    parsed = new URL(url, "http://127.0.0.1");
  } catch {
    return false;
  }
  const pathname = parsed.pathname;
  const origin = originOf(headers);
  const verb = method.toUpperCase();

  if (verb === "OPTIONS" && pathname.startsWith("/v1/")) {
    return empty(res, 204, origin);
  }
  if (!isNativePath(pathname)) return false;

  const publicRoute = pathname === "/v1/health" || pathname === "/v1/session"
    || pathname === "/v1/login" || pathname === "/v1/register" || pathname === "/v1/logout"
    || pathname === "/v1/billing/webhook"   // authenticated by its own shared secret, not a user token
    || (pathname === "/v1/attachments" && verb === "GET");
  if (!publicRoute) {
    const verdict = checkAuth(url, headers as Record<string, unknown>);
    noteAuth(url, verdict);
    if (!verdict.allow) return json(res, { error: verdict.message ?? "unauthorized" }, 401, origin);
  }

  if (pathname === "/v1/health" && verb === "GET") {
    return json(res, nativeHealth(), 200, origin);
  }

  // Who am I + billing state (Phase 6 web UX). Authenticated; owner comes from the runWithOwner
  // scope index.ts sets around this request. grokbot-web reads `overQuota` + `checkoutUrl` to show
  // an Upgrade button when the account is out of quota.
  if (pathname === "/v1/me" && verb === "GET") {
    const owner = currentOwner();
    const u = getUser(owner);
    const email = u?.email ?? "";
    return json(res, {
      authId: owner,
      email,
      plan: u?.plan ?? "free",
      overQuota: accessVerdict({ authId: owner, email }) === "payment_required",
      checkoutUrl: process.env.GROKBOT2_CHECKOUT_URL ?? "",
    }, 200, origin);
  }

  if (pathname === "/v1/session" && verb === "GET") {
    const token = ensureGatewayToken();
    return json(res, { token, tokenType: "bearer", auth: authMode() }, 200, origin);
  }

  // Web login (Phase 4). Public routes: exchange credentials for a signed user JWT that the browser
  // then sends as Bearer on /v1, giving each account its own owner-scoped space.
  if (pathname === "/v1/register" && verb === "POST") {
    const b = parseJson(body);
    if (!b.ok) return json(res, { error: b.error }, 400, origin);
    const out = registerUser(String(b.value.email ?? ""), String(b.value.password ?? ""));
    // Đăng ký đóng là 403 chứ không phải 400: người gọi không sai cú pháp, họ chỉ không được phép.
    const code = out.ok ? 200 : out.error === "registration is closed" ? 403 : 400;
    return json(res, out.ok ? { token: out.token, email: out.email } : { error: out.error }, code, origin);
  }
  if (pathname === "/v1/login" && verb === "POST") {
    const b = parseJson(body);
    if (!b.ok) return json(res, { error: b.error }, 400, origin);
    const email = String(b.value.email ?? "");
    /*
     * Ô đếm chia theo email + người gọi. `handleNative` không nhận socket, nên nguồn duy nhất là
     * `x-forwarded-for` — và đó cũng chính là thứ có thật khi backend đứng sau reverse proxy.
     * Không có header thì mọi request cùng chung một ô "local": đúng với hôm nay, khi cổng chỉ nghe
     * `127.0.0.1` và chỉ có một người.
     *
     * Header giả được — nhưng nó chỉ dùng để CHIA ô đếm, không dùng để cấp quyền, nên giả nó cùng
     * lắm là tự tách mình sang một ô khác, vẫn bị đếm.
     */
    const ip = String(headers["x-forwarded-for"] ?? "").split(",")[0].trim() || "local";
    const gate = loginAllowed(email, ip);
    if (!gate.ok) {
      res.writeHead(429, {
        "content-type": "application/json",
        "retry-after": String(gate.retryAfterSec),
        ...corsHeaders(origin),
      });
      res.end(JSON.stringify({ error: "too many attempts", retryAfterSec: gate.retryAfterSec }));
      return true;
    }
    const out = loginUser(email, String(b.value.password ?? ""));
    if (out.ok) noteLoginSuccess(email, ip); else noteLoginFailure(email, ip);
    return json(res, out.ok ? { token: out.token, email: out.email } : { error: out.error }, out.ok ? 200 : 401, origin);
  }
  if (pathname === "/v1/logout" && verb === "POST") {
    /*
     * Đăng xuất giờ THU HỒI thật, không chỉ bảo trình duyệt quên.
     *
     * Bản trước trả 204 rồi thôi, nên token cũ vẫn mở được `/v1/me` suốt hạn của nó. Tăng số đời là
     * cắt mọi token đã phát cho người này — kể cả cái đang nằm trên một máy khác.
     */
    // Cùng nguồn danh tính với `/v1/me`: index.ts đã đặt phạm vi cho request này rồi, dựng thêm
    // một đường đọc token thứ hai ở đây là mời hai chỗ bất đồng ý kiến.
    bumpTokenVersion(currentOwner());
    return empty(res, 204, origin);
  }

  // Checkout webhook (Phase 5). Provider-agnostic: Stripe/Lemonsqueezy/etc. POST here after a
  // successful payment to flip the account onto a plan. Authenticated by a shared secret in
  // `x-webhook-secret` (set GROKBOT2_BILLING_WEBHOOK_SECRET); disabled until that env is set, so it
  // can never be hit anonymously. Body: { email | authId, plan, days? } — days omitted = no expiry.
  if (pathname === "/v1/billing/webhook" && verb === "POST") {
    const secret = process.env.GROKBOT2_BILLING_WEBHOOK_SECRET?.trim();
    if (!secret) return json(res, { error: "billing webhook disabled" }, 503, origin);
    if (String(headers["x-webhook-secret"] ?? "") !== secret) return json(res, { error: "unauthorized" }, 401, origin);
    const b = parseJson(body);
    if (!b.ok) return json(res, { error: b.error }, 400, origin);
    const email = typeof b.value.email === "string" ? b.value.email.trim().toLowerCase() : "";
    const authId = typeof b.value.authId === "string" && b.value.authId ? b.value.authId : (email ? `local|${email}` : "");
    const plan = typeof b.value.plan === "string" ? b.value.plan : "pro";
    const days = typeof b.value.days === "number" ? b.value.days : null;
    if (!authId) return json(res, { error: "email or authId required" }, 400, origin);
    setPlan(authId, plan, days != null ? Date.now() + days * 86_400_000 : null);
    return json(res, { ok: true, authId, plan }, 200, origin);
  }

  if (pathname === "/v1/attachments" && verb === "GET") {
    const path = parsed.searchParams.get("path") ?? "";
    if (!path.startsWith("/workspace/attachments/")) return json(res, { error: "not found" }, 404, origin);
    const hit = readAttachmentImage({ path });
    if (!hit) return json(res, { error: "not found" }, 404, origin);
    const comma = hit.dataUrl.indexOf(",");
    const mime = /^data:([^;]+)/.exec(hit.dataUrl)?.[1] ?? "application/octet-stream";
    const bytes = Buffer.from(hit.dataUrl.slice(comma + 1), "base64");
    res.writeHead(200, {
      "content-type": mime,
      "cache-control": "private, max-age=3600",
      ...corsHeaders(origin),
    });
    res.end(bytes);
    return true;
  }

  if (pathname === "/v1/attachments" && verb === "POST") {
    const parsedBody = parseJson(body);
    if (!parsedBody.ok) return json(res, { error: parsedBody.error }, 400, origin);
    const raw = typeof parsedBody.value.bytesBase64 === "string" ? parsedBody.value.bytesBase64
      : typeof parsedBody.value.dataUrl === "string" ? parsedBody.value.dataUrl
      : "";
    if (!raw) return json(res, { error: "bytesBase64 is required" }, 400, origin);
    const filename = typeof parsedBody.value.filename === "string" ? parsedBody.value.filename
      : typeof parsedBody.value.fileName === "string" ? parsedBody.value.fileName
      : "upload.png";
    const dataUrl = raw.startsWith("data:") ? raw : `data:image/png;base64,${raw}`;
    if (Buffer.byteLength(dataUrl) > 12 * 1024 * 1024) return json(res, { error: "attachment too large" }, 413, origin);
    /*
     * Ảnh đo được kích thước thì đi đường ảnh; mọi thứ khác (PDF, .md, .txt…) là TỆP — X8.
     * Trước đây route này trả `not an image` cho tệp thường, trong khi app gốc đính kèm được
     * mọi loại tệp (đường box-upload). `stageFile` đã có sẵn; chỉ route này chưa dùng nó.
     */
    const path = stageImage(dataUrl, filename) ?? stageFile(dataUrl, filename);
    if (!path) return json(res, { error: "empty attachment" }, 400, origin);
    const sized = readAttachmentImage({ path });
    return json(res, {
      path,
      fileName: filename,
      href: attachmentHref(path),
      mime: sized ? (/^data:([^;]+)/.exec(sized.dataUrl)?.[1] ?? "image/png") : "image/png",
      width: sized?.width ?? 0,
      height: sized?.height ?? 0,
    }, 201, origin);
  }

  if (pathname === "/v1/events" && verb === "GET") {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
      ...corsHeaders(origin),
    });
    res.write(": connected\n\n");
    sseFrame(res, "agent.upserted", { agents: listAllAgents().map(toNativeAgent) });
    // Tag the stream with the caller's owner (from the runWithOwner scope index.ts sets around this
    // request) so later events route only to this tenant.
    sseClients.set(res, currentOwner());
    res.on("close", () => { sseClients.delete(res); });
    return true;
  }

  /**
   * Nhóm sidebar — dữ liệu vốn đã có, chỉ chưa lộ ra.
   *
   * App gốc lấy nó qua `window.desktop.getHostSidebarSections()`, tức một bridge IPC mà web
   * không với tới. Nhưng chính dữ liệu đó nằm trong host settings (`sidebarSections`), nên
   * `/v1` chỉ cần đọc lại: không thêm nguồn, không thêm state, không bịa nhóm nào.
   *
   * Shape giữ nguyên như app gốc dùng: `[{id, name, agentIds}]`, và `__agents__` là mục
   * catch-all ("Unassigned") cho bot chưa thuộc nhóm nào.
   */
  /*
   * Bố cục của chính người đang đăng nhập (X2.3 / X5.3).
   *
   * `currentOwner()` chứ không phải một khoá dùng chung: hai tài khoản trên cùng backend phải có
   * bố cục riêng, nếu không người vào sau kéo sidebar là người trước mất bố cục mà không hiểu vì sao.
   */
  /*
   * X5.2 — tìm bot. `searchAgents` đã tìm cả TÊN lẫn NỘI DUNG transcript, nên trả kèm `why`: không
   * nói vì sao một bot khớp thì người dùng thấy một cái tên chẳng liên quan gì tới từ vừa gõ.
   */
  if (pathname === "/v1/search" && verb === "GET") {
    const q = (parsed.searchParams.get("q") ?? "").trim();
    if (!q) return json(res, { hits: [] }, 200, origin);
    const includeHidden = parsed.searchParams.get("includeHidden") === "1";
    const hits = searchAgents({ query: q, includeHidden }).map((rec) => ({
      agentId: rec.id,
      name: rec.name,
      why: rec.name.toLowerCase().includes(q.toLowerCase()) ? "name" as const : "transcript" as const,
    }));
    return json(res, { hits }, 200, origin);
  }

  /*
   * X5.5 — các loại subagent. Chỉ ĐỌC: đây là bảng đăng ký tĩnh, không phải danh sách đang chạy.
   * `toolCount` là số tiền tố tool mà loại đó được phép gọi, không phải số tool cụ thể — `allow`
   * khớp theo tiền tố ("browser_" phủ cả bộ), nên đếm tool cụ thể sẽ ra một con số sai mà trông đúng.
   */
  if (pathname === "/v1/subagents" && verb === "GET") {
    const kinds = Object.entries(SUBAGENT_TYPES).map(([id, t]) => ({
      id,
      label: t.label,
      description: t.prompt.split("\n")[0].slice(0, 160),
      model: t.model ?? "",
      toolCount: t.allow.length,
    }));
    return json(res, { kinds }, 200, origin);
  }

  /*
   * Plugins cho web (X5.4 FE). Nghiệp vụ đã có từ trước — `catalog()` (marketplace) và
   * `installPlugin`/`uninstallPlugin` (ghi MCP config CỦA CHÍNH CHỦ, per-owner từ Phase 6) —
   * đây chỉ là route mỏng, đúng vai của native.ts. App gốc đi cùng nghiệp vụ này qua
   * ListMarketplacePlugins/InstallUserPlugin bên /gw; hai bề mặt, một trạng thái.
   */
  const pluginRows = () => {
    const mine = new Set(installedIds());
    return catalog().map((p) => ({
      id: p.id, name: p.name, displayName: p.displayName, description: p.description,
      // Nhãn phải nói đúng thứ dòng đó LÀ, và trước đây nó nói sai: mọi plugin không phải MCP bị
      // gắn "skill", nên bộ lọc "Skills" liệt kê cả những plugin chẳng có skill nào. Phần proto
      // (`bootstrap.ts`) vốn đã đúng — chỉ phát descriptor skill khi có `p.skill` — nên lời nói sai
      // chỉ nằm ở bề mặt web này. Ba loại, đúng ba nhãn.
      kind: p.mcp ? ("mcp" as const) : p.skill ? ("skill" as const) : ("plugin" as const),
      installed: mine.has(p.id),
    }));
  };
  if (pathname === "/v1/plugins" && verb === "GET") {
    return json(res, { plugins: pluginRows() }, 200, origin);
  }
  const mPlugin = /^\/v1\/plugins\/(\d+)$/.exec(pathname);
  if (mPlugin && verb === "PATCH") {
    const parsedBody = parseJson(body);
    if (!parsedBody.ok) return json(res, { error: parsedBody.error }, 400, origin);
    if (typeof parsedBody.value.installed !== "boolean") return json(res, { error: "installed (boolean) is required" }, 400, origin);
    const pluginId = Number(mPlugin[1]);
    if (parsedBody.value.installed) {
      if (!installPlugin(pluginId)) return json(res, { error: "unknown plugin" }, 404, origin);
    } else {
      // Gỡ một plugin chưa cài là no-op, không phải lỗi — PATCH tả trạng thái ĐÍCH, không tả hành động.
      uninstallPlugin(pluginId);
    }
    return json(res, { plugins: pluginRows() }, 200, origin);
  }

  if (pathname === "/v1/host/settings" && verb === "GET") {
    return json(res, { ui: uiPrefs(currentOwner()) }, 200, origin);
  }
  if (pathname === "/v1/host/settings" && verb === "PATCH") {
    const parsed = parseJson(body);
    if (!parsed.ok) return json(res, { error: parsed.error }, 400, origin);
    return json(res, { ui: patchUiPrefs(currentOwner(), parsed.value) }, 200, origin);
  }

  if (pathname === "/v1/host/sidebar" && verb === "GET") {
    const raw = (hostSettingsRef() as { sidebarSections?: unknown }).sidebarSections;
    const sections = Array.isArray(raw)
      ? raw.filter((s): s is { id: string; name: string; agentIds: string[] } =>
          s != null && typeof s === "object"
          && typeof (s as { id?: unknown }).id === "string"
          && typeof (s as { name?: unknown }).name === "string")
        .map((s) => ({ id: s.id, name: s.name, agentIds: Array.isArray(s.agentIds) ? s.agentIds.filter((x) => typeof x === "string") : [] }))
      : [];
    return json(res, { sections }, 200, origin);
  }

  if (pathname === "/v1/agents" && verb === "GET") {
    const q = parsed.searchParams.get("q") ?? "";
    const includeHidden = parsed.searchParams.get("includeHidden") === "true" || parsed.searchParams.get("includeHidden") === "1";
    const listed = q
      ? searchAgents({ q, includeHidden })
      : (includeHidden ? listAllAgents() : listAgents());
    return json(res, listed.map(toNativeAgent), 200, origin);
  }

  if (pathname === "/v1/agents" && verb === "POST") {
    const parsedBody = parseJson(body);
    if (!parsedBody.ok) return json(res, { error: parsedBody.error }, 400, origin);
    const name = typeof parsedBody.value.name === "string" ? parsedBody.value.name : undefined;
    const description = typeof parsedBody.value.description === "string" ? parsedBody.value.description : undefined;
    const rec = createAgent({ name, description });
    const page = transcriptTail({ agentId: rec.id, limit: 200 });
    return json(res, {
      agent: toNativeAgent(agentById(rec.id) ?? rec),
      transcript: toNativeTranscriptPage(page.entries, page.hasMore),
    }, 201, origin);
  }

  const rest = pathname.slice("/v1/agents/".length);
  const slash = rest.indexOf("/");
  const agentId = slash === -1 ? rest : rest.slice(0, slash);
  const tail = slash === -1 ? "" : rest.slice(slash + 1);
  if (!AGENT_ID.test(agentId)) return json(res, { error: "not found" }, 404, origin);

  if (tail === "" && verb === "GET") {
    const rec = agentById(agentId);
    if (!rec) return json(res, { error: "not found" }, 404, origin);
    return json(res, toNativeAgent(rec), 200, origin);
  }

  if (tail === "" && verb === "PATCH") {
    const rec = agentById(agentId);
    if (!rec) return json(res, { error: "not found" }, 404, origin);
    const parsedBody = parseJson(body);
    if (!parsedBody.ok) return json(res, { error: parsedBody.error }, 400, origin);
    const b = parsedBody.value;
    if (typeof b.name === "string" || typeof b.description === "string") {
      updateAgent({
        id: agentId,
        ...(typeof b.name === "string" ? { name: b.name } : {}),
        ...(typeof b.description === "string" ? { description: b.description } : {}),
      });
    }
    if (typeof b.unread === "boolean") setAgentUnread({ id: agentId, unread: b.unread });
    if (typeof b.hidden === "boolean") setAgentHiddenFromSidebar({ id: agentId, hidden: b.hidden });
    if (typeof b.notificationsEnabled === "boolean") setAgentNotificationsEnabled({ id: agentId, enabled: b.notificationsEnabled });
    if (typeof b.notifyOnUpdates === "boolean") setAgentNotifyOnUpdates({ id: agentId, enabled: b.notifyOnUpdates });
    const updated = agentById(agentId);
    if (!updated) return json(res, { error: "not found" }, 404, origin);
    return json(res, toNativeAgent(updated), 200, origin);
  }

  /*
   * X5.1 — Routine (bên trong gọi là `automation`).
   *
   * Hình dạng trả về là hình dạng NATIVE, không phải blob mà client hãng nhận: `toClientAutomation`
   * gửi cùng một thứ dưới ba tên (`trigger`/`schedule`, `prompt`/`body`) vì các bản build của họ đọc
   * chỗ khác nhau. FE của mình không phải chịu cái đó — một tên một nghĩa.
   */
  if (tail === "routines" && verb === "GET") {
    return json(res, { routines: getAgentAutomations({ id: agentId }).map(toNativeRoutine) }, 200, origin);
  }
  if (tail === "routines" && verb === "POST") {
    const parsed = parseJson(body);
    if (!parsed.ok) return json(res, { error: parsed.error }, 400, origin);
    const b = parsed.value as { name?: unknown; prompt?: unknown; schedule?: unknown };
    if (typeof b.name !== "string" || !b.name.trim()) return json(res, { error: "name là bắt buộc" }, 400, origin);
    if (typeof b.prompt !== "string" || !b.prompt.trim()) return json(res, { error: "prompt là bắt buộc" }, 400, origin);
    if (typeof b.schedule !== "string" || !b.schedule.trim()) return json(res, { error: "schedule là bắt buộc" }, 400, origin);
    // Từ chối lịch không đọc được NGAY ở biên: nhận rồi mới im lặng không chạy thì tệ hơn nhiều.
    if (!parseCron(b.schedule)) return json(res, { error: `không hiểu lịch "${b.schedule}"` }, 400, origin);
    const list = createAgentAutomation({ id: agentId, spec: { name: b.name.trim(), prompt: b.prompt, trigger: b.schedule } });
    return json(res, { routines: list.map(toNativeRoutine) }, 201, origin);
  }
  if (tail.startsWith("routines/") && (verb === "PATCH" || verb === "DELETE")) {
    const routineId = decodeURIComponent(tail.slice("routines/".length));
    const before = getAgentAutomations({ id: agentId });
    if (!before.some((r) => r.id === routineId)) return json(res, { error: "not found" }, 404, origin);
    if (verb === "DELETE") {
      return json(res, { routines: deleteAgentAutomation({ id: agentId, automationId: routineId }).map(toNativeRoutine) }, 200, origin);
    }
    const parsed = parseJson(body);
    if (!parsed.ok) return json(res, { error: parsed.error }, 400, origin);
    const b = parsed.value as { name?: unknown; prompt?: unknown; schedule?: unknown; isEnabled?: unknown };
    if (typeof b.schedule === "string" && !parseCron(b.schedule)) {
      return json(res, { error: `không hiểu lịch "${b.schedule}"` }, 400, origin);
    }
    let list = before;
    if (typeof b.name === "string" || typeof b.prompt === "string" || typeof b.schedule === "string") {
      const cur = before.find((r) => r.id === routineId)!;
      list = updateAgentAutomation({
        id: agentId, automationId: routineId,
        spec: {
          name: typeof b.name === "string" ? b.name : cur.name,
          prompt: typeof b.prompt === "string" ? b.prompt : cur.prompt,
          trigger: typeof b.schedule === "string" ? b.schedule : cur.trigger,
        },
      });
    }
    if (typeof b.isEnabled === "boolean") {
      list = setAgentAutomationEnabled({ id: agentId, automationId: routineId, isEnabled: b.isEnabled });
    }
    return json(res, { routines: list.map(toNativeRoutine) }, 200, origin);
  }

  if (tail === "" && verb === "DELETE") {
    deleteAgents({ id: agentId });
    return empty(res, 204, origin);
  }

  /**
   * Avatar. Ba route, cùng một chỗ lưu với `/gw/avatars/<id>` mà client hãng đọc — nên ảnh đặt ở
   * FE này hiện luôn trong app gốc và ngược lại. Đặt ở `/v1` vì trước đây avatar chỉ có đường
   * `/gw` (`setAgentAvatarBytes`), tức FE của mình không có cách nào đổi ảnh.
   */
  if (tail === "avatar" && verb === "GET") {
    if (!agentById(agentId)) return json(res, { error: "not found" }, 404, origin);
    const { avatarDataUrl, avatarVersion } = getAgentAvatar({ id: agentId });
    const m = /^data:([a-z0-9.+/-]+);base64,(.*)$/i.exec(avatarDataUrl ?? "");
    if (!avatarVersion || !m) return json(res, { error: "agent has no avatar" }, 404, origin);

    const etag = `"${avatarVersion}"`;
    const asked = parsed.searchParams.get("v");
    // `?v=` là bản ghim: ghim sai phải 404 chứ không được lặng lẽ trả ảnh mới.
    if (asked != null && asked !== avatarVersion) return json(res, { error: "no such avatar version" }, 404, origin);
    const caching = asked != null
      ? { "cache-control": "private, max-age=31536000, immutable", etag }
      : { "cache-control": "no-store", etag };
    if (String(headers["if-none-match"] ?? "") === etag) {
      res.writeHead(304, { ...caching, ...corsHeaders(origin) });
      res.end();
      return true;
    }
    const body = Buffer.from(m[2], "base64");
    res.writeHead(200, {
      "content-type": m[1],
      "content-length": String(body.length),
      /*
       * Ba header cứng, giống hệt `/gw/avatars/<id>`: ảnh này là byte người dùng nạp lên, nên
       * dù `content-type` nói là ảnh thì vẫn phải chặn đường nó được render như một tài liệu.
       * Bỏ một trong ba ở đây mà `/gw` vẫn có nghĩa là chỉ FE của mình bị hở.
       */
      "content-disposition": "attachment",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
      ...caching,
      ...corsHeaders(origin),
    });
    res.end(body);
    return true;
  }

  if (tail === "avatar" && verb === "PUT") {
    if (!agentById(agentId)) return json(res, { error: "not found" }, 404, origin);
    const parsedBody = parseJson(body);
    if (!parsedBody.ok) return json(res, { error: parsedBody.error }, 400, origin);
    const raw = parsedBody.value.dataUrl ?? parsedBody.value.pngBase64;
    if (typeof raw !== "string" || !raw) return json(res, { error: "cần dataUrl hoặc pngBase64" }, 400, origin);
    const dataUrl = raw.startsWith("data:") ? raw : `data:image/png;base64,${raw}`;
    const bad = avatarRejection(dataUrl);
    // Ảnh quá to là 413, không phải 400 — FE phân biệt được để báo "ảnh quá lớn".
    if (bad) return json(res, { error: bad }, /quá \d+$/.test(bad) ? 413 : 400, origin);
    const rec = setAgentAvatarBytes({ id: agentId, pngBase64: dataUrl });
    if (!rec) return json(res, { error: "avatar bị từ chối" }, 400, origin);
    return json(res, toNativeAgent(rec), 200, origin);
  }

  if (tail === "avatar" && verb === "DELETE") {
    if (!clearAgentAvatar({ id: agentId })) return json(res, { error: "not found" }, 404, origin);
    return empty(res, 204, origin);
  }

  /**
   * Reaction trên một entry: `POST /v1/agents/:id/entries/:entryId/reactions` với `{ emoji }`.
   *
   * BE đã có reaction từ lâu qua lệnh `reactToMessage` của hãng (một trong 120 lệnh `/gw`), và
   * `/v1/.../transcript` đã trả `reactions` — thiếu đúng một thứ: đường để FE của mình *đặt* được.
   * Vì vậy đây là route mỏng, không phải tính năng mới: cùng một hàm domain, cùng ngữ nghĩa
   * **toggle** (bấm lại chính emoji đó là bỏ), nên đường `/v1` và app gốc không thể lệch nhau.
   */
  if (tail.startsWith("entries/") && tail.endsWith("/reactions") && verb === "POST") {
    if (!exists(agentId)) return json(res, { error: "not found" }, 404, origin);
    const entryId = decodeURIComponent(tail.slice("entries/".length, -"/reactions".length));
    if (!entryId) return json(res, { error: "missing entry id" }, 404, origin);
    const parsedBody = parseJson(body);
    if (!parsedBody.ok) return json(res, { error: parsedBody.error }, 400, origin);
    const emoji = parsedBody.value.emoji;
    if (typeof emoji !== "string" || !emoji.trim()) return json(res, { error: "cần emoji" }, 400, origin);
    /*
     * Chặn độ dài ở biên. Một reaction là một grapheme; không có cap thì trường này là chỗ nhét
     * chuỗi tuỳ ý vào transcript, và transcript thì đi vào cả prompt của model.
     */
    if ([...emoji].length > 8) return json(res, { error: "emoji quá dài" }, 400, origin);

    reactToMessage({ agentId, entryId, emoji });

    /*
     * Trả về entry sau khi đổi, không phải `{}`. `reactToMessage` là lệnh của hãng nên nó trả `{}`
     * theo contract của hãng — nhưng ở `/v1` mình tự đặt luật, và một client vừa toggle cần biết
     * kết quả là "đã thêm" hay "đã bỏ" mà không phải tải lại cả transcript để đoán.
     */
    const page = transcriptTail({ agentId, limit: 400 });
    const hit = page.entries.find((e) => e.id === entryId);
    if (!hit) return json(res, { error: "not found" }, 404, origin);
    return json(res, toNativeEntry(hit), 200, origin);
  }

  if (tail === "transcript" && verb === "GET") {
    const limit = Number(parsed.searchParams.get("limit") ?? 200);
    const beforeRaw = parsed.searchParams.get("beforeSeq");
    const beforeSeq = beforeRaw ? Number(beforeRaw) : undefined;
    const page = transcriptTail({
      agentId,
      limit: Number.isFinite(limit) ? limit : 200,
      ...(beforeSeq && Number.isFinite(beforeSeq) ? { beforeSeq } : {}),
    });
    return json(res, toNativeTranscriptPage(page.entries, page.hasMore), 200, origin);
  }

  if (tail === "turns" && verb === "POST") {
    if (!exists(agentId)) return json(res, { error: "not found" }, 404, origin);
    const parsedBody = parseJson(body);
    if (!parsedBody.ok) return json(res, { error: parsedBody.error }, 400, origin);
    const content = typeof parsedBody.value.content === "string" ? parsedBody.value.content : "";
    const attachments = Array.isArray(parsedBody.value.attachments)
      ? (parsedBody.value.attachments as { path?: string; name?: string }[])
      : undefined;
    if (!("content" in parsedBody.value) && !(attachments?.some((a) => a.path))) {
      return json(res, { error: "content is required" }, 400, origin);
    }
    const clientNonce = typeof parsedBody.value.clientNonce === "string" ? parsedBody.value.clientNonce : undefined;
    if (clientNonce) {
      const prior = promptAcceptanceStatus({ clientNonce });
      if (prior.outcome === "found" && prior.record) {
        const entryId = prior.record.echoEntryId ?? "";
        return json(res, { entryId, seq: seqOf(agentId, entryId), status: "duplicate" }, 202, origin);
      }
    }
    if (isAgentRunning(agentId)) return json(res, { error: "turn already running" }, 409, origin);
    const replyToEntryId = typeof parsedBody.value.replyToEntryId === "string" ? parsedBody.value.replyToEntryId : undefined;
    const accepted = sendPrompt({ agentId, content, clientNonce, attachments, askWriteTools: true, replyToEntryId });
    // Multi-tenant Phase 2: sendPrompt rejects an agent the caller does not own.
    if ("rejected" in accepted) return json(res, { error: "agent not found" }, 404, origin);
    return json(res, { entryId: accepted.entryId, seq: seqOf(agentId, accepted.entryId), status: "accepted" }, 202, origin);
  }

  if (tail === "turns/current" && verb === "DELETE") {
    interruptAgentRun({ agentId });
    return empty(res, 204, origin);
  }

  if (tail === "computer" && verb === "GET") {
    if (!exists(agentId)) return json(res, { error: "not found" }, 404, origin);
    const status = await foreverBoxStatus({ agentId });
    return json(res, status, 200, origin);
  }

  if (tail === "permissions" && verb === "POST") {
    if (!exists(agentId)) return json(res, { error: "not found" }, 404, origin);
    const parsedBody = parseJson(body);
    if (!parsedBody.ok) return json(res, { error: parsedBody.error }, 400, origin);
    const requestId = typeof parsedBody.value.requestId === "string" ? parsedBody.value.requestId : "";
    if (!requestId) return json(res, { error: "requestId is required" }, 400, origin);
    const approved = parsedBody.value.approved === true;
    const result = resolveLocalToolPermission({ agentId, requestId, approved });
    if (!result.resolved) return json(res, { error: "not found" }, 404, origin);
    return empty(res, 204, origin);
  }

  if (tail === "widgets" && verb === "POST") {
    if (!exists(agentId)) return json(res, { error: "not found" }, 404, origin);
    const parsedBody = parseJson(body);
    if (!parsedBody.ok) return json(res, { error: parsedBody.error }, 400, origin);
    const entryId = typeof parsedBody.value.entryId === "string" ? parsedBody.value.entryId : "";
    const value = typeof parsedBody.value.value === "string" ? parsedBody.value.value
      : typeof parsedBody.value.answer === "string" ? parsedBody.value.answer
      : "";
    if (!value.trim()) return json(res, { error: "value is required" }, 400, origin);
    const isWidget = (e: Entry): boolean => e.kind === "send-message" && e.message.type === "widget";
    const page = transcriptTail({ agentId, limit: 1000 });
    const target = entryId
      ? page.entries.find((e) => e.id === entryId && isWidget(e))
      : [...page.entries].reverse().find((e) => isWidget(e) && e.kind === "send-message" && e.respondedValue == null && e.widgetDismissed !== true);
    if (!target || target.kind !== "send-message" || target.message.type !== "widget") {
      return json(res, { error: "not found" }, 404, origin);
    }
    if (target.respondedValue != null || target.widgetDismissed === true) {
      return json(res, { error: "already answered" }, 409, origin);
    }
    const found = respondToWidget({ agentId, entryId: target.id, value: value.trim() });
    if (!found) return json(res, { error: "not found" }, 404, origin);
    return empty(res, 204, origin);
  }

  return json(res, { error: "not found" }, 404, origin);
}
