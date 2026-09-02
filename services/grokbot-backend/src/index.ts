/**
 * Grok Bot 2 — self-host backend.
 *
 * Launch the stock Grok Bot desktop app with CURSOR_API_BASE_URL pointed here and
 * this backend serves everything the app needs: auth, the bootstrap ConnectRPC
 * gates, the box gateway (so the UI renders), and chat routed to your Claude pool.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { config } from "./config.js";
// Đây là tiến trình máy chủ, và chỉ nó được ghi kho. Đặt NGAY sau config để mọi module nạp sau
// đó — kể cả những module lưu lúc khởi động — đều lưu được. Xem enableWriting trong store.ts.
import { enableWriting } from "./store.js";
enableWriting();
import { handleAuth, verifyJwt, ownerFromAuth, ownerFromRequest, DEFAULT_USER } from "./auth.js";
import { handleLoginPage, handleAuthPoll, handleAuthApprove } from "./login-page.js";
import { handleWebApp } from "./web-app.js";
import { accessVerdict, currentPeriodUsage, billingMode, seedPlans, getUser } from "./billing.js";

// Bảng giá phải có TRƯỚC lượt chat đầu tiên, không phải lúc ai đó tình cờ hỏi gói.
// `off` thì không đụng vào sổ: một cài đặt không dùng billing không nên tự mọc thêm bảng.
if (billingMode() !== "off") seedPlans();
import { pluginsPortFor } from "./plugins.js";
import { oauthPortFor, oauthAccessToken } from "./mcp-oauth.js";
import { authUrlFor, completeAuthorization } from "./oauth-client.js";
import { mintTicket } from "./gateway-ticket.js";
import { mcpServers as mcpServersFor, mcpServerStatus } from "./mcp.js";
import { catalog as pluginCatalog } from "./plugin-catalog.js";
import {
  socialAccounts, socialConnectUrl, aliasServers, renameSocialAccount, clearSocialAlias, CONNECT_DONE_PATH,
} from "./social-connect.js";
import { runWithOwner } from "./request-context.js";
import { handleGateway, hostHealth, handleBootstrapRpc } from "./gateway.js";
import { saveNow, persistenceInfo } from "./store.js";
import { runtimeHealth } from "./brain.js";
import { chatSnapshot } from "./chat/state.js";
import { startScheduler, opsHealth, tick, dueIds, routinesForOps, fireById, fireListeners, fireByWebhook } from "./automations.js";
import { reportBoxConfig, computerHealth } from "./forever-box.js";
import { browserProbe, isBrowserConfigured } from "./browser.js";
import { reportMcpConfig, closeMcp } from "./mcp.js";
import { boxHealth } from "./box-exec.js";
import { logSafe } from "./redact.js";
import { recordUnknown, notFoundBody, saveCoverageNow } from "./observe.js";
import { ensureGatewayToken } from "./auth-gate.js";
import { authMode } from "./auth-mode.js";
import { handleAdmin } from "./admin.js";
import { handleSite } from "./site.js";
import { reportModelToolSupport } from "./model-probe.js";
import { handleNative } from "./native.js";
import { transcribe, isSttAvailable, closeStt } from "./stt.js";
import { closeTeach } from "./teach.js";
import { runOnUserComputer, userComputerConnected, findMachine, connectedMachines } from "./local-exec.js";
import { lamTrenTrinhDuyet } from "./local-browser.js";

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });
}


/**
 * The plugin-facing ports, built once per request so every view agrees on ids.
 *
 * `server_id` is the 1-based position in this list, and three different RPCs are joined on it:
 * `GetAvailableMcpServers` hands the ids out, `GetMcpConfig` maps names to them, and the account
 * RPCs arrive carrying one. Building the list twice was how those could silently disagree.
 */
/**
 * Một hàng cho mỗi MCP server đã cấu hình, đủ thứ pane cần để vẽ.
 *
 * Tách khỏi `mcpPorts` vì hai việc khác nhau: đây là *dựng hàng*, còn dưới kia là *ghép cổng cho
 * client gọi*. Trộn lại thì mỗi lần thêm một cột phải đọc cả hàm.
 */
function mcpRows(owner: string, configured: Record<string, { command?: string; args?: string[]; url?: string }>) {
  return Object.entries(configured).map(([name, spec]) => {
    const url = (spec as { url?: string }).url;
    return {
      name, command: spec.command, args: spec.args, url,
      // For CheckHttpMcpStatus: the pane needs to tell "wants a sign-in" from "broken", and an
      // http row with no status at all is drawn as an error over a connector merely awaiting auth.
      status: mcpServerStatus(name, owner).status,
      hasToken: url ? oauthAccessToken(url, owner) != null : false,
      // Which catalog row installed this server, so the pane can file the connector under it.
      pluginId: pluginCatalog().find((p) => p.mcp?.name === name)?.id,
      // One row per installed platform, when this connector fronts several — see social-connect.
      accounts: socialAccounts(name, owner),
    };
  });
}

function mcpPorts(owner: string) {
  const configured = mcpServersFor(owner);
  // Plus a row each platform plugin can own, so its own pane has the sign-in button. Answer-only:
  // they are not in the MCP config, so no extra connection and no repeated tools — see aliasServers.
  const rows = [
    ...mcpRows(owner, configured),
    ...aliasServers(
      owner,
      (n) => mcpServerStatus(n, owner).status,
      (n) => (configured[n] as { url?: string } | undefined)?.url,
    ),
  ];
  const nameOf = (serverId: number) => rows[serverId - 1]?.name;
  /** An alias row acts on its canonical connector — that is where the accounts actually live. */
  const canonicalOf = (name?: string) =>
    name == null ? undefined : name in configured ? name : pluginCatalog().find((p) => p.name === name)?.mcp?.name;

  return {
    mcpServers: rows,
    mcpConfig: (redactSecrets: boolean) => ({
      json: JSON.stringify({ mcpServers: redactSecrets ? redactSpecs(configured) : configured }, null, 2),
      ids: Object.fromEntries(rows.map((r, i) => [r.name, { serverId: i + 1, ...(r.pluginId ? { pluginId: r.pluginId } : {}) }])),
    }),
    accounts: {
      rename: (serverId: number, accountKey: string, newAccountKey: string) => {
        const server = canonicalOf(nameOf(serverId));
        if (server) renameSocialAccount(server, accountKey, newAccountKey, owner);
      },
      remove: (serverId: number, accountKey: string) => {
        const server = canonicalOf(nameOf(serverId));
        if (!server) return;
        // Only the alias is dropped here. The account itself lives in the connector's own store —
        // disconnecting it is that vendor's `delete-account`, a destructive call on somebody's real
        // Facebook Page, and it is not something to fire off a button press unasked.
        clearSocialAlias(server, accountKey, owner);
      },
    },
  };
}

/**
 * The config with credential VALUES stripped, for `redact_secrets`.
 *
 * These specs hold `${PLACEHOLDER}` strings rather than literal keys — the real values live in the
 * per-owner secrets file — so this is belt and braces. It is worth the belt: the one thing that must
 * never happen is a token reaching the renderer because a flag was ignored.
 */
function redactSpecs(configured: Record<string, unknown>): Record<string, unknown> {
  const hide = (o?: Record<string, string>) =>
    o && Object.fromEntries(Object.keys(o).map((k) => [k, "***"]));
  return Object.fromEntries(Object.entries(configured).map(([name, spec]) => {
    const s = spec as Record<string, unknown> & { env?: Record<string, string>; headers?: Record<string, string> };
    return [name, {
      ...s,
      ...(s.env ? { env: hide(s.env) } : {}),
      ...(s.headers ? { headers: hide(s.headers) } : {}),
    }];
  }));
}

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const url = req.url ?? "";
  const body = await readBody(req);
  const ct = String(req.headers["content-type"] ?? "");
  // Redacted: a request URL can carry `?token=` / `?password=`, and this line is on by default
  // for anyone debugging with GROKBOT2_LOG — the exact audience most likely to paste a log.
  if (process.env.GROKBOT2_LOG) logSafe(`${req.method} ${url} (${ct.split(";")[0]})`);

  /*
   * ── auth ──
   *
   * Ba cửa, và cho tới hôm nay cả ba trả về cùng một thứ: một token, cho bất kỳ ai hỏi. Nay tách ra
   * vì chúng là ba việc khác nhau, và chỉ một trong ba được phép cấp token từ con số không.
   *
   *   /loginDeepControl  trang người dùng đăng nhập — trình duyệt mở, không phải app
   *   /auth/poll         app hỏi "xong chưa" — chỉ trả token SAU khi có người duyệt
   *   /oauth/token       app làm mới token cũ — phải có token cũ hợp lệ
   *
   * Thứ tự quan trọng: `/auth/poll` và `/loginDeepControl` phải đứng TRƯỚC cửa chung bên dưới, vì
   * cửa đó bắt cả `url.includes("/auth/")`.
   */
  // Giao diện web ở `/app/` — nơi `/loginDeepControl` đưa người dùng tới để đăng nhập.
  if (handleWebApp(url, res)) return;
  if (url.startsWith("/loginDeepControl")) return handleLoginPage(url, res);
  if (url.startsWith("/auth/poll")) return handleAuthPoll(url, res);
  if (url.startsWith("/auth/approve")) return handleAuthApprove(body, req.headers as Record<string, unknown>, res);
  if (url.startsWith("/oauth/token") || url.includes("/auth/") || url.endsWith("/token")) {
    return handleAuth(res, body);
  }
  // ── local exec daemon credential ──
  if (url.includes("local-exec-daemon-credential")) {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ token: "exec", authToken: "exec", url: `http://localhost:${config.port}/exec` }));
  }
  // ── telemetry sink ──
  //
  // The observe pass caught `POST /v1/traces` — the app's OpenTelemetry exporter, which is also
  // what the `traceparent` header in the client's constant table is for. It is fire-and-forget:
  // a 404 makes the exporter retry and fill the log with failures over something we do not want
  // anyway. Accept and discard, which is exactly what a sink that stores nothing should do.
  //
  // Deliberately BEFORE the strict-404 fallback, so turning strict mode on cannot start breaking
  // telemetry. Deliberately not forwarded anywhere: traces would leave this machine otherwise.
  if (url.startsWith("/v1/traces") || url.startsWith("/v1/metrics") || url.startsWith("/v1/logs")) {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end("{}");
  }

  // ── where a social connect flow lands ──
  //
  // The vendor decides this unless told otherwise, and it decides on its own dashboard: authorizing
  // TikTok from inside the app dropped the person on zernio.com/dashboard/connections, which reads
  // like the flow leaked somewhere. Nothing is exchanged here — the account now lives in the
  // connector's own store and the pane picks it up on its next poll — so this page only has to say
  // so and get out of the way. Nothing from the query string is echoed into it.
  if (url === CONNECT_DONE_PATH || url.startsWith(`${CONNECT_DONE_PATH}?`)) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    return res.end(`<!doctype html><meta charset="utf-8"><title>Đã kết nối</title>
<style>body{font:16px/1.6 system-ui,sans-serif;max-width:32rem;margin:20vh auto;padding:0 1.5rem;color:#111}
h1{font-size:1.35rem;margin:0 0 .5rem}p{color:#555;margin:.35rem 0}</style>
<h1>Đã kết nối xong</h1>
<p>Bạn có thể đóng tab này và quay lại Grok Bot.</p>
<p>Dòng tài khoản trong Plugins sẽ chuyển sang <strong>Connected</strong> trong vài giây.</p>`);
  }

  // ── bare /health ──
  //
  // Not in the extracted contract, which is gateway-relative — but the observe pass caught
  // something asking for `/health` at the ROOT, where it fell into the fallback and got `200 {}`.
  // Answering the same body as `/gw/health` costs one line and is strictly better than an empty
  // object; who the caller is remains open (see docs/history/execution-roadmap.md §6 P2-6).
  if (url === "/health" || url.startsWith("/health?")) {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify(hostHealth()));
  }

  // ── trang tải + bộ cài (site.ts) — công khai, trước mọi cổng xác thực ──
  //
  // Đứng trước /admin và /gw vì nó là cửa cho người CHƯA có gì trong tay: chưa token, chưa app.
  if (await handleSite(url, req, res)) return;

  // ── /admin — bảng theo dõi sức chứa box (admin.ts) ──
  //
  // Trước router /gw vì nó không phải một lệnh gateway, và nó tự gọi `checkAuth`. Ở tiến trình
  // ops thì sai chỗ: :8791 là cửa công khai cho webhook.
  if (await handleAdmin(url, req, res)) return;

  // ── ops internal (loopback — this server binds 127.0.0.1, not via /gw) ──
  if (url.startsWith("/internal/ops/")) {
    const json = (value: unknown, code = 200) => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify(value));
    };
    try {
      const bodyJ = body.length ? JSON.parse(body.toString("utf8")) as Record<string, unknown> : {};
      const nowOf = () => {
        if (bodyJ.now == null) return new Date();
        const d = new Date(bodyJ.now as string | number);
        if (Number.isNaN(d.getTime())) throw new Error("bad now");
        return d;
      };
      if (url.startsWith("/internal/ops/routines") && (req.method === "GET" || req.method === "POST")) {
        return json({ routines: routinesForOps() });
      }
      if (url.startsWith("/internal/ops/due") && req.method === "POST") {
        return json({ ids: dueIds(nowOf()) });
      }
      if (url.startsWith("/internal/ops/tick") && req.method === "POST") {
        tick(nowOf());
        return json({ ok: true });
      }
      if (url.startsWith("/internal/ops/fire-listeners") && req.method === "POST") {
        const ev = bodyJ.event && typeof bodyJ.event === "object"
          ? { platform: String(bodyJ.platform ?? ""), ...(bodyJ.event as Record<string, unknown>) }
          : undefined;
        const n = fireListeners(String(bodyJ.platform ?? ""), String(bodyJ.context ?? ""), ev);
        return json({ ok: true, fired: n });
      }
      /*
       * Chẩn đoán "máy của người dùng" — chạy một việc qua local-exec và trả nguyên kết quả.
       *
       * Cần một cửa ở TRONG tiến trình này vì hàng đợi `local-exec` nằm ở bộ nhớ của nó: long-poll
       * do daemon giữ là với server đang chạy, nên một script tsx riêng import `local-exec.ts` chỉ
       * dựng một hàng đợi thứ hai, rỗng, không ai nghe.
       *
       * Chỉ loopback (server này bind 127.0.0.1), và KHÔNG tự xin quyền — nó gửi thẳng, nên chỉ
       * dùng để trả lời câu "máy có nối và có chạy được không". Đường cho model đi qua tool, và
       * tool mới là chỗ dựng thẻ xin quyền.
       */
      if (url.startsWith("/internal/ops/local-exec") && req.method === "POST") {
        const kind = String(bodyJ.kind ?? "shell");
        if (kind !== "shell" && kind !== "read" && kind !== "ls") return json({ error: "kind phải là shell|read|ls" }, 400);
        if (!userComputerConnected()) return json({ ok: false, error: "máy của người dùng không nối (app Grok Bot chưa mở?)" }, 409);
        const op = kind === "shell" ? { kind: "shell" as const, command: String(bodyJ.command ?? "") }
          : kind === "read" ? { kind: "read" as const, path: String(bodyJ.path ?? "") }
          : { kind: "ls" as const, path: String(bodyJ.path ?? "") };
        /*
         * `may` — chạy trên MÁY NÀO, khi có nhiều máy nối cùng lúc.
         *
         * Không có tham số này thì cửa chẩn đoán luôn rơi vào máy thấy gần nhất, và nhánh định
         * tuyến đa máy (`findMachine` → `queueRequest(machineId)`) chỉ đo được bằng một lượt model
         * thật. Nhận cả id lẫn tên hiển thị, đúng như `local_shell` nhận, vì người gõ tên còn
         * model có thể gõ id.
         */
        const ten = String(bodyJ.may ?? bodyJ.machine ?? bodyJ.machineId ?? "").trim();
        const may = ten ? findMachine(ten) : null;
        if (ten && !may) {
          const co = connectedMachines().map((m) => m.label);
          return json({ ok: false, error: `không có máy nào tên "${ten}". Đang nối: ${co.join(", ") || "(không máy nào)"}` }, 404);
        }
        const r = await runOnUserComputer(op, {
          timeoutMs: Number(bodyJ.timeoutMs) || 30_000,
          ...(may ? { machineId: may.computerId } : {}),
        });
        return json(may ? { ...r, may: may.label } : r, r.ok ? 200 : 502);
      }
      /*
       * Chẩn đoán trình duyệt trên máy người dùng — cùng lý do với cửa `/internal/ops/local-exec`
       * ngay trên: hàng đợi local-exec nằm trong BỘ NHỚ TIẾN TRÌNH NÀY, nên một script tsx rời có
       * import `local-browser.ts` cũng chỉ nói chuyện với một hàng đợi rỗng của chính nó. Tôi đã
       * quên đúng điều mình viết ở trên và mất một vòng chẩn đoán nhầm sang "lệnh quá dài".
       */
      if (url.startsWith("/internal/ops/local-browser") && req.method === "POST") {
        const viec = String(bodyJ.viec ?? "");
        if (!["mo", "doc", "bam", "go", "anh"].includes(viec)) {
          return json({ error: "viec phải là mo|doc|bam|go|anh" }, 400);
        }
        const r = await lamTrenTrinhDuyet(bodyJ as never, {
          timeoutMs: Number(bodyJ.timeoutMs) || 120_000,
          ...(bodyJ.may ? { machineId: String(bodyJ.may) } : {}),
        });
        // Ảnh base64 dài hàng trăm KB — cắt trong bản chẩn đoán, giữ độ dài để còn biết có ảnh.
        const goi = r.anhBase64 ? { ...r, anhBase64: `(${r.anhBase64.length} ký tự base64)` } : r;
        return json(goi, r.ok ? 200 : 502);
      }
      // Webhook của routine. Ops nhận POST công khai rồi chuyển vào đây, vì KHOÁ nằm ở BFF (sqlite)
      // và ops không được đụng sqlite (ADR-P4-2). Đặt TRƯỚC `/internal/ops/fire` vì nhánh kia dùng
      // `startsWith` nên nó nuốt luôn mọi đường bắt đầu bằng "fire".
      if (url.startsWith("/internal/ops/fire-webhook") && req.method === "POST") {
        const ket = fireByWebhook(
          String(bodyJ.automationId ?? ""),
          String(bodyJ.key ?? ""),
          typeof bodyJ.context === "string" ? bodyJ.context : undefined,
        );
        const ma = ket === "ok" ? 200 : ket === "sai-khoa" ? 401 : ket === "dang-tat" ? 409 : 404;
        return json({ ok: ket === "ok", reason: ket }, ma);
      }
      if (url.startsWith("/internal/ops/fire") && req.method === "POST") {
        const trigger = bodyJ.trigger === "event" || bodyJ.trigger === "manual" ? bodyJ.trigger : "schedule";
        const ok = fireById(String(bodyJ.automationId ?? ""), trigger, typeof bodyJ.context === "string" ? bodyJ.context : undefined);
        return json({ ok }, ok ? 200 : 404);
      }
      return json({ error: "not found" }, 404);
    } catch (e) {
      res.writeHead(400, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: e instanceof Error ? e.message : "bad json" }));
    }
  }

  // ── native API (S13; OpenAPI docs/api/grokbot2-v0.yaml) — beside /gw, not through it ──
  // Native /v1 (grokbot-web) — scope to the caller's owner from a VERIFIED user JWT (Phase 4),
  // default identity when absent/unsigned (the desktop, or the gateway-ticket session token).
  // Cookie được xét ở đây, không chỉ header: FE của cinAPI gửi danh tính bằng cookie httpOnly
  // `cinapi_at` (docs/plan/cinapi-merge.md P1). `/gw` bên dưới vẫn chỉ đọc header — đường đó là
  // ticket của desktop, không có phiên trình duyệt nào để nhầm.
  const nativeOwner = ownerFromRequest(req.headers);
  if (await runWithOwner(nativeOwner, () => handleNative(url, body, res, req.headers, req.method ?? "?"))) return;

  // ── box gateway (JSON + SSE + chat) ──
  // Multi-tenant Phase 2: scope every /gw command to the caller's owner (from the token, default
  // identity when absent). Domain code reads currentOwner(); this is the one place it is set.
  const gwOwner = ownerFromAuth(req.headers.authorization);
  if (runWithOwner(gwOwner, () => handleGateway(url, body, res, req.headers as Record<string, unknown>, req.method ?? "?"))) return;

  // ── ConnectRPC bootstrap (protobuf) ──
  //
  // Framing and payloads are the ACL's business; this shell only carries bytes. The content type
  // is passed through because it decides the framing — a `connect+` stream has to be answered as
  // one, and the response echoes the request's own type.
  /*
   * Danh tính của lượt gọi — **kiểm chữ ký**, không chỉ giải mã.
   *
   * Bản trước dùng `userFromToken`, mà hàm đó chỉ base64-decode phần payload: ai gửi lên một JWT bịa
   * với chữ ký rác cũng được nhận là người mà họ tự khai. Đo trên máy thật 27/08:
   *
   *     verifyJwt("...chu-ky-rac")     → từ chối
   *     userFromToken("...chu-ky-rac") → google-oauth2|user_TU_BIA
   *
   * Và `rpcUser` đi thẳng vào `accessVerdict` → `ensureUser`, tức **tạo hẳn một dòng người dùng** cho
   * danh tính bịa đó. Trên VPS đã có một dòng như thế (`google-oauth2|user_01M04…`, không mật khẩu),
   * sinh ra lúc 22:44 ngày 26/08 — trong khi backend chưa từng chạy ngoài `enforce`.
   *
   * `ownerFromAuth` ngay dưới đây đã kiểm chữ ký từ đầu, nên chỗ này chỉ là một cửa sau bị bỏ quên.
   * Dùng chung một nguồn danh tính: sai một chỗ thì hỏng cả hai, chứ không phải một chỗ siết một chỗ
   * mở.
   */
  const rpcUser = verifyJwt(req.headers.authorization) ?? DEFAULT_USER;
  const rpc = await runWithOwner(ownerFromAuth(req.headers.authorization), () => handleBootstrapRpc(url, ct, {
    user: rpcUser,
    /*
     * Vé cổng RIÊNG cho người này, đóng vào bản mô tả box.
     *
     * Trên đường bootstrap app CÓ gửi JWT (nên `rpcUser` ở trên mới có nghĩa), nhưng trên đường
     * `/gw` nó chỉ dội lại vé lấy từ bản mô tả. Đó là lý do hai tài khoản dùng chung dữ liệu:
     * vé dùng chung ⇒ `ownerFromAuth` trên `/gw` luôn ra danh tính mặc định. Phát vé theo người
     * ở đây là chỗ duy nhất sửa được, vì app chỉ trả lại đúng thứ ta đưa nó.
     */
    gatewayTicket: mintTicket(rpcUser.authId),
    access: accessVerdict(rpcUser),
    usage: currentPeriodUsage(rpcUser) ?? undefined,
    // Nhãn plan cho trang Usage & Billing (GetSandUsageStatus). Chỉ khi billing đang đo: lúc `off`
    // để absent, builder khi đó trả đúng stub lịch sử — byte không đổi.
    plan: billingMode() === "off" ? undefined : getUser(rpcUser.authId)?.plan,
    body,
    plugins: pluginsPortFor(ownerFromAuth(req.headers.authorization)),
    // Where a sign-in is kept, so the app's own OAuth flow has somewhere to write. Without this the
    // ten MCP OAuth RPCs answer empty and a completed sign-in stores nothing.
    oauth: (() => {
      const owner = ownerFromAuth(req.headers.authorization);
      const port = oauthPortFor(owner);
      return {
        ...port,
        // Finishing the flow is more than forgetting the verifier: the code still has to be
        // exchanged. Done in the background because the response carries no token — the client
        // learns it worked when user_has_access_token flips on its next status read.
        complete: (stateId: string, code: string) => {
          void completeAuthorization(stateId, code, owner);
          return { postAuthReturnUrl: "", accountKey: "default" };
        },
        /**
         * "Does this account have a working sign-in?" — which is not the same question as "is there
         * an OAuth token filed under this account key?".
         *
         * A platform reached through a connector has no token of its own; the connector's token is
         * what its calls use, and the sign-in that matters happened at Facebook. The pane asks here
         * and nowhere else, so answering strictly from the token store left a connected Facebook
         * account reading "Needs auth" beside a working connector. The answer for those accounts
         * comes from whether the platform is actually connected.
         */
        validate: (targets: { serverUrl: string; accountKey: string }[]) =>
          port.validate(targets).map((t) => {
            if (t.hasValidToken) return t;
            const name = Object.entries(mcpServersFor(owner))
              .find(([, spec]) => (spec as { url?: string }).url === t.serverUrl)?.[0];
            const connected = name
              ? socialAccounts(name, owner)?.find((a) => a.key === t.accountKey)?.hasToken
              : false;
            return connected ? { ...t, hasValidToken: true } : t;
          }),
      };
    })(),
    /**
     * Two kinds of sign-in answer the same button.
     *
     * With no account_key the client is asking about the CONNECTOR, and the answer is the server's
     * own OAuth. With one, it is asking about a single platform behind that connector, and the
     * answer is that platform's connect URL — the same button, pointed at Instagram instead of at
     * Zernio, decided by a field the client was already sending and we were already ignoring.
     */
    authUrlFor: (serverUrl: string, redirectUri: string, accountKey?: string) => {
      const owner = ownerFromAuth(req.headers.authorization);
      if (accountKey && accountKey !== "default") {
        const name = Object.entries(mcpServersFor(owner))
          .find(([, spec]) => (spec as { url?: string }).url === serverUrl)?.[0];
        if (name) return socialConnectUrl(name, accountKey, owner);
      }
      return authUrlFor(serverUrl, redirectUri, owner);
    },
    // The caller's own MCP servers, for GetAvailableMcpServers. Only name/command/args/url — never
    // `env`, which holds live tokens and must not reach the renderer.
    ...mcpPorts(ownerFromAuth(req.headers.authorization)),
    catalog: pluginCatalog(),
    // The microphone. Local, so the audio never leaves this machine — see stt.ts.
    ...(isSttAvailable() ? { transcribe } : {}),
  }));
  if (rpc) {
    res.writeHead(rpc.status, { "content-type": rpc.contentType });
    return res.end(rpc.body);
  }

  // Nothing matched: not auth, not the gateway, not a ConnectRPC method. Recorded for the same
  // reason as the gateway's own fallback — an endpoint the app needs and we have never heard of
  // is otherwise indistinguishable from one that legitimately answers nothing. Still `200 {}`
  // until GROKBOT2_STRICT_404=1.
  recordUnknown(req.method ?? "?", url, body);
  const nf = notFoundBody(req.method ?? "?", url);
  if (nf) {
    res.writeHead(404, { "content-type": "application/json" });
    return res.end(nf);
  }
  res.writeHead(200, { "content-type": "application/json" });
  res.end("{}");
});

// Flush state to disk on shutdown so an in-flight debounce isn't lost. Coverage too: the
// observe pass is worthless if the list it built dies with the process it was gathered in.
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => { saveNow(chatSnapshot); saveCoverageNow(); closeMcp(); closeStt(); closeTeach(); process.exit(0); });
}

/*
 * Chặng 4: BFF nghe địa chỉ cấu hình được, KHÔNG ghim cứng loopback nữa.
 *
 * Mặc định vẫn `127.0.0.1` nên không đổi hành vi cũ. Mở ra `0.0.0.0` mà đăng nhập chưa `enforce` là
 * mời cả mạng vào backend có dữ liệu — nên cảnh báo to, không im lặng cho qua.
 */
if (config.bindHost !== "127.0.0.1" && authMode() !== "enforce") {
  console.warn("[grokbot2] ⚠ MỞ RA MẠNG mà GROKBOT2_AUTH chưa 'enforce' — mọi máy gọi được backend có dữ liệu.");
  console.warn("[grokbot2]   Đặt GROKBOT2_AUTH=enforce trước khi mở, hoặc để GROKBOT2_BIND=127.0.0.1.");
}
server.listen(config.port, config.bindHost, () => {
  logSafe(`[grokbot2] BFF nghe trên ${config.bindHost}:${config.port}`);
  if (config.opsUrl) {
    logSafe(`[grokbot2] ops process ${config.opsUrl} owns scheduler + public webhooks (in-process cron off)`);
    void opsHealth().then((s) => logSafe(`[grokbot2] ops: ${s}`));
  } else {
    startScheduler();
  }
  // Mint the gateway ticket BEFORE anything can serve EnsureSandBox, so the descriptor and the
  // check are guaranteed to carry the same value.
  ensureGatewayToken();
  logSafe(`[grokbot2] [auth] mode=${authMode()} · token minted, harness copy at .data/gateway-token.txt`);
  // Every startup line goes through logSafe: these carry the pool URL, the box URL, the VNC URL
  // and the CDP endpoint, and any of them can hold a credential in its query string.
  logSafe(`[grokbot2] backend on http://localhost:${config.port}`);
  const persist = persistenceInfo();
  logSafe(`[grokbot2] persistence: sqlite ${persist.sqlite}${persist.imported ? " (state.json frozen)" : ""}`);
  void runtimeHealth().then((s) => logSafe(`[grokbot2] runtime: ${s}`));
  void computerHealth().then((s) => logSafe(`[grokbot2] computer: ${s}`));
  logSafe(`[grokbot2] brain: ${config.poolUrl} (model=${config.model})`);
  reportBoxConfig((msg) => logSafe(`[grokbot2] ${msg}`));
  reportMcpConfig((msg) => logSafe(`[grokbot2] ${msg}`));
  if (isBrowserConfigured()) {
    void browserProbe().then((s) => logSafe(`[grokbot2] [browser] ${process.env.GROKBOT2_BROWSER_CDP} — ${s}`));
  } else {
    console.log("[grokbot2] [browser] GROKBOT2_BROWSER_CDP not set — browser_* tools are off.");
  }
  // State the truth about the box at startup: a shell tool that is quietly absent is
  // indistinguishable from one that is broken.
  void boxHealth().then((s) => logSafe(`[grokbot2] [${s}`.replace("[box:", "[box]")));
  // P5-5: a model that will not speak the TOOL_CALL convention removes every tool the bot has, and
  // says so only by being unhelpful. Cached per model, so `tsx watch` does not re-buy the answer.
  void reportModelToolSupport((msg) => logSafe(`[grokbot2] ${msg}`));
  logSafe(`[grokbot2] native API http://localhost:${config.port}/v1/health  (FE: pnpm web)`);
  logSafe(`[grokbot2] launch the stock app with CURSOR_API_BASE_URL=http://localhost:${config.port}`);
});
