/**
 * S0 · the adapter that wires this process's services into `@grokbot2/cursor-acl`.
 *
 * There is no protocol knowledge left in this file: no command names, no SSE channels, no
 * route shapes. It only says which local function answers each port, so that when a service
 * moves out of process (ROADMAP Phase 4+) exactly one group below is re-pointed at an HTTP
 * client and the ACL does not change.
 */
import type { ServerResponse } from "node:http";
import { createCursorAcl, type AclPorts } from "@grokbot2/cursor-acl";
import {
  createAgent,
  listAgents,
  countAgents,
  updateAgent,
  deleteAgents,
  duplicateAgent,
  setAgentUnread,
  setAgentHiddenFromSidebar,
  setAgentNotificationsEnabled,
  setAgentNotifyOnUpdates,
  setAgentAvatarBytes,
  getAgentAvatar,
  getAgentNotificationAvatar,
  searchAgents,
  kickstartAgent,
  nextRosterOrdered,
  agentById,
  ownerOf,
  createGroup,
  setGroupMembers,
} from "./directory/index.js";
import { currentOwner, runWithOwner } from "./request-context.js";
import { catalog as pluginCatalog } from "./plugin-catalog.js";
import { installedIds, installPlugin, uninstallPlugin, setPluginVariables } from "./plugins.js";
import { setBoxSecrets, boxSecretsStatus } from "./box-secrets.js";
import {
  transcriptTail,
  reactToMessage,
  voteFeedback,
  promptAcceptanceStatus,
  getConversationOutline,
  latestEntry,
  nextTranscriptOrdered,
} from "./conversation/index.js";
import {
  sendPrompt,
  interruptAgentRun,
  resolveLocalToolPermission,
  apDungQuyenChamMay,
  resolveAutoReviewApproval,
  respondToWidget,
  submitSecret,
  dismissWidget,
  sendDraft,
  discardDraft,
  submitUserForm,
  dismissUserForm,
  broadcastToAgents,
  getSubagents,
  getAsyncTasks,
  isAgentRunning,
} from "./runtime/turn.js";
import { subscribe } from "./events.js";
import { taoNguoiNhac } from "./routine-nhac.js";
import { bindTeachHandoff } from "./chat/state.js";
import { hostSettings, patchHostSettings } from "./host-settings.js";
import {
  getAgentAutomationsForClient,
  getAgentAutomations,
  toClientAutomation,
  listAllAutomations,
  createAgentAutomation,
  updateAgentAutomation,
  deleteAgentAutomation,
  setAgentAutomationEnabled,
  runAgentAutomationNow,
  automationWebhookCredential,
} from "./automations.js";
import { foreverBoxStatus, handBackBox, beginComputerUse, endComputerUse } from "./forever-box.js";
import {
  readAttachmentImage, readAttachmentText, readAttachmentChunk, stageFile, stageImage, stagedCount,
} from "./attachments.js";
import { getAgentMemories, deleteAgentMemory, clearAgentMemories } from "./memory.js";
import { startTeach, stopTeach, recordingState } from "./teach.js";
import { startDesktopRecording, stopDesktopTeach, desktopRecordingState, desktopRecordConfigured } from "./desktop-record.js";
import { closeMcp, mcpServers, mcpServerStatus, getMcpTools, removeMcpServer, authenticateMcpServer } from "./mcp.js";
import { transcribe } from "./stt.js";
import {
  listBotTemplates, getBotTemplateForSourceAgent, createTemplateForAgent, getBotTemplateVersion, publishBotTemplate,
  setBotTemplateVisibility, deleteBotTemplate, createAgentFromTemplate, publicTemplateImport, bindTemplateSources, toWireView,
} from "./bot-templates.js";
import { DEFAULT_USER } from "./auth.js";
import { publicListings, publishListing, unpublishListing, listingsOf, creatorProfileOf, setCreatorProfile } from "./marketplace.js";
import { loadMemory, knowledgeBase } from "./memory.js";
import { disabledToolsOf, toggleToolDisabled, setCustomInstructions } from "./mcp-prefs.js";
import {
  recordUnknown, recordCall, recordRpc, recordSseOpen, recordSseClose,
  coverageSnapshot, calledMethods, lastArgsFor, notFoundBody, clearUnknown,
} from "./observe.js";
import { parkRequests, submitResponses, isChannelEnabled, channelSnapshot, connectedMachines } from "./channels.js";
import { mayChoBang, datTen, datQuyen } from "./may-da-biet.js";
import { veAvatar, taiAnh } from "./anh-cho-client.js";
import { tiemCookieVaoBox } from "./cookie-chrome.js";
import { checkAuth, noteAuth, authSnapshot } from "./auth-gate.js";
import { handleSlackEvent } from "./slack-events.js";
import { handleGitHubEvent } from "./github-events.js";
import { config } from "./config.js";
import {
  forAgent as workflowsForAgent, listAll as workflowsListAll, create as workflowCreate, wireSkill,
  update as workflowUpdate, remove as workflowRemove, setEnabled as workflowSetEnabled,
  runNow as workflowRunNow,
} from "./workflows.js";

/*
 * Nguồn 5 mục của mẫu bot (Instructions · Memories · Skills · Routines · Integrations) — tiêm vào
 * `bot-templates.ts` thay vì để nó import `automations.ts` (kéo theo `chat.js`) và `memory.ts` (box).
 * Dựng lại là best-effort: memory nằm trên box, không có box thì bot mới vẫn phải mọc ra.
 */
bindTemplateSources({
  skills: (agentId) => workflowsForAgent({ agentId }).map((w) => ({ name: w.name, description: w.description, content: w.instructions })),
  routines: (agentId) => getAgentAutomations({ id: agentId }).map((r) => ({
    slug: r.id, name: r.name, description: r.triggerDescription, content: r.prompt, trigger: r.trigger,
  })),
  memory: async (agentId) => (await loadMemory(agentId)).map((e) => ({
    kind: "log" as const,
    createdAt: new Date(e.createdAt).toISOString(),
    content: e.title && e.title !== e.content ? `${e.title}: ${e.content}` : e.content,
  })),
  plugins: (owner) => {
    const daCai = new Set(installedIds(owner));
    return pluginCatalog().filter((p) => daCai.has(p.id))
      .map((p) => ({ pluginId: String(p.id), name: p.displayName || p.name, description: p.description }));
  },
  restoreSkill: (agentId, s) => {
    workflowCreate({ agentId, name: s.name, description: s.description ?? "", instructions: s.content ?? "" });
  },
  restoreRoutine: (agentId, r) => {
    createAgentAutomation({ id: agentId, spec: { name: r.name ?? r.slug, prompt: r.content ?? "", trigger: r.trigger, isEnabled: true } });
  },
  restoreMemory: async (agentId, m) => {
    try {
      await knowledgeBase(agentId, { knowledge_to_store: m.content, action: "create" });
    } catch (e) {
      console.warn(`[grokbot2] mẫu bot: không ghi được memory cho ${agentId}:`, (e as Error).message);
    }
  },
});

/**
 * Bàn giao dạy việc (nút Stop của Teach a task có video): một tin ĐỨNG TÊN người dùng đúng câu hằng
 * + nonce `teach-recording:…` (client 0.43 vẽ kiểu teach-recording), phần video/nhật ký chỉ model đọc.
 * Xem `teach.ts` → `duongVideo`.
 */
bindTeachHandoff((agentId, h) => {
  sendPrompt({ agentId, content: h.content, clientNonce: h.clientNonce, richText: h.richText, modelNote: h.modelNote });
});

/** Người nhắc dùng chung cho cổng gateway: gom 1,5 s, chờ bot rảnh, gửi lời nhắc IM LẶNG (không có tin người dùng). */
const nguoiNhac = taoNguoiNhac({
  gui: (agentId, content) => { sendPrompt({ agentId, content, silent: true }); },
  dangChay: (agentId) => isAgentRunning(agentId),
});
/** Sau create/update: tìm lại record vừa đụng để nói đúng tên và lịch. */
function nhacRoutine(
  a: { id?: string; agentId?: string; automationId?: string; spec?: { name?: string } } | undefined,
  sau: ReturnType<typeof getAgentAutomations>,
  action: "created" | "updated",
): void {
  const rec = a?.automationId ? sau.find((x) => x.id === a.automationId) : (sau.find((x) => x.name === a?.spec?.name) ?? sau[sau.length - 1]);
  if (rec) nguoiNhac.ghi(rec.agentId, { action, name: rec.name, lich: rec.triggerDescription });
}

const ports: AclPorts = {
  currentOwner,
  runAsOwner: runWithOwner,
  identity: {
    getHostSettings: hostSettings,
    patchHostSettings,
    checkAuth,
    noteAuth,
    authSnapshot,
  },
  directory: {
    createAgent,
    createGroup,
    setGroupMembers,
    listAgents,
    countAgents,
    updateAgent,
    deleteAgents,
    duplicateAgent,
    setAgentUnread,
    setAgentHiddenFromSidebar,
    setAgentNotificationsEnabled,
    setAgentNotifyOnUpdates,
    setAgentAvatarBytes,
    getAgentAvatar,
  getAgentNotificationAvatar,
    searchAgents,
    kickstartAgent,
    agentById,
    ownerOf,
    nextRosterOrdered,
  },
  conversation: {
    transcriptTail,
    reactToMessage,
    voteFeedback,
    promptAcceptanceStatus,
    getConversationOutline,
    latestEntry,
    nextTranscriptOrdered,
  },
  runtime: {
    sendPrompt,
    interruptAgentRun,
    resolveLocalToolPermission,
    applyLocalToolPermissionSetting: apDungQuyenChamMay,
    resolveAutoReviewApproval,
    respondToWidget,
    submitSecret,
    dismissWidget,
    sendDraft,
    discardDraft,
    submitUserForm,
    dismissUserForm,
    broadcastToAgents,
    getSubagents,
    getAsyncTasks,
  },
  computer: {
    status: foreverBoxStatus,
    handBack: handBackBox,
    beginUse: beginComputerUse,
    endUse: endComputerUse,
    // Cây cầu phiên đăng nhập: client đọc cookie ở máy người dùng, ta tiêm vào trình duyệt box.
    injectCookies: (ds) => tiemCookieVaoBox(ds as never),
  },
  // Teach a task: record a demonstration in the box's browser, save it as a routine — see teach.ts.
  teach: {
    start: (agentId: string) => startTeach(agentId),
    stop: (agentId: string, save: boolean) => stopTeach(agentId, save),
    status: () => recordingState(),
  },
  /**
   * The same thing for what the browser cannot reach — see desktop-record.ts.
   *
   * Kept as its own surface rather than a flag on `teach`, because the two must never run together:
   * a person demonstrating in the box's Chrome produces an X11 event AND a DOM event for one click,
   * so both recorders running would write every step twice. When the work is inside a web page,
   * `teach` is the better tool and stays the default — a selector survives a window moving, a
   * coordinate does not.
   */
  desktopTeach: {
    available: () => desktopRecordConfigured(),
    start: (agentId: string) => startDesktopRecording(agentId),
    stop: (_agentId: string, save: boolean) => stopDesktopTeach(save),
    status: () => desktopRecordingState(),
  },
  media: {
    readAttachmentImage,
    readAttachmentText,
    readAttachmentChunk,
    stageImage,
    stageFile,
    stagedCount,
    transcribe,
    // Ba lệnh ảnh của hợp đồng 0.30 — xem `anh-cho-client.ts` để biết vì sao đúng ba lệnh này.
    generateImage: veAvatar,
    fetchImage: taiAnh,
  },
  memory: { getAgentMemories, deleteAgentMemory, clearAgentMemories },
  /*
   * Mẫu bot — nhóm 404 mềm lớn nhất còn lại của cổng box cho tới 28/08. Mẫu của một NHÓM chở theo
   * mô tả từng thành viên, nên dựng lại được cả đội chứ không phải một cái phòng rỗng.
   */
  botTemplates: {
    // Hình dạng dây 0.43 (`toWireView`): năm mục chi tiết ở đầu bảng, `activeVersion` vắng thay vì null.
    list: () => listBotTemplates(currentOwner()).map((t) => toWireView(t)),
    forSourceAgent: (id) => { const t = getBotTemplateForSourceAgent(id, currentOwner()); return t ? toWireView(t) : null; },
    getVersion: (shareId, version) => { const t = getBotTemplateVersion(shareId, version, currentOwner()); return t ? toWireView(t, version) : null; },
    publish: async (shareId, version) => { const t = await publishBotTemplate(shareId, version, currentOwner()); return t ? toWireView(t) : null; },
    setVisibility: (shareId, visibility) => { const t = setBotTemplateVisibility(shareId, visibility, currentOwner()); return t ? toWireView(t) : null; },
    remove: (shareId) => deleteBotTemplate(shareId, currentOwner()),
    createAgent: (a) => createAgentFromTemplate(a, currentOwner()),
    getPublic: (shareId) => publicTemplateImport(shareId),
  },
  /*
   * Marketplace bot — listing của mẫu công khai + hồ sơ người tạo (bước D). `featured` chỉ người vận
   * hành (danh tính mặc định của máy chủ) đặt được: đó là biên tập, không phải tự khai.
   */
  marketplace: {
    listPublic: (category) => { const r = publicListings(category); return { featuredListings: r.featured, listings: r.listings, nextPageToken: "" }; },
    publish: (a) => publishListing(a, currentOwner(), DEFAULT_USER.authId),
    unpublish: (shareId) => unpublishListing(shareId, currentOwner()),
    mine: () => listingsOf(currentOwner()),
    getCreatorProfile: () => creatorProfileOf(currentOwner()),
    setCreatorProfile: (patch) => setCreatorProfile(currentOwner(), patch),
  },
  /*
   * Skill của bot — menu `/` của khung soạn.
   *
   * `runNow` để nguyên `{}`: client không đọc gì từ phản hồi, và chạy một skill nghĩa là mở một
   * lượt chat mới với phần `instructions` — việc đó thuộc `turn.ts`, chưa nối ở bước này. Trả `{}`
   * là nói "nhận rồi", nên khi nối xong sẽ không phải đổi shape.
   */
  workflows: {
    // `SandSkill` 0.43: `body` + 10 khoá bắt buộc — lấp ở cửa dây, kho vẫn giữ bản ghi gọn.
    forAgent: (a) => workflowsForAgent(a).map(wireSkill),
    listAll: () => workflowsListAll().map(wireSkill),
    create: (a) => workflowCreate(a).map(wireSkill),
    update: (a) => workflowUpdate(a).map(wireSkill),
    remove: (a) => workflowRemove(a),
    setEnabled: (a) => workflowSetEnabled(a),
    runNow: (a) => workflowRunNow(a),
  },
  /*
   * Bảng Routine — thao tác của NGƯỜI DÙNG (cổng gateway) thì bot lên tiếng một câu, như app gốc (xem
   * `routine-nhac.ts`). Bot tự sửa routine bằng tool đi thẳng vào `automations.ts`, không qua đây.
   */
  automations: {
    forAgent: getAgentAutomationsForClient,
    forAgentClientShape: getAgentAutomationsForClient,
    listAll: listAllAutomations,
    toClientShape: toClientAutomation,
    create: (a) => { const r = createAgentAutomation(a); nhacRoutine(a, r, "created"); return r; },
    update: (a) => { const r = updateAgentAutomation(a); nhacRoutine(a, r, "updated"); return r; },
    remove: (a) => { const truoc = getAgentAutomations(a).find((x) => x.id === a?.automationId); const r = deleteAgentAutomation(a); if (truoc) nguoiNhac.ghi(truoc.agentId, { action: "deleted", name: truoc.name }); return r; },
    setEnabled: (a) => { const r = setAgentAutomationEnabled(a); const rec = r.find((x) => x.id === a?.automationId); if (rec) nguoiNhac.ghi(rec.agentId, { action: rec.isEnabled ? "enabled" : "disabled", name: rec.name, lich: rec.triggerDescription }); return r; },
    runNow: runAgentAutomationNow,
    webhookCredential: automationWebhookCredential,
  },
  connectors: {
    handleSlackEvent,
    handleGitHubEvent,
    get publicWebhooks() { return !config.opsUrl; },
    channelEnabled: isChannelEnabled,
    // The ACL holds the `ServerResponse` opaquely — it hands back the same object it was given.
    parkRequests: (name, res) => parkRequests(name, res as ServerResponse),
    // Bảng Settings → Computer đọc qua đây (bản vá `computer-tab` bẻ IPC `getSandMachines` sang).
    //
    // Trả cả máy ĐÃ TỪNG nối, không chỉ máy đang nối: bảng hỏi đúng một lần lúc app khởi động, và
    // lúc ấy daemon chưa kịp cắm. Định tuyến thì vẫn chỉ đọc máy đang nối — xem `may-da-biet.ts`.
    connectedMachines: () => mayChoBang(connectedMachines()),
    renameMachine: datTen,
    setMachinePermission: datQuyen,
    submitResponses,
    channelSnapshot,
  },
  secrets: { set: setBoxSecrets, status: boxSecretsStatus },
  extensions: {
    closeMcp, mcpServers, mcpServerStatus,
    /*
     * Dữ liệu THÔ cho hai lệnh 0.29 hỏi qua cổng — không dựng hình ở đây.
     *
     * Dựng hình cho client là việc của ACL, và `boundaries.test.ts` bắt đúng chỗ này: bản đầu tôi
     * gọi thẳng `listMarketplacePluginsJson` trong file này và test "no service module imports
     * protobuf" đỏ ngay. Nó đúng — tầng dịch vụ nói tiếng grokbot2, tiếng của client dừng ở ACL.
     */
    mcpCatalogEntries: () => pluginCatalog(),
    mcpInstalledIds: () => installedIds(currentOwner()),
    /*
     * Nửa GHI. Ba lệnh đầu đã có sẵn hàm trong `plugins.ts` — cái thiếu suốt là ĐƯỜNG từ cổng vào
     * chúng. Ba lệnh sau dùng kho tuỳ chọn theo người ở `mcp-prefs.ts`, và cả hai đều có tác dụng
     * thật: tool tắt bị cắt khỏi `get_mcp_tools` LẪN `call_mcp_tool`, lời dặn được ghép vào lời
     * nhắc hệ thống. Lưu một cờ mà không chỗ nào đọc thì nút vẫn chết như cũ.
     */
    mcpWrite: {
      install: (entryId, values) => installPlugin(entryId, currentOwner(), values),
      update: (pluginId, values) => { setPluginVariables(pluginId, values, currentOwner()); return true; },
      uninstall: (pluginId) => uninstallPlugin(pluginId, currentOwner()),
      listTools: async (serverId) => {
        const owner = currentOwner();
        const off = disabledToolsOf(serverId, owner);
        // Đọc qua `getMcpTools` để đi đúng đường khởi động/handshake server, rồi tách tên ra.
        const line = await getMcpTools(serverId, owner);
        const body = line.startsWith(`${serverId}: `) ? line.slice(serverId.length + 2) : "";
        const names = body.replace(/\s*\(đã tắt[^)]*\)\s*$/, "")
          .split(",").map((s) => s.trim()).filter((s) => s && !s.startsWith("("));
        return { serverId, tools: [...names, ...off].map((name) => ({ name, disabled: off.includes(name) })) };
      },
      toggleTool: (serverId, toolName) => toggleToolDisabled(serverId, toolName, currentOwner()),
      setInstructions: (serverId, instructions) => setCustomInstructions(serverId, instructions, currentOwner()),
      removeServer: (serverId) => removeMcpServer(serverId, currentOwner()),
      authenticate: (serverId, forceReauth) => authenticateMcpServer(serverId, { forceReauth }, currentOwner()),
    },
  },
  events: { subscribe },
  observe: {
    recordUnknown, recordCall, recordRpc, recordSseOpen, recordSseClose,
    coverageSnapshot, calledMethods, lastArgsFor, notFoundBody, clearUnknown,
  },
};

const acl = createCursorAcl(ports);

export const handleGateway = acl.handleGateway;
export const hostHealth = acl.hostHealth;
/** ConnectRPC including ListMarketplacePlugins; JSON vs proto is chosen in the ACL. */
export const handleBootstrapRpc = acl.handleBootstrapRpc;
