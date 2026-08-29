/**
 * Chat facade — existing `from "./chat.js"` imports stay valid.
 *
 * Implementation:
 *   identity/     AUTH_ID
 *   directory/    roster
 *   conversation/ transcript
 *   runtime/      tools + turn loop
 *   chat/state    shared maps + persist
 */
export { AUTH_ID } from "./identity/index.js";
export type {
  TranscriptEvent,
  WidgetOption,
  Entry,
  AgentActivity,
  AgentRecord,
  Parked,
  ToolCtx,
  SendArgs,
  SubagentRow,
} from "./conversation/types.js";
export {
  chatSnapshot,
  persist,
  bindHostSettings,
  bindAutomationsSnapshot,
  bindAutomationCreate,
  bindAutomationRefine,
  bindAutomationCleanup,
  transcriptEpoch,
  automationsChanged,
  agentExists,
} from "./chat/state.js";
export {
  nextRosterOrdered,
  agentById,
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
} from "./directory/index.js";
export {
  nextTranscriptOrdered,
  latestEntry,
  transcriptTail,
  getConversationOutline,
  reactToMessage,
  voteFeedback,
  promptAcceptanceStatus,
  pushTranscriptEvent,
  pushListenerConnect,
  postAttachment,
  postFileAttachment,
} from "./conversation/index.js";
export { toolNames } from "./runtime/tools.js";
export {
  broadcastToAgents,
  startSubagentRun,
  finishSubagentRun,
  getSubagents,
  getAsyncTasks,
  isAgentRunning,
  interruptAgentRun,
  resolveLocalToolPermission,
  resolveAutoReviewApproval,
  respondToWidget,
  submitSecret,
  dismissWidget,
  messageAgent,
  sendPrompt,
  resetToolSteps,
  runToolForTest,
} from "./runtime/turn.js";
