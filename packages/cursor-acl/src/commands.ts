/**
 * The command table: every `/gw/api/<name>` the stock client can send.
 *
 * This is the only file in the repo that knows the Cursor command vocabulary —
 * `getAgentTranscriptTail`, `ensureForeverBox`, `kickstartAgent` and the rest. Each entry
 * parses the client's argument spellings, calls one port, and shapes the reply the way the
 * renderer reads it. Nothing here holds domain state.
 *
 * Two rules the table follows throughout, both learned the hard way:
 *
 * - Answer the DECLARED shape (array / record / null) rather than falling through to `{}`. A
 *   bare `{}` is indistinguishable from a method that legitimately returns nothing, so the app
 *   cannot tell "not supported here" from "worked, nothing to report" — and neither can whoever
 *   debugs it next. Where we cannot do the thing, we answer `{ok: false, reason}`.
 * - Accept every key spelling the client is known to send. A method that looks handled because
 *   something similarly spelled is handled, and then silently does nothing, is the bug class
 *   parity.md records six times.
 */
import { listMarketplacePluginsJson, getEffectiveUserPluginsJson, type PluginEntry } from "@grokbot2/proto";
import type { AclPorts, Call } from "./ports.js";
import type { WireChannel } from "./sse.js";

/**
 * The nine shared-room commands, and the one honest answer to all of them.
 *
 * Exported so `parity-report` can say "120/120 answered, of which 9 are explicit refusals" instead
 * of letting the count read as though sharing works. A number that cannot tell a refusal from a
 * feature is the kind of metric this repo has already been burned by.
 */
/**
 * The teach-recording state the renderer expects back, matching its own idle constant.
 *
 * `maxDurationMs` is the client's ten minutes (`600 * 1e3` in the bundle); sending a different
 * number here would make the pane's countdown disagree with the limit it enforces itself.
 */
const TEACH_IDLE = { state: "idle", agentId: null, startedAtMs: null, maxDurationMs: 600_000 } as const;

export const SHARED_ROOM_COMMANDS = [
  "createRoomFromAgent", "createRoomInvite", "joinSharedRoom", "respondToRoomJoinRequest",
  "createSharedRoom", "addOwnAgentToSharedRoom", "removeOwnAgentFromSharedRoom",
  "setSharedRoomTyping", "leaveSharedRoom",
] as const;

const NO_RELAY = "Sharing needs a relay both installs can reach; this is a single local backend. Nothing was created.";
const NO_TEMPLATES = "Chưa bật mẫu bot trên máy chủ này.";

/**
 * The connector manifests, copied from the original's `src/shared/channels.ts`.
 *
 * Both entries really are `coming-soon` in the shipped app, with an empty `connectGuide` — so
 * the original cannot connect a channel either. This is not a stub standing in for something
 * richer; it is the whole feature as it ships today.
 */
const CONNECTOR_MANIFESTS = [
  { platform: "discord", displayName: "Discord", blurb: "Message in Discord servers and DMs (coming soon).", credentialLabel: "bot token", availability: "coming-soon", connectGuide: "" },
  { platform: "slack", displayName: "Slack", blurb: "Message in Slack channels and DMs (coming soon).", credentialLabel: "app token", availability: "coming-soon", connectGuide: "" },
] as const;

/**
 * Yours → Private. Empty, on purpose.
 *
 * This used to hold one fabricated row ("Local test skill", "Stub from grokbot2 so Yours → Private
 * has a row"). That was useful while checking the screen rendered at all; in a client someone uses
 * daily it is a lie on screen — a workflow that cannot be opened, run, or deleted.
 *
 * `[]` is both honest and contract-correct: the decl is `getAgentWorkflows:{args:"object",
 * reply:"array"}`, and the sibling `skillsCatalog` shows the client maps an empty array to "nothing"
 * itself (`C => C.length === 0 ? null : C`). Restore a row here only when a real workflow exists.
 */
const LOCAL_WORKFLOWS: unknown[] = [];

/** A "channels-view" is `{manifests, connections}` — the host's own shape. */
const channelsView = () => ({ manifests: CONNECTOR_MANIFESTS, connections: [] });

const idOf = (a: any): string =>
  typeof a?.id === "string" ? a.id : typeof a?.agentId === "string" ? a.agentId : "";

/**
 * `broadcast` is optional so tests and `parity-report` can enumerate the table without a hub.
 * Only commands that are themselves the sole writer of a value use it — see `createGatewayRouter`.
 */
/**
 * Lệnh mà hợp đồng 0.43 khai reply `{"type":"null"}` — 26 lệnh, đọc từ schema `RA` trong
 * `node-agent-coordinator` (`docs/extracted/gateway-schema-0.43.json`). Client không đọc gì ở reply
 * (0.30 khai `"void"`), nhưng coordinator 0.43 KIỂM: `{}` là "object", không phải null, và cả cú bấm
 * (đánh dấu chưa đọc, ẩn bot, chạy routine, gửi form…) ném `SandGatewayMalformedReplyError` dù việc
 * đã làm xong. Ép về `null` ở CỬA DÂY (`http.ts`), một chỗ, thay vì sửa 26 handler rải trên 8 module
 * — handler vẫn trả thứ nó muốn cho ai gọi thẳng (test, tool của bot).
 */
export const REPLY_NULL: ReadonlySet<string> = new Set([
  "cancelCookieOriginApproval", "clearTrays", "completeMcpOAuth", "deleteBotTemplate", "dismissTray", "dismissUserForm",
  "handBackForeverBox", "reactToMessage", "recordVoiceCall", "refreshMcp", "resolveAutoReviewApproval",
  "resolveLocalToolPermission", "resolveVirtualCardApproval", "runAgentAutomationNow", "runAgentWorkflowNow",
  "setAgentHiddenFromSidebar", "setAgentNotificationsEnabled", "setAgentNotifyOnUpdates", "setAgentUnread", "setAgentVoice",
  "setVoiceCallPresence", "setWindowFocused", "stopCloudAgent", "submitSecret", "submitUserForm", "voteFeedback",
]);

export function buildCommands(ports: AclPorts, broadcast?: (channel: WireChannel, payload: unknown) => void): Record<string, Call> {
  const { identity, directory, conversation, runtime, computer, media, memory, automations, extensions, botTemplates, workflows, marketplace } = ports;
  const push = (channel: WireChannel, payload: unknown) => { broadcast?.(channel, payload); };

  /**
   * Danh mục plugin, và cách bóc mảng ra khỏi hai hàm dựng hình đã có.
   *
   * Dùng LẠI đúng hai hàm mà đường proto của 0.20 dùng, thay vì dựng hình lần thứ hai: hai client
   * khác phiên bản phải thấy **cùng một** danh mục, và hai chỗ dựng là hai chỗ để lệch nhau. Hai
   * hàm đó trả chuỗi JSON `{plugins:[…]}` còn 0.29 muốn mảng trần, nên chỉ bóc một lớp.
   *
   * Trả `undefined` khi chỗ nhúng không có danh mục — hai hàm kia đã lấy danh mục dựng sẵn làm giá
   * trị mặc định, nên đưa `undefined` là đúng ý chúng, còn đưa `[]` là nói dối rằng danh mục rỗng.
   */
  const catalogEntries = (): PluginEntry[] | undefined =>
    extensions.mcpCatalogEntries?.() as PluginEntry[] | undefined;
  const pluginsArray = (json: string): unknown[] =>
    (JSON.parse(json) as { plugins?: unknown[] }).plugins ?? [];

  /**
   * The MCP server summary rows the client reads.
   *
   * Hoisted out of `listBoxMcpServers` because the `mcp-servers` SSE push needs the SAME rows:
   * the renderer's handler is `X => { for (const se of X.servers) d.set(se.serverIdentifier, se) }`,
   * so it keys the map on `serverIdentifier` and stores the whole object. Pushing bare names — as
   * this did until the renderer was actually read — gives every entry the key `undefined`.
   */
  /**
   * The four words the client actually knows — and why `disconnected` cost us a bug report.
   *
   * electron-main maps a row's status through one switch (`j7n` in `dist/electron-main/main.cjs`):
   * `connected`, `needsAuth`, `loading`, `error`. Everything else falls into its `default` branch,
   * which is not "unknown" — it is **`{status:"error", statusDetail:"Not reported by Grok Bot's
   * computer"}`**. So the pane drew a red Error beside memory, CinAI and toolbox while all three
   * were configured and fine, and it did it again after every restart, because a restart drops the
   * live children and `mcp.ts` goes back to saying `disconnected`. Read as "my plugins vanish every
   * time I open the app" — which is what it looks like, and nothing was ever lost.
   *
   * `mcp.ts` keeps its own vocabulary: `disconnected` is a true and useful thing to say inside this
   * backend. The translation belongs here, at the edge that speaks to the client.
   *
   * A stdio server we have not spawned yet is not broken and not loading — it is one tool call away
   * from running, so `connected` is the honest answer to "can this be used". The one exception is a
   * remote probe still in flight, which really is loading; `mcp.ts` marks it with that detail.
   */
  const wireStatus = (status: string, detail: string): string => {
    if (status === "connected" || status === "needsAuth" || status === "error") return status;
    if (status === "initializing" || /^Checking with/.test(detail)) return "loading";
    return "connected";
  };

  const mcpServerRows = (want: string[] = []) =>
    Object.entries(extensions.mcpServers()).flatMap(([name, spec], i) => {
      if (want.length && !want.includes(name)) return [];
      const sp = spec && typeof spec === "object" ? spec as Record<string, unknown> : {};
      const command = typeof sp.command === "string" ? sp.command : "";
      const url = typeof sp.url === "string" ? sp.url : undefined;
      // "http" now, not "sse": the backend speaks MCP Streamable HTTP to a url server directly,
      // so labelling it with the legacy two-endpoint transport would describe the wrong thing.
      const transport = typeof sp.type === "string" ? sp.type : url ? "http" : "stdio";
      return [{
        id: String(i + 1),
        name,
        serverIdentifier: name,
        accountKey: "default",
        rowServerIdentifier: name,
        transport,
        customInstructions: "",   // bắt buộc trong `SandMcpServerSummary` 0.43; lời dặn thật nằm trong host settings
        ...(command ? { command } : {}),
        ...(url ? { url } : {}),
        // Was a flat `disconnected` + "Runs on Grok Bot's computer" for every row: true about the
        // machine, wrong about the server, so a working server and a broken one looked identical.
        ...(() => {
          const st = extensions.mcpServerStatus?.(name);
          return st
            // `statusDetail` bỏ đi (05/09): hợp đồng 0.43 khai nó là object `{kind}`, còn chuỗi cũ thì
            // renderer 0.29 không đọc chỗ nào — giữ chuỗi là trượt schema mà không ai được lợi.
            ? { status: wireStatus(st.status, st.detail), toolCount: st.toolCount }
            : { status: "loading", toolCount: 0 };
        })(),
        isTeamServer: false,
      }];
    });

  /** In-memory notification trays (the FE lists/dismisses these). Pure client state. */
  const trays: { id: string; kind: string; title: string; timestampMs: number }[] = [];

  return {
    getHostSettings: () => identity.getHostSettings(),
    setHostSettings: (a) => {
      const next = identity.patchHostSettings(a);
      /**
       * `{fields: [...]}` — the names that changed, NOT the settings object.
       *
       * Read off the renderer, which does exactly this and nothing else with the frame:
       *   "host-settings": e => {
       *     e.fields.includes("pinnedAgentIds") && loadPinnedAgentsFromBox();
       *     e.fields.includes("sidebarSections") && loadFromBox();
       *   }
       * So the payload is a CHANGE NOTICE that triggers a refetch — sending the object gives
       * `e.fields === undefined` and `.includes` throws inside the handler.
       */
      const fields = a && typeof a === "object" ? Object.keys(a as Record<string, unknown>) : [];
      push("host-settings", { fields });
      return next;
    },
    /*
     * Hình dạng `SandHostStatus` của 0.43 — bốn khoá bắt buộc, `capabilities` là MẢNG tên. Bản cũ
     * (`capabilities:{}`, `version`, `state`) trượt schema reply của coordinator 0.43; 0.29 chỉ đọc
     * `isBusy` (dò máy rảnh trước khi tự cập nhật) nên đổi shape không đụng nó.
     *
     * Hai capability đầu là cửa "Share as template" của renderer 0.43:
     * `sEE(t) = exportPolicy !== "none" && isShareBotEnabled && hostCapabilities.includes("botTemplateJsonShareV1")`.
     */
    getHostStatus: () => ({
      hostVersion: null,
      latestHostVersion: null,
      hostUpdateAvailable: false,
      isBusy: false,
      capabilities: ["botTemplateJsonShareV1", "botTemplateVisibilityV1"],
    }),
    /** `SandBotTemplateExportPolicyReply`: "all" | "none" | "team_only" | null. Chưa có đội, nên mở hết. */
    getBotTemplateExportPolicy: () => ({ exportPolicy: "all" }),

    listAgents: () => directory.listAgents(),

    /*
     * Bảng Settings → Computer — máy của người dùng đang nối vào kênh local-exec.
     *
     * Client GỐC không hỏi lệnh này: bảng ấy đi qua tài khoản Cursor thật rồi gọi API của hãng
     * (`listSandMachines(getValidAccessToken, getTeamId)` trong main 0.29), nên với backend này nó
     * luôn trống. Bản vá `computer-tab` bẻ cầu IPC `getSandMachines` sang đây — xem
     * `infra/patches/computer-tab.mjs` để biết vì sao phải bẻ ở main chứ không ở renderer.
     *
     * Hình dạng phải khớp `fromProto` của chính client, không được đoán:
     *
     *     {machineId, label, isCurrent, localToolPermission?}
     *
     * `localToolPermission` chỉ gửi khi daemon có khai `standing`, vì client bỏ trường này khi
     * giá trị không hợp lệ (`zMe(...)` mới đưa vào) — gửi bừa một chuỗi lạ thì thà đừng gửi.
     *
     * `isCurrent` là máy MỚI THẤY NHẤT chứ không phải máy so theo id. Backend không biết
     * `getMachineId()` của client, còn daemon thật gửi `ping` đều nên máy đang chạy app luôn là
     * máy có `seenAtMs` mới nhất. Hai máy THẬT cùng nối thì dấu này thành tuỳ tiện — ghi ra đây
     * để lần sau khỏi phải phát hiện lại.
     */
    getSandMachines: (a) => {
      const ds = ports.connectors.connectedMachines?.() ?? [];
      /*
       * "Máy hiện tại" đến TỪ CLIENT, không phải do backend đoán.
       *
       * Bản vá gửi `currentMachineId` — chính `cn()` của main, cùng một id daemon khai trong
       * `hello`. Trước khi có nó tôi đoán bằng "máy mới thấy nhất", và đoán ấy sai đúng vào lúc
       * quan trọng nhất: app vừa mở thì daemon của máy này chưa cắm, nên máy mới thấy nhất lại là
       * một máy khác. Đo được ngày 30/08 — bảng gắn nhãn "Current computer" cho một máy ảo trong
       * khi máy thật đứng dưới.
       *
       * Vẫn giữ đường đoán làm dự phòng: client cũ (chưa vá lại) không gửi trường này, và một
       * bảng đoán sai một nhãn vẫn hơn một bảng không có nhãn nào.
       */
      const tuClient = String((a as { currentMachineId?: unknown } | undefined)?.currentMachineId ?? "").trim();
      let moiNhat = -1;
      for (const m of ds) if (m.seenAtMs > moiNhat) moiNhat = m.seenAtMs;
      return ds.map((m) => ({
        machineId: m.computerId,
        label: m.tenNguoiDat ?? m.label,
        isCurrent: tuClient ? m.computerId === tuClient : m.seenAtMs === moiNhat,
        ...(m.standing ? { localToolPermission: m.standing } : {}),
      }));
    },

    /**
     * Nút Save trong bảng — đặt lại tên một máy.
     *
     * Client chờ về ĐÚNG một bản ghi máy, không phải `{ok:true}`: nó khẳng định
     * `Zn(u.machineId===a)` rồi `r.ingest(d.map(f=>f.machineId===a?u:f))` — trả sai hình dạng là
     * bảng thay một hàng bằng `undefined`.
     *
     * Không biết máy đó thì NÉM, đừng lặng lẽ trả về bản ghi cũ: bản vá dịch lỗi thành một câu
     * trong giao diện, còn im lặng thành công thì người dùng bấm Save và tên không đổi, không lời
     * giải thích.
     */
    updateSandMachineLabel: (a) => {
      const id = String(a?.machineId ?? "").trim();
      const label = String(a?.label ?? "").trim();
      const m = id && label ? ports.connectors.renameMachine?.(id, label) : null;
      if (!m) throw new Error(`không đổi được tên máy ${id || "(thiếu id)"}`);
      return { machineId: m.computerId, label: m.tenNguoiDat ?? m.label, isCurrent: false, ...(m.standing ? { localToolPermission: m.standing } : {}) };
    },

    /**
     * Ô "Execution on this computer" — đổi mức quyền của một máy.
     *
     * Ghi lại LỰA CHỌN, không thi hành: daemon giữ mức quyền của chính nó và tự quyết định từ chối
     * hay không. Client đồng bộ tiếp xuống máy bằng đường riêng của nó (`setLocalToolPermission`
     * gọi `syncHostSettingsToBox` ngay sau lời gọi này), nên ta chỉ cần trả bản ghi đã cập nhật —
     * `a.localToolPermission??"ask"` là thứ nó đọc ngay dòng sau.
     */
    updateSandMachineLocalToolPermission: (a) => {
      const id = String(a?.machineId ?? "").trim();
      const quyen = String(a?.localToolPermission ?? a?.permission ?? "").trim();
      const m = id && quyen ? ports.connectors.setMachinePermission?.(id, quyen) : null;
      if (!m) throw new Error(`không đổi được mức quyền máy ${id || "(thiếu id)"}`);
      return { machineId: m.computerId, label: m.tenNguoiDat ?? m.label, isCurrent: false, ...(m.standing ? { localToolPermission: m.standing } : {}) };
    },
    countAgents: () => directory.countAgents(),
    // The client reads `result.agent.id`, so createAgent/duplicateAgent/openAgent must wrap the
    // record as `{agent, transcript}` (matches the box host: `return { agent: u, transcript: Gn() }`).
    // `transcript` là MẢNG entry (`SandCreateAgentResult` 0.43), không phải trang `{entries,hasMore}`.
    createAgent: (a) => ({ agent: directory.createAgent(a), transcript: [] }),
    updateAgent: (a) => directory.updateAgent(a),
    deleteAgents: (a) => directory.deleteAgents(a),
    // We only had `deleteAgents`. The client can send either; the singular one reuses the plural
    // path so the two can never drift.
    deleteAgent: (a) => directory.deleteAgents({ ids: [a?.id ?? a?.agentId].filter(Boolean) }),
    duplicateAgent: (a) => {
      const rec = directory.duplicateAgent(a);
      if (!rec) return null;
      const tail = conversation.transcriptTail({ id: rec.id }) as { entries?: unknown[] };
      return { agent: rec, transcript: tail.entries ?? [] };
    },
    setAgentUnread: (a) => directory.setAgentUnread(a),
    setAgentHiddenFromSidebar: (a) => directory.setAgentHiddenFromSidebar(a),
    setAgentNotificationsEnabled: (a) => directory.setAgentNotificationsEnabled(a),
    setAgentNotifyOnUpdates: (a) => directory.setAgentNotifyOnUpdates(a),
    setAgentAvatarBytes: (a) => directory.setAgentAvatarBytes(a),
    getAgentAvatar: (a) => directory.getAgentAvatar(a),

    /*
     * Ba lệnh ảnh còn thiếu — đo 31/08 bằng cách đối chiếu hợp đồng 0.30 với bảng này.
     *
     * 20 lệnh trong hợp đồng chưa có handler, nhưng 14 trong số đó nằm sau cờ tính năng TẮT ở
     * client (`grok_bot_multiplayer` cho 9 lệnh phòng chung, `sand_voice_call` cho 5 lệnh gọi
     * thoại) — làm chúng thì client cũng không gọi. Ba lệnh ảnh này thì khác: renderer nhắc tới
     * mỗi cái 3 lần và không cờ nào chắn.
     */

    /** Avatar cho thông báo hệ thống. Cùng nguồn với avatar thường — client chỉ hỏi ở ngữ cảnh khác. */
    /**
     * Chở phiên đăng nhập từ Chrome của người dùng sang trình duyệt của box.
     *
     * Hình dạng trả về đọc từ chỗ CLIENT dùng nó, không đoán:
     *
     *     let m = d === 0 ? undefined : await n.injectChromeCookies({cookies: a});
     *     let f = m?.injected ?? 0;
     *     let p = f > 0 ? m?.sites ?? 0 : NGt(a);
     *
     * Nên `{injected, sites}`, và trả 0 khi không làm được thay vì ném — `injected: 0` làm client
     * báo "empty" bằng lời của nó, còn một ngoại lệ ở đây thành lỗi đỏ không ai đọc nổi.
     *
     * Đây là lệnh cuối trong hợp đồng 0.30 mà client GỌI ĐƯỢC thật: 15 lệnh còn thiếu khác đều
     * nằm sau cờ tính năng client tự tắt.
     */
    injectChromeCookies: async (a) => {
      const ds = Array.isArray((a as { cookies?: unknown[] })?.cookies) ? (a as { cookies: unknown[] }).cookies : [];
      if (!ds.length || !computer.injectCookies) return { injected: 0, sites: 0 };
      return computer.injectCookies(ds).catch(() => ({ injected: 0, sites: 0 }));
    },

    getAgentNotificationAvatar: (a) => directory.getAgentNotificationAvatar(a),

    /**
     * Vẽ avatar từ một câu mô tả.
     *
     * Client chờ về ảnh, không phải một lời hứa — nên nếu không vẽ được thì trả chuỗi rỗng (đúng
     * hình dạng `getAgentAvatar` trả khi bot chưa có avatar) chứ không ném: chỗ gọi nó là nút
     * "tạo ảnh" trong màn hình sửa bot, và một ngoại lệ ở đây thành lỗi đỏ giữa form.
     */
    generateAgentAvatarImage: async (a) => {
      const moTa = String(a?.description ?? "").trim();
      if (!moTa || !ports.media?.generateImage) return { avatarDataUrl: "", avatarVersion: "" };
      const r = await ports.media.generateImage(moTa).catch(() => null);
      return { avatarDataUrl: r ?? "", avatarVersion: r ? String(Date.now()) : "" };
    },

    /**
     * Tải hộ logo của một plugin MCP.
     *
     * Đây là một PROXY, và lý do nó tồn tại nằm ở phía client: renderer không tải được ảnh từ
     * origin lạ (parity.md §2u — ảnh CDN hiện "Couldn't load image"), nên host tải hộ rồi trả
     * data URL. Cùng lý do với `attach_image` bên tool.
     *
     * Chỉ http/https và chỉ ảnh: một `url` đến từ catalog là dữ liệu ngoài, và một proxy nhận mọi
     * giao thức là một cửa để dò mạng nội bộ.
     */
    getMcpPluginLogo: async (a) => {
      const u = String(a?.url ?? "").trim();
      if (!u || !ports.media?.fetchImage) return { dataUrl: "" };
      const r = await ports.media.fetchImage(u).catch(() => null);
      return { dataUrl: r ?? "" };
    },

    // Opening a conversation is what marks it read — doing it here rather than making the client
    // send a second call matches what the sidebar already assumes. `openAgentWindowed` is the
    // detached-window variant: same payload, only the frame differs, and the frame is the app's
    // business.
    openAgent: (a) => {
      const rec = directory.agentById(idOf(a));
      if (!rec) return null;
      directory.setAgentUnread({ id: rec.id, isUnread: false });
      return { agent: rec, transcript: conversation.transcriptTail({ id: rec.id }) };
    },
    openAgentWindowed: (a) => {
      const rec = directory.agentById(idOf(a));
      return rec ? { agent: rec, transcript: conversation.transcriptTail({ id: rec.id }) } : null;
    },

    interruptAgentRun: (a) => runtime.interruptAgentRun(a),
    sendPrompt: (a) => runtime.sendPrompt(a),
    promptAcceptanceStatus: (a) => conversation.promptAcceptanceStatus(a),
    reactToMessage: (a) => conversation.reactToMessage(a),
    voteFeedback: () => conversation.voteFeedback(),
    getConversationOutline: (a) => conversation.getConversationOutline(a),
    resolveLocalToolPermission: (a) => runtime.resolveLocalToolPermission(a),
    resolveAutoReviewApproval: (a) => runtime.resolveAutoReviewApproval(a),
    respondToWidget: (a) => runtime.respondToWidget(a),
    submitSecret: (a) => runtime.submitSecret(a),
    dismissWidget: (a) => runtime.dismissWidget(a),
    // Bó hành động transcript của 0.29 gồm đúng mười một lệnh; bốn cái dưới đây từng thiếu, nên
    // router trả 404 mềm và nút trên thẻ bấm không ra gì. Hình dạng đối số trích từ bundle 0.29:
    //   sendDraft:v().args({entryId:C(),draft:LEr,agentId:C()})
    //   dismissUserForm:v().args({entryId:C(),mode:mn(...["dismissed","escalated"]),agentId:C(),platform:z(wpn)})
    sendDraft: (a) => runtime.sendDraft(a),
    discardDraft: (a) => runtime.discardDraft(a),
    submitUserForm: (a) => runtime.submitUserForm(a),
    dismissUserForm: (a) => runtime.dismissUserForm(a),

    // Every transcript reader the client can send. They differ only in name in the bundle; the
    // tail is the honest answer to all of them.
    getAgentTranscriptTail: (a) => conversation.transcriptTail(a),
    openAgentTail: (a) => conversation.transcriptTail(a),
    getAgentTranscript: (a) => conversation.transcriptTail(a),
    getAgentTranscriptPage: (a) => conversation.transcriptTail(a),
    getAgentThread: (a) => conversation.transcriptTail(a),
    getAgentTranscriptWindow: (a) => conversation.transcriptTail(a),
    // `getTranscript` takes NO body (contract: `takesBody: false`), unlike every sibling above.
    // It is the whole-transcript read for whichever agent is current, so with no argument the
    // only honest answer is the first agent's tail — and saying that out loud beats returning
    // `{}`, which the renderer maps over without a guard.
    getTranscript: () => conversation.transcriptTail({ id: directory.listAgents()[0]?.id ?? "" }),

    // `.mcp.json` is read fresh on every call by design, so a refresh is about dropping the live
    // child processes and letting the next tool call restart them against the new config.
    refreshMcp: () => {
      extensions.closeMcp();
      const rows = mcpServerRows();
      // Wire name `mcp-servers`; the coordinator remaps it to the family `mcp-servers-updated`,
      // which is the key the renderer's ingest map uses. Sending the family name is dropped
      // silently, same trap as `roster`.
      //
      // Rows, not names: the renderer does `for (const se of X.servers) d.set(se.serverIdentifier, se)`.
      push("mcp-servers", { servers: rows });
      return { ok: true, servers: rows.map((r) => r.serverIdentifier) };
    },

    // ── attachment upload ───────────────────────────────────────────────────────
    //
    // The client's field names are `filename` + `bytesBase64`, and it reads `path` back. Taken
    // from its own commit step in the bundle, which is unambiguous:
    //
    //   return (await e.uploadAttachment({ filename: I, bytesBase64: R.toString("base64") })).path
    //
    // We accepted `dataUrl`/`bytes`/`pngBase64` + `fileName` and answered `{ok, url}`, so a real
    // upload from the app matched NOTHING — that is the whole "Couldn't send your message" /
    // no-thumbnail report. Our own scripts passed because they spoke our invented dialect, which
    // is exactly how a contract bug survives a green suite; the old spellings stay accepted so
    // those scripts keep working.
    uploadAttachment: (a) => {
      const b64 = typeof a?.bytesBase64 === "string" ? a.bytesBase64
        : typeof a?.dataUrl === "string" ? a.dataUrl
        : typeof a?.bytes === "string" ? a.bytes
        : typeof a?.pngBase64 === "string" ? `data:image/png;base64,${a.pngBase64}`
        : "";
      const name = typeof a?.filename === "string" ? a.filename
        : typeof a?.fileName === "string" ? a.fileName
        : typeof a?.name === "string" ? a.name : "upload.png";
      if (!b64) return { ok: false, reason: "uploadAttachment needs bytesBase64 / dataUrl / bytes / pngBase64" };
      const dataUrl = b64.startsWith("data:") ? b64 : `data:image/png;base64,${b64}`;
      // Images go through stageImage (it measures the dimensions the renderer needs); anything
      // else — a PDF, a .txt, a .docx — falls back to stageFile so "Attach files" is not
      // images-only. The mime the client declared in the data URL is what stageFile keeps.
      const mime = typeof a?.mimeType === "string" ? a.mimeType : undefined;
      const url = media.stageImage(dataUrl, name) ?? media.stageFile(dataUrl, name, mime);
      // `path` is what the client keeps and later sends back in `attachments[]`; `url`/`fileName`
      // are kept for our own scripts. Same value — the staged virtual path.
      return url ? { ok: true, path: url, url, fileName: name } : { ok: false, reason: "empty or unreadable attachment bytes" };
    },

    // Answered, but answered NO. Writing the card needs a plain-text transcript writer; a
    // question widget is the wrong shape for a connector notice, and inventing an entry kind the
    // renderer has no branch for is its own mistake. It costs nothing to leave: both connectors
    // ship `availability: "coming-soon"` in the original, so there is no card to append until the
    // hermes bridge exists.
    appendConnectorCard: (a) => {
      const agentId = idOf(a);
      if (!agentId || !directory.agentById(agentId)) return { ok: false, reason: "unknown agent" };
      return { ok: false, reason: "connector cards need a transcript writer; connectors are coming-soon in the original too" };
    },

    getTrays: () => trays,
    dismissTray: (a) => { const i = trays.findIndex((t) => t.id === (a?.id ?? a?.trayId)); if (i >= 0) trays.splice(i, 1); return {}; },
    clearTrays: () => { trays.length = 0; return {}; },

    /*
     * `SandSkillCatalogEntry` 0.43 bắt buộc `install` · `publisher` · `source`. Skill của mình cài bằng nội
     * dung (`kind:"content"`), nguồn `managed` — "marketplace" là kho của hãng, ta không phân phối lại.
     */
    skillsCatalog: () => (workflows?.listAll() ?? []).map((w) => {
      const r = w as Record<string, unknown>;
      return {
        ...r,
        install: { kind: "content", name: String(r.name ?? r.id ?? ""), content: String(r.instructions ?? "") },
        publisher: "grokbot2",
        source: "managed",
      };
    }),
    syncPluginSkills: () => [],
    /**
     * The plugin-sync record. `{}` CRASHED the Plugins panel's "Yours" tab.
     *
     * The host persists `{fetchedAt, currentUserId, skills[], authBlocked[]}` (its own reader
     * defaults the last two to `[]`), and the overlay's Yours view reads `authBlocked.length`
     * directly — an empty object gave it `undefined`, so clicking Yours threw
     * `Cannot read properties of undefined (reading 'length')` and closed the panel. Reported by the
     * user, reproduced over CDP at view--8LkllMO.js `Ni` (the `sand-plugins__yours` section).
     *
     * There is nothing to sync here — skills are not published to a registry — so the honest answer
     * is a well-formed record with empty lists, not an empty object.
     */
    getPluginSyncStatus: () => ({ fetchedAt: Date.now(), skills: [], authBlocked: [] }),
    getListenerIntegrations: () => ({ integrations: [] }),   // `SandListenerIntegrationsView`: mảng bắt buộc, rỗng là chưa nối gì
    getTeachRecordingStatus: () => ports.teach?.status() ?? TEACH_IDLE,
    // Box-host summary rows. The overlay's Yours → Installed list is built from the *host's*
    // MCP settings, using this reply only to fill status/toolCount — so `.mcp.json` alone will
    // not create cards. `id` must be a positive integer string (`/^[1-9]\d*$/`). Never echo `env`.
    listBoxMcpServers: (a) => {
      const want = Array.isArray(a?.serverIdentifiers)
        ? (a.serverIdentifiers as unknown[]).filter((x): x is string => typeof x === "string")
        : [];
      return { servers: mcpServerRows(want) };
    },
    /*
     * Ba lệnh 0.29 đổi tên — đo trên client thật, không suy từ tài liệu.
     *
     * Bản 0.29 chạy trên backend này boot được, đăng nhập được, hiện đúng roster; nó gọi 30 lệnh và
     * **chỉ ba lệnh này** không có mapping. Cả ba là bề mặt plugin/MCP bị đổi tên:
     * `getEffectivePlugins` → `getEffectiveMcpPlugins`, và hai cái còn lại là mới.
     *
     * Hình dạng đọc từ chính bản dựng 0.29 (`{args:"none",reply:…}`):
     *   getMcpCatalog          → array
     *   getEffectiveMcpPlugins → array
     *   getMcpState            → record, và renderer dùng `q.servers.some(J => J.id === … &&
     *                            J.accountKey === …)`, tức đúng những hàng `listBoxMcpServers`
     *                            đã trả — nên nó dùng lại `mcpServerRows`, không dựng hình mới.
     */
    getMcpCatalog: () => pluginsArray(listMarketplacePluginsJson(catalogEntries())),
    /*
     * Hình dạng 0.43 `SandEffectivePlugin` là PHẲNG (`pluginId` · `name` · `displayName` · `installMode` ·
     * `isEnabled`); bản 0.29 đọc `{plugin, isEnabled}`. Coordinator 0.43 kiểm theo cấu trúc (bỏ qua khoá
     * thừa), nên gửi CẢ HAI trong một hàng — mỗi client đọc phần của mình.
     */
    getEffectiveMcpPlugins: () =>
      pluginsArray(getEffectiveUserPluginsJson(extensions.mcpInstalledIds?.(), catalogEntries())).map((row) => {
        const r = row as { plugin?: Record<string, unknown>; isEnabled?: boolean };
        const p = r.plugin ?? {};
        return {
          ...r,
          pluginId: String(p.id ?? ""),
          name: String(p.name ?? ""),
          displayName: String(p.displayName ?? p.name ?? ""),
          installMode: "user",
          isEnabled: r.isEnabled === true,
        };
      }),
    getMcpState: () => ({ servers: mcpServerRows([]) }),

    /*
     * ── Nửa GHI của MCP ────────────────────────────────────────────────────────────────────────
     *
     * Tới 28/08 mặt phẳng này chỉ có nửa đọc: pane Plugins vẽ ra được, nhưng Cài / Gỡ / Bật-tắt
     * tool / Lời dặn đều gọi vào những lệnh không tồn tại → router trả 404 mềm, bấm không ra gì và
     * không báo gì. Hình dạng đối số trích nguyên từ bundle 0.29:
     *
     *   installMcpEntry:v().args({entryId:C(),values:z(f2e),hasTeamConfiguredVariables:z(Se())})
     *   updateMcpPluginInstall:v().args({pluginId:C(),values:f2e})
     *   uninstallMcpPlugin:v().args({pluginId:C()})
     *   listMcpServerTools:v().args({serverId:C()})
     *   toggleMcpToolDisabled:v().args({serverId:C(),toolName:C()})
     *   setMcpCustomInstructions:v().args({serverId:C(),instructions:C()})
     *
     * Thiếu cổng `mcpWrite` thì trả `{ok:false}` — nói KHÔNG, chứ không giả vờ thành công.
     */
    /*
     * Hình dạng reply theo schema 0.43 (`gateway-schema-0.43.json`): `installMcpEntry` và `updateMcpPluginInstall`
     * trả `SandMcpState {servers}`, `uninstallMcpPlugin` trả `SandMcpRemoveResult {removed, state, reason?}`.
     * Tới 06/09 ba lệnh này trả `{ok}` — coordinator 0.43 coi là lệnh thất bại (không log, HTTP vẫn 200), nên
     * trên tab Plugins của 0.43 bấm Cài/Gỡ "không ra gì" dù MCP ĐÃ ghi. Giữ thêm `ok` cho bản 0.29 đọc; mode
     * structural bỏ qua khoá thừa. `servers` lấy từ cùng `mcpServerRows` với `listBoxMcpServers`/`getMcpState`.
     */
    installMcpEntry: (a) => {
      const w = extensions.mcpWrite;
      const id = Number((a as { entryId?: unknown })?.entryId);
      if (!w || !Number.isFinite(id)) return { ok: false, servers: mcpServerRows([]) };
      const values = ((a as { values?: unknown })?.values ?? {}) as Record<string, string>;
      const ok = w.install(id, values);
      return { ok, servers: mcpServerRows([]) };
    },
    updateMcpPluginInstall: (a) => {
      const w = extensions.mcpWrite;
      const id = Number((a as { pluginId?: unknown })?.pluginId);
      if (!w || !Number.isFinite(id)) return { ok: false, servers: mcpServerRows([]) };
      const values = ((a as { values?: unknown })?.values ?? {}) as Record<string, string>;
      const ok = w.update(id, values);
      return { ok, servers: mcpServerRows([]) };
    },
    uninstallMcpPlugin: (a) => {
      const w = extensions.mcpWrite;
      const id = Number((a as { pluginId?: unknown })?.pluginId);
      if (!w || !Number.isFinite(id)) return { ok: false, removed: false, reason: "still-present", state: { servers: mcpServerRows([]) } };
      const removed = w.uninstall(id);
      return { ok: removed, removed, ...(removed ? {} : { reason: "still-present" }), state: { servers: mcpServerRows([]) } };
    },
    listMcpServerTools: (a) => {
      const w = extensions.mcpWrite;
      const serverId = String((a as { serverId?: unknown })?.serverId ?? "");
      if (!w || !serverId) return Promise.resolve({ serverId, tools: [] });
      return w.listTools(serverId);
    },
    toggleMcpToolDisabled: (a) => {
      const w = extensions.mcpWrite;
      const serverId = String((a as { serverId?: unknown })?.serverId ?? "");
      const toolName = String((a as { toolName?: unknown })?.toolName ?? "");
      if (!w || !serverId || !toolName) return { serverId, toolName, disabled: false };
      return w.toggleTool(serverId, toolName);
    },
    setMcpCustomInstructions: (a) => {
      const w = extensions.mcpWrite;
      const serverId = String((a as { serverId?: unknown })?.serverId ?? "");
      if (!w || !serverId) return { serverId, instructions: "" };
      return w.setInstructions(serverId, String((a as { instructions?: unknown })?.instructions ?? ""));
    },
    removeMcpServer: (a) => {
      const w = extensions.mcpWrite;
      const serverId = String((a as { serverId?: unknown })?.serverId ?? "");
      if (!w || !serverId) return { ok: false, reason: "thiếu serverId" };
      return w.removeServer(serverId);
    },
    authenticateMcpServer: (a) => {
      const w = extensions.mcpWrite;
      const serverId = String((a as { serverId?: unknown })?.serverId ?? "");
      if (!w || !serverId) return { ok: false, serverId, reason: "thiếu serverId" };
      return w.authenticate(serverId, (a as { forceReauth?: unknown })?.forceReauth === true);
    },

    /*
     * `renameMcpAccount` / `removeMcpAccount` — TỪ CHỐI, vì backend này không có khái niệm "account".
     *
     * 0.29 cho một server nhiều tài khoản (`{serverId, accountKey, newAccountKey}`); ở đây mỗi
     * server có đúng một bộ thông tin đăng nhập. Trả `{ok:true}` cho một thao tác không tồn tại là
     * để người dùng tin rằng họ vừa đổi được thứ gì đó — cùng lý do `SHARED_ROOM_COMMANDS` chọn
     * nói KHÔNG. Có ngày thêm nhiều tài khoản thì hai lệnh này là chỗ để cắm vào.
     */
    renameMcpAccount: () => ({ ok: false, reason: "mỗi server ở đây chỉ có một bộ đăng nhập — chưa có nhiều tài khoản để đổi tên" }),
    removeMcpAccount: () => ({ ok: false, reason: "mỗi server ở đây chỉ có một bộ đăng nhập — dùng removeMcpServer nếu muốn bỏ hẳn server" }),
    // ── shared rooms: answered, and answered NO ──────────────────────────────
    //
    // All nine are declared in the renderer (`reply:"record"`, except `setSharedRoomTyping` which
    // is `"void"`), so the UI can call them. Leaving them out of this table meant the router's
    // fallthrough answered `{}` with HTTP 200 — the exact shape this file's own rule forbids,
    // because the client cannot tell "not supported here" from "worked, nothing to report".
    //
    // Faking success is worse than refusing: `createSharedRoom` returning an id creates a room
    // nobody can ever join, and the UI would then show a member list that never fills. Sharing
    // needs a relay both installs can reach; this is one local backend. `{ok:false, reason}` is a
    // plain object, so it satisfies the declared `record` reply while saying plainly that the
    // answer is no. ROADMAP F5 chose this over building a relay.
    ...Object.fromEntries(SHARED_ROOM_COMMANDS.map((name) => [
      name,
      () => (name === "setSharedRoomTyping" ? {} : { ok: false, reason: NO_RELAY }),
    ])),

    /*
     * Bí mật của hộp — đường chính thức để đưa mật khẩu/token cho bot.
     *
     * Hai dòng này từng là `() => ({})`. Client 0.20 có đủ giao diện phía desktop
     * (`listSecrets`/`revealSecret`/`upsertSecrets`) rồi đẩy sang hộp bằng `setBoxSecrets` — mà
     * nhánh đẩy ấy **rơi vào hư không**, nên người dùng chỉ còn cách dán mật khẩu vào chat, nơi nó
     * nằm lại trong bản ghi hội thoại mãi mãi.
     *
     * Đối số đọc từ bản dựng 0.29: `v().args({secrets: f2e})` với `f2e = vl(C())` — `vl` là
     * "record of", nên đây là bản đồ tên→chuỗi. `getBoxSecretsStatus` là `noArgs`.
     *
     * Trả về TÊN, không trả giá trị: pane chỉ cần biết "đã đặt chưa".
     */
    getBoxSecretsStatus: () => ports.secrets?.status() ?? { names: [], count: 0, path: "", boxConfigured: false },
    setBoxSecrets: async (a) => await ports.secrets?.set(a) ?? { names: [], count: 0, path: "", boxConfigured: false },
    setWindowFocused: () => ({}),

    // The app's own memory screen. Answering with the real entries beats an empty {}; the reply
    // shape is unverified (no renderer call site to read it from), so GROKBOT2_LOG will show what
    // actually comes in the first time the screen is opened.
    getAgentMemories: (a) => memory.getAgentMemories(a),
    deleteAgentMemory: (a) => memory.deleteAgentMemory(a),
    clearAgentMemories: (a) => memory.clearAgentMemories(a),

    // The desktop asks the box for attachment bytes once its own filesystem lookup misses. The
    // file chip's preview asks for text; the markdown/pdf/table previews ask for raw bytes
    // through chunked reads.
    /*
     * `transcribeAudio` — cái micro trong khung soạn tin, đi bằng CỔNG chứ không bằng proto.
     *
     * Backend này đã trả lời RPC proto `TranscribeAudio` từ lâu, nhưng client 0.29 hỏi qua cổng
     * box, và đường đó chưa có — nên nút mic quay xong, gửi đi, rồi im. Đúng kiểu 404 mềm.
     *
     * Hình dạng trích thẳng từ bundle 0.29, cả hai đầu:
     *   vào : transcribeAudio:v().args({audioBase64:ok("base64 audio that decodes to bytes"),
     *                                   mimeType:C(), language:z(C())})
     *   ra  : reply:"record", và renderer rút ĐÚNG một trường —
     *         `function hGt(t){const{text:e}=t;return{text:e}}`
     *
     * Nên câu trả lời luôn là một record có `text`. Kể cả khi hỏng: `{text:""}` đọc thành "không
     * nghe ra chữ nào" và người dùng gõ tay; ném lỗi ra thì cái nút chết mà không nói gì.
     */
    transcribeAudio: async (a) => {
      const arg = (a ?? {}) as { audioBase64?: unknown; mimeType?: unknown; language?: unknown };
      const b64 = typeof arg.audioBase64 === "string" ? arg.audioBase64 : "";
      if (!b64 || !media.transcribe) return { text: "", ms: 0 };
      try {
        const audio = Buffer.from(b64, "base64");
        if (!audio.length) return { text: "", ms: 0 };
        const language = typeof arg.language === "string" && arg.language ? arg.language : undefined;
        return await media.transcribe(audio, typeof arg.mimeType === "string" ? arg.mimeType : "", language);
      } catch {
        // Bộ phiên âm chưa cài, hoặc âm thanh hỏng. Cả hai đều là "không ra chữ", không phải lỗi cổng.
        return { text: "", ms: 0 };
      }
    },
    /*
     * ── Mẫu bot ────────────────────────────────────────────────────────────────────────────────
     *
     * Bảy lệnh, hình dạng trích nguyên từ bundle 0.29 (kiểu trả lời cũng của client khai):
     *
     *   listBotTemplates             noArgs                    → array
     *   getBotTemplateForSourceAgent {sourceAgentId}            → record-or-null
     *   getBotTemplateVersion        {shareId,version}          → record
     *   publishBotTemplate           {shareId,version}          → record
     *   setBotTemplateVisibility     {shareId,visibility}       → record
     *   deleteBotTemplate            {shareId}                  → void
     *   createAgentFromTemplate      {shareId,agentId,name,avatarShape,avatarColor,
     *                                 expectedActiveVersion}    → record
     *
     * Thiếu cổng `botTemplates` thì trả `{ok:false, reason}` — nói "chưa bật", chứ không phải để
     * người dùng bấm vào hư không như 404 mềm.
     */
    listBotTemplates: () => botTemplates?.list() ?? [],
    getBotTemplateForSourceAgent: (a) =>
      botTemplates?.forSourceAgent(String((a as { sourceAgentId?: unknown })?.sourceAgentId ?? "")) ?? null,
    getBotTemplateVersion: (a) => {
      const arg = (a ?? {}) as { shareId?: unknown; version?: unknown };
      return botTemplates?.getVersion(String(arg.shareId ?? ""), Number(arg.version) || 1) ?? null;
    },
    publishBotTemplate: async (a) => {
      const arg = (a ?? {}) as { shareId?: unknown; version?: unknown };
      if (!botTemplates) return { ok: false, reason: NO_TEMPLATES };
      return (await botTemplates.publish(String(arg.shareId ?? ""), Number(arg.version) || 1)) ?? { ok: false, reason: "không có mẫu nào mang shareId đó" };
    },
    /*
     * Cửa Import của Marketplace (0.43): `{shareId}` đã qua regex 21 ký tự ở host. Trả đúng
     * `BotTemplateImport` renderer kiểm, hoặc `null` khi mẫu không public/chưa xuất bản — cùng nghĩa
     * với host hãng trả `null` khi `GetGrokBotTemplateImportDetails` không có recipe.
     */
    getPublicBotTemplate: (a) => {
      if (!botTemplates) return null;
      return botTemplates.getPublic(String((a as { shareId?: unknown })?.shareId ?? ""));
    },
    setBotTemplateVisibility: (a) => {
      const arg = (a ?? {}) as { shareId?: unknown; visibility?: unknown };
      if (!botTemplates) return { ok: false, reason: NO_TEMPLATES };
      return botTemplates.setVisibility(String(arg.shareId ?? ""), String(arg.visibility ?? "team")) ?? { ok: false, reason: "không có mẫu nào mang shareId đó" };
    },
    deleteBotTemplate: (a) => {
      botTemplates?.remove(String((a as { shareId?: unknown })?.shareId ?? ""));
      return null;   // hợp đồng 0.43: reply `{"type":"null"}` — `{}` là "type null" sai ở coordinator
    },

    /*
     * ── Marketplace bot (bước D) ────────────────────────────────────────────────────────────────
     *
     * Client 0.43 KHÔNG gọi `listPublicBotMarketplace` qua gateway — nó đi RPC main-side
     * (`ListPublicGrokBotMarketplaceListings`); lệnh này cùng hình dạng để bài đo và FE riêng dùng.
     * Bốn lệnh sau là của TA: đăng/rút listing của mẫu MÌNH sở hữu, và hồ sơ người tạo.
     */
    listPublicBotMarketplace: (a) => marketplace?.listPublic(String((a as { category?: unknown })?.category ?? "") || undefined)
      ?? { featuredListings: [], listings: [], nextPageToken: "" },
    listMyBotListings: () => marketplace?.mine() ?? [],
    publishBotListing: (a) => {
      if (!marketplace) return { ok: false, reason: "Chưa bật Marketplace bot trên máy chủ này." };
      const arg = (a ?? {}) as { shareId?: unknown; category?: unknown; categories?: unknown; featured?: unknown };
      try {
        return marketplace.publish({ shareId: String(arg.shareId ?? ""), category: String(arg.category ?? ""), categories: arg.categories, featured: arg.featured });
      } catch (e) {
        return { ok: false, reason: e instanceof Error ? e.message : String(e) };
      }
    },
    unpublishBotListing: (a) => ({ ok: marketplace?.unpublish(String((a as { shareId?: unknown })?.shareId ?? "")) ?? false }),
    getCreatorProfile: () => marketplace?.getCreatorProfile() ?? null,
    setCreatorProfile: (a) => {
      if (!marketplace) return { ok: false, reason: "Chưa bật Marketplace bot trên máy chủ này." };
      const arg = (a ?? {}) as { name?: unknown; profilePhotoUrl?: unknown; handles?: unknown };
      return marketplace.setCreatorProfile({ name: arg.name, profilePhotoUrl: arg.profilePhotoUrl, handles: arg.handles });
    },
    createAgentFromTemplate: async (a) => {
      if (!botTemplates) return { ok: false, reason: NO_TEMPLATES };
      const arg = (a ?? {}) as {
        shareId?: unknown; agentId?: unknown; name?: unknown; avatarShape?: unknown; avatarColor?: unknown;
        expectedActiveVersion?: unknown; creatorContext?: unknown;
      };
      const ver = Number(arg.expectedActiveVersion);
      return (await botTemplates.createAgent({
        shareId: String(arg.shareId ?? ""),
        ...(typeof arg.agentId === "string" ? { agentId: arg.agentId } : {}),   // 0.43: id client đúc trước
        name: typeof arg.name === "string" ? arg.name : undefined,
        avatarShape: typeof arg.avatarShape === "string" ? arg.avatarShape : undefined,
        avatarColor: typeof arg.avatarColor === "string" ? arg.avatarColor : undefined,
        // Client 0.29 không gửi → không kiểm; 0.43 gửi bản nó đang xem → lệch là từ chối.
        ...(Number.isInteger(ver) && ver > 0 ? { expectedActiveVersion: ver } : {}),
        ...(arg.creatorContext != null ? { creatorContext: arg.creatorContext } : {}),
      })) ?? { ok: false, reason: "không có mẫu nào mang shareId đó, hoặc bản đang xem đã cũ" };
    },

    readAttachmentImage: (a) => media.readAttachmentImage(a),
    readAttachmentText: (a) => media.readAttachmentText(a),
    readAttachmentChunk: (a) => media.readAttachmentChunk(a),

    // `rooms` is mapped without a guard on every poll, so a bare {} throws in the store.
    getSharingState: () => ({ rooms: [] }),
    isGlobalSearchEnabled: () => false,
    isEgressTunnelAvailable: () => false,
    isAgentNetworkEnabled: () => false,

    searchAgents: (a) => directory.searchAgents(a),
    kickstartAgent: (a) => directory.kickstartAgent(a),
    broadcastToAgents: (a) => runtime.broadcastToAgents(a),
    // `{id: <parent agent id>}` — the client asks per parent, so dropping the argument here would
    // return one agent's subagents under every agent.
    getSubagents: (a) => runtime.getSubagents(a),
    getAsyncTasks: (a) => runtime.getAsyncTasks(a),

    searchMedia: () => [],
    // Yours → Private filters `source === "workflow"` (or a plugin published by this user).
    /*
     * Skill của bot — menu `/` của khung soạn đọc đúng đây.
     *
     * Không có cổng thì trả `LOCAL_WORKFLOWS` (rỗng) như trước: client map mảng rỗng thành "không
     * có gì", nên cài đặt không bật workflow vẫn chạy y hệt bản cũ.
     *
     * Shape phần tử ĐO từ chính client 31/08 — `name` và `description` lên màn hình, `title` và
     * `body` bị bỏ qua. Xem đầu `services/grokbot-backend/src/workflows.ts`.
     */
    getAgentWorkflows: (a) => workflows?.forAgent(a) ?? LOCAL_WORKFLOWS,
    createAgentWorkflow: (a) => workflows?.create(a) ?? LOCAL_WORKFLOWS,
    updateAgentWorkflow: (a) => workflows?.update(a) ?? LOCAL_WORKFLOWS,
    setAgentWorkflowEnabled: (a) => workflows?.setEnabled(a) ?? LOCAL_WORKFLOWS,
    deleteAgentWorkflow: (a) => workflows?.remove(a) ?? LOCAL_WORKFLOWS,
    runAgentWorkflowNow: (a) => workflows?.runNow(a) ?? ({}),
    importAgentWorkflowText: () => ({ ok: false, reason: "workflows not supported by this backend" }),
    importAgentWorkflowUrl: () => ({ ok: false, reason: "workflows not supported by this backend" }),
    // Skill trên đĩa CHẠY ở bản này (skills.ts quét và đưa vào prompt); thứ không có là đường
    // chuyển chúng vào kho của một bot qua lệnh này, vì không có kho đó.
    portAgentLocalSkills: () => ({ ok: false, reason: "bản này đọc skill thẳng từ đĩa box, không nhập vào kho riêng của bot" }),

    // Routines: every mutating call answers with the agent's FULL list, because the FE stores the
    // reply as the new list instead of re-fetching — a `() => []` stub therefore looked like
    // "created, then vanished". And every reply goes out in the CLIENT'S shape (trigger as an
    // object, not our cron string), the mutating ones included: the editor reads `trigger.type`
    // off what it stored, and sending the raw record is what crashed it on click.
    getAgentAutomations: (a) => automations.forAgentClientShape(a),
    // Tra thang, KHONG boc qua toClientShape: day la ban ghi {url,key} chu khong phai mot routine.
    // `null` -> {} de client thay mot doi tuong khong co `url`, va nem dung cho no doi.
    getAutomationWebhookCredential: (a) => automations.webhookCredential?.(a) ?? {},
    // `SandScheduledAutomation` 0.43: `{agentId, automation}` — không phải hàng phẳng.
    // Hàng phẳng giữ lại (bài đo `e2e-desktop`/`e2e-create-routine` đọc `name`/`id` trực tiếp); coordinator 0.43
    // kiểm theo cấu trúc nên hai khoá bắt buộc thêm vào là đủ, khoá thừa không bị bắt.
    listAllAutomations: () => automations.listAll().map((r) => {
      const hang = automations.toClientShape(r) as Record<string, unknown>;
      return { ...hang, agentId: (r as { agentId: string }).agentId, automation: hang };
    }),
    setAgentAutomationEnabled: (a) => automations.setEnabled(a).map(automations.toClientShape),
    createAgentAutomation: (a) => automations.create(a).map(automations.toClientShape),
    updateAgentAutomation: (a) => automations.update(a).map(automations.toClientShape),
    deleteAgentAutomation: (a) => automations.remove(a).map(automations.toClientShape),
    runAgentAutomationNow: (a) => automations.runNow(a),

    // The previous `{channels: []}` was an invented key, so our channels panel rendered empty
    // while the original's lists both platforms. Since nothing here is connectable, matching the
    // host exactly costs one constant.
    getAgentChannels: () => channelsView(),
    connectChannel: () => channelsView(),
    disconnectChannel: () => channelsView(),
    refreshChannel: () => channelsView(),
    getListenerConnectUrl: () => ({ url: "" }),
    /**
     * Xuất bản skill lên registry của đội.
     *
     * `skillsCatalog` của bản gốc KHÔNG đọc đĩa: nó nằm trong extension `managed-setup` và gọi lên
     * máy chủ hãng kèm access token + machine id, rồi `ensureManagedSkill` tải về khi cần. Cả họ
     * xuất bản, đồng bộ lẫn thu hồi đều nói chuyện với registry đó.
     *
     * Bản này không có registry, nên `[]` là câu trả lời ĐÚNG chứ không phải chỗ còn thiếu — và một
     * lời từ chối phải nói ra lý do, nếu không giao diện chỉ thấy thao tác thất bại mà không biết
     * vì sao. (Skill trên ĐĨA là chuyện khác và đã chạy: xem skills.ts, chúng vào prompt.)
     */
    // `SandSkillPublishTargets` 0.43: `teams` + `unavailableReason` bắt buộc. Chưa có đội nào để đăng lên.
    getSkillPublishTargets: () => ({ teams: [], unavailableReason: "Chưa có đội để đăng skill lên.", unavailableReasonKind: "team_required" }),
    publishSkill: () => ({ ok: false, reason: "bản này không nối với registry skill nào — skill dùng được là skill nằm trên đĩa box" }),
    resyncPublishedSkill: () => ({ ok: false }),
    unpublishSkill: () => ({ ok: false }),
    getCloudAgentInfo: () => null,
    requestDiskSaverAudit: () => null,
    /*
     * Nhóm — một hội thoại có nhiều bot cùng ngồi.
     *
     * Hai dòng này từng trả `null`, nghĩa là nút "New group" trong app **im lặng không làm gì**:
     * renderer đọc `Ge.agent.id` từ câu trả lời, và `null.agent` thì hội thoại mới không bao giờ
     * mở ra. Hình dạng đọc từ bản dựng 0.20: `createGroup` reply `record`, `setGroupMembers` reply
     * `record-or-null`, và roster vẽ nhóm bằng `n.isGroup` + `rows.find(...).memberIds`.
     *
     * `createGroup` bọc trong `{agent, transcript}` giống `createAgent` — cùng một renderer đọc cả hai
     * (`SandCreateAgentResult`). `setGroupMembers` thì KHÔNG bọc: hợp đồng 0.43 khai
     * `SandAgentSummary | null`, và renderer 0.43 đọc thẳng `Ne?.harness` trên kết quả. Bản trước bọc
     * `{agent}` "cho giống" — một phỏng đoán, không phải số đo.
     */
    createGroup: (a) => ({ agent: directory.createGroup(a), transcript: [] }),
    setGroupMembers: (a) => directory.setGroupMembers(a),

    // ── teach a task ────────────────────────────────────────────────────────────
    //
    // The reply IS the new state, not an acknowledgement. The renderer sets its optimistic
    // `{state:"recording", …}` before the call and then overwrites it with whatever comes back
    // (`h(M)`), so `{ok:false}` — the shape these three used to return — handed it a state object
    // with no `state` field at all. That is why pressing Start recording left the pane sitting on
    // its default placeholder, "Starting desktop", instead of either recording or refusing: the
    // state machine had been pushed into a value it has no branch for.
    //
    // `idle` is the honest answer. Nothing here records a screen, and claiming `recording` would
    // let somebody demonstrate a whole task into a recorder that does not exist — the pane would
    // count down ten minutes and produce nothing. A clear no is worth more than a convincing yes.
    // Its shape matches the client's own idle constant, `maxDurationMs` included.
    // ── the computer pane ───────────────────────────────────────────────────────
    //
    // All of these return the same decorated status the box host returns, because that status is
    // the only thing the viewer reads.
    getForeverBoxStatus: (a) => computer.status(a),
    /**
     * The client calls this when the user opens the computer pane, and it must report `running`
     * rather than the truth-as-of-now.
     *
     * Answering `off` leaves the pane on its fallback branch for ever — `emptyMessage ?? "Booting
     * up the computer"` with a spinner, and `emptyMessage` is a component prop we cannot reach
     * from a status reply. That is the hang this exists to fix: a person clicking "open the
     * computer" IS the session starting; only the passive poll should infer it from activity.
     *
     * But a session opened this way had nothing to close it — the release timer is armed by the
     * end of a TURN, and opening a pane is not a turn — so an idle bot the user glanced at kept
     * reporting `running` until its next turn finished. Arming the release here closes it with
     * machinery that already exists: any tool action cancels the timer and the end of a turn
     * re-arms it. Safe against the client's own repeat calls, since ensure fires on open, focus
     * and reconnect, not on a poll.
     */
    ensureForeverBox: async (a) => {
      const id = idOf(a);
      if (id) { await computer.beginUse(id); await computer.endUse(id); }
      return computer.status(a);
    },
    resetForeverBox: (a) => computer.status(a),
    updateForeverBox: (a) => computer.status(a),
    // Clears the handoff card AND resumes the turn that was waiting on the user.
    handBackForeverBox: (a) => computer.handBack(a),
    startTeachRecording: (a) => ports.teach?.start(idOf(a) ?? "") ?? TEACH_IDLE,
    stopTeachRecording: (a) => ports.teach?.stop(idOf(a) ?? "", a?.save !== false) ?? TEACH_IDLE,

    /**
     * Recording a demonstration on the box's DESKTOP — names of our own, deliberately.
     *
     * The three above are the client's; these are not, and borrowing `startTeachRecording` for a
     * different recorder would make one name mean two things depending on the box. The stock app's
     * single Teach button keeps its browser recorder; the desktop one is reached through the chat
     * tools, which is also where the person already is when they are watching the VNC pane.
     */
    getDesktopTeachStatus: () => ports.desktopTeach?.status() ?? TEACH_IDLE,
    startDesktopTeachRecording: (a) => ports.desktopTeach?.start(idOf(a) ?? "") ?? TEACH_IDLE,
    stopDesktopTeachRecording: (a) => ports.desktopTeach?.stop(idOf(a) ?? "", a?.save !== false) ?? TEACH_IDLE,

    // ── box lifecycle ──────────────────────────────────────────────────────────
    //
    // Commands the app can send about updating, snapshotting and recreating the box. This backend
    // does not own the box's lifecycle — `infra/vps/grok-box-up.sh` brings it up and the exec
    // daemon is reached over HTTP — so none of these can honestly *do* the thing.
    // `getBoxStoreStatus` is the one that reports something real, because it can.
    autoUpdateBoxNow: () => ({ ok: false, reason: "the box is provisioned outside this backend (infra/vps/grok-box-up.sh)" }),
    updateHostNow: () => ({ ok: false, reason: "this backend IS the host; update it by restarting it" }),
    snapshotBoxStoreNow: () => ({ ok: false, reason: "no box store to snapshot — state lives in .data/state.json, backed up on write" }),
    clearBoxStoreNow: () => ({ ok: false, reason: "refusing to clear: state.json holds the user's bots and transcripts" }),
    getBoxStoreStatus: () => ({
      ok: true,
      // Reported from where the data really is, so the panel is not lying by omission.
      agents: directory.countAgents(),
      attachments: media.stagedCount(),
      isMigrating: false,
      note: "state is local to this backend, not in a box store",
    }),
    setBoxMigrating: () => ({ ok: false, reason: "no box migration in this backend" }),
    prepareBoxForRecreate: () => ({ ok: false, reason: "the box is not recreated from here" }),
    resumeBoxAfterRecreate: () => ({ ok: false, reason: "the box is not recreated from here" }),

    // Both are multi-step flows with a browser leg. `completeMcpOAuth` would finish a flow this
    // backend never starts (stdio MCP servers need no OAuth), and `requestWebAuthnCeremony` would
    // have to ask for a signature nothing here wants — issuing one to see what happens would be a
    // prompt on the user's real security key.
    completeMcpOAuth: () => ({ ok: false, reason: "stdio MCP servers need no OAuth; no flow to complete" }),
    requestWebAuthnCeremony: () => ({ ok: false, reason: "nothing here initiates a WebAuthn ceremony" }),
  };
}
