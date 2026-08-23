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
} from "./directory/index.js";
import { currentOwner, runWithOwner } from "./request-context.js";
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
import { closeMcp, mcpServers, mcpServerStatus } from "./mcp.js";
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
  media: {
    readAttachmentImage,
    readAttachmentText,
    readAttachmentChunk,
    stageImage,
    stageFile,
    stagedCount,
  },
  memory: { getAgentMemories, deleteAgentMemory, clearAgentMemories },
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
  extensions: { closeMcp, mcpServers, mcpServerStatus },
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
