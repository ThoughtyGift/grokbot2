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
} from "./conversation/index.js";
import {
  sendPrompt,
  interruptAgentRun,
  resolveLocalToolPermission,
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
} from "./runtime/turn.js";
import { subscribe } from "./events.js";
import { hostSettings, patchHostSettings } from "./host-settings.js";
import {
  getAgentAutomationsForClient,
  toClientAutomation,
  listAllAutomations,
  createAgentAutomation,
  updateAgentAutomation,
  deleteAgentAutomation,
  setAgentAutomationEnabled,
  runAgentAutomationNow,
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
  setBotTemplateVisibility, deleteBotTemplate, createAgentFromTemplate,
} from "./bot-templates.js";
import { disabledToolsOf, toggleToolDisabled, setCustomInstructions } from "./mcp-prefs.js";
import {
  recordUnknown, recordCall, recordRpc, recordSseOpen, recordSseClose,
  coverageSnapshot, calledMethods, lastArgsFor, notFoundBody, clearUnknown,
} from "./observe.js";
import { parkRequests, submitResponses, isChannelEnabled, channelSnapshot } from "./channels.js";
import { checkAuth, noteAuth, authSnapshot } from "./auth-gate.js";
import { handleSlackEvent } from "./slack-events.js";
import { handleGitHubEvent } from "./github-events.js";
import { config } from "./config.js";

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
  },
  runtime: {
    sendPrompt,
    interruptAgentRun,
    resolveLocalToolPermission,
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
  },
  memory: { getAgentMemories, deleteAgentMemory, clearAgentMemories },
  /*
   * Mẫu bot — nhóm 404 mềm lớn nhất còn lại của cổng box cho tới 28/08. Mẫu của một NHÓM chở theo
   * mô tả từng thành viên, nên dựng lại được cả đội chứ không phải một cái phòng rỗng.
   */
  botTemplates: {
    list: () => listBotTemplates(currentOwner()),
    forSourceAgent: (id) => getBotTemplateForSourceAgent(id, currentOwner()),
    getVersion: (shareId, version) => getBotTemplateVersion(shareId, version, currentOwner()),
    publish: (shareId, version) => publishBotTemplate(shareId, version, currentOwner()),
    setVisibility: (shareId, visibility) => setBotTemplateVisibility(shareId, visibility, currentOwner()),
    remove: (shareId) => deleteBotTemplate(shareId, currentOwner()),
    createAgent: (a) => createAgentFromTemplate(a, currentOwner()),
  },
  automations: {
    forAgent: getAgentAutomationsForClient,
    forAgentClientShape: getAgentAutomationsForClient,
    listAll: listAllAutomations,
    toClientShape: toClientAutomation,
    create: createAgentAutomation,
    update: updateAgentAutomation,
    remove: deleteAgentAutomation,
    setEnabled: setAgentAutomationEnabled,
    runNow: runAgentAutomationNow,
  },
  connectors: {
    handleSlackEvent,
    handleGitHubEvent,
    get publicWebhooks() { return !config.opsUrl; },
    channelEnabled: isChannelEnabled,
    // The ACL holds the `ServerResponse` opaquely — it hands back the same object it was given.
    parkRequests: (name, res) => parkRequests(name, res as ServerResponse),
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
