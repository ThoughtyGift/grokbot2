/**
 * Turn loop, approvals, presence. Tool implementations live in tools.ts.
 */
import { completeTurn, completeTurnPlain } from "../brain.js";
import { type PoolMessage } from "@grokbot2/pool-client";
import { config, loadPoolKey } from "../config.js";
import { isBrowserConfigured } from "../browser.js";
import { closeAgentTab } from "../browser.js";
import { isAutoApproved, unquote } from "../tools.js";
import { parseToolCalls, planBatches, planShape, hasIncompleteToolCall } from "../tool-calls.js";
import { boxConfigured } from "../box-exec.js";
import { requestBoxHelp, setHandBackSink, setHandoffStartSink, setHandoffEndSink, setComputerReleaseSink, beginComputerUse, endComputerUse, type BoxHandoff } from "../forever-box.js";
import { compact, applyCompaction, needsCompaction, estimateTokens, historyTokens } from "../compaction.js";
import { billingMode, recordUsage, accessVerdict } from "../billing.js";
import { ownerOf } from "../directory/index.js";
import { DEFAULT_USER } from "../auth.js";
import { buildSystemPrompt } from "../prompt.js";
import { loadMemory, renderMemory } from "../memory.js";
import type { Entry, SendArgs, SubagentRow, ToolCtx } from "../conversation/types.js";
import {
  agents, transcripts, inflight, compaction, persist, park, unpark, pending,
  nextId, nextReqId, nextToolId, tail, authorOf, onUpdate, acceptance, hostSettingsRef, ownsAgent,
} from "../chat/state.js";
import { createAgent, listAgents, setPresence } from "../directory/index.js";
import {
  isToolEcho, textOf, setText, attachmentNameOf, attachmentLineOf, postAttachment, postWidget,
} from "../conversation/index.js";
import { stagedTextPreview } from "../attachments.js";
import {
  TOOLS, isKnownTool, isParallelSafe, toolProtocolFor, turnHooks, attachmentsOf, readImageAttachment,
} from "./tools.js";

export type { SendArgs, ToolCtx, Entry, SubagentRow } from "../conversation/types.js";

const NEWLINE = String.fromCharCode(10);


/**
 * Hand-back after a restart: the Promise the tool was awaiting died with the old process, so
 * continue the turn from the persisted history instead. With the turn still in flight
 * forever-box resolves the Promise directly and this never fires.
 */
setHandBackSink((agentId, outcome) => {
  const waiting = unpark("handoff", agentId);
  if (!waiting?.history) return;
  continueAfterTool(agentId, waiting.history, "request_box_help", waiting.arg ?? "", outcome);
});

/**
 * The inline "Computer" card in the transcript.
 *
 * The right-rail "Needs your attention" panel came for free from `getForeverBoxStatus`, but
 * the original ALSO puts a card in the conversation — the one reading
 * `Computer · Done / <instruction> / [Open computer]`. It is driven entirely by fields on a
 * `send-message` entry (client `Obn`):
 *
 *   entry.boxRequestId   — the trigger. No card without it, whatever else is set.
 *   entry.boxInstruction — shown once the handoff is over.
 *   entry.boxResolution  — handed_back → "Done" · replied → "Answered" · dismissed → "Skipped"
 *
 * While a handoff with the same `requestId` is still live, the client ignores those two and
 * renders the waiting state (Take over / I'm done / Skip) from the live record instead. So the
 * entry is written once, at the start, and only its resolution is patched afterwards.
 */
function postBoxHandoffCard(agentId: string, handoff: BoxHandoff): void {
  tail(agentId).push({
    id: nextId(), kind: "send-message", author: authorOf(agentId), timestampMs: Date.now(),
    message: { type: "text", content: "" },
    boxRequestId: handoff.requestId,
    boxInstruction: handoff.instruction,
  });
  onUpdate(agentId);
}

function settleBoxHandoffCard(agentId: string, resolution: "handed_back" | "replied" | "dismissed"): void {
  const t = transcripts.get(agentId) ?? [];
  for (let i = t.length - 1; i >= 0; i--) {
    const e = t[i];
    if (e.kind === "send-message" && e.boxRequestId != null && e.boxResolution == null) {
      e.boxResolution = resolution;
      onUpdate(agentId);
      return;
    }
  }
}

setHandoffStartSink(postBoxHandoffCard);
setHandoffEndSink(settleBoxHandoffCard);
// When a computer session is finally released, close the tab it was driving.
setComputerReleaseSink((agentId) => { void closeAgentTab(agentId); });


/** PascalCase names the client's activity table knows; anything else renders plain "Working". */
/**
 * Our tool names → the names the client's activity table knows.
 *
 * This is the ONLY tool feedback the original gives during a turn: it never renders a tool
 * card (see the tool-call note at the top of this file), it changes the line beside the
 * avatar. The client's `dse()` maps a name to a verb + icon:
 *
 *   WebSearch → "Searching the web"   Read/BoxRead   → "Reading file"
 *   WebFetch  → "Reading the web"     Shell/BoxShell → "Running commands"
 *   Task      → "Waiting on another agent"           (…with `detail` → "Drafting the file")
 *   Screenshot / Computer / request_box_help → "On its computer"
 *   SendToAgent → "Messaging <name>"  CallMcpTool → "Connecting to <service>"
 *   anything starting `browser_` → "Browsing the web"
 *   anything else → "Working"
 *
 * That last-but-one rule is why the browser tools are NOT listed here any more: they were
 * being rewritten to `WebFetch`, which reads "Reading the web" while the agent is clicking
 * around a page. Passing the real name through hits the `browser_` branch and says
 * "Browsing the web", which is what the original shows.
 */
const ACTIVITY_TOOL: Record<string, string> = {
  web_search: "WebSearch",
  web_fetch: "WebFetch",
  read_file_v2: "Read",
  list_dir_v2: "Read",
  glob_file_search: "Read",
  ripgrep_raw_search: "Read",
  run_terminal_command_v2: "Shell",
  task_v2: "Task",
  message_agent: "SendToAgent",
  create_agent: "CreateAgent",
  rename_agent: "UpdateAgent",
  attach_file: "Screenshot",
  attach_image: "Screenshot",
  generate_image: "Screenshot",
  call_mcp_tool: "CallMcpTool",
  get_mcp_tools: "GetMcpTools",
  knowledge_base: "ReactToMessage",
  // `Shell` + a non-empty `detail` is the client's "Drafting the file" state; the detail is
  // attached at the call site, where the path is known.
  edit_file_v2: "Shell",
  edit_file: "Shell",
  delete_file: "Shell",
};

/** The file a write-style tool is touching, for the "Drafting the file" activity detail. */
function activityDetail(name: string, arg: string): string | undefined {
  if (name !== "edit_file_v2" && name !== "edit_file" && name !== "delete_file") return undefined;
  try {
    const o = JSON.parse(arg);
    if (o && typeof o.path === "string") return o.path;
  } catch { /* positional form */ }
  return unquote(arg.split(",")[0] ?? "") || undefined;
}

/** Everything presence-related back to idle. Called on every exit path, including failures. */
const clearPresence = (agentId: string): void => {
  // A turn that stopped is not driving the computer any more, so its screen goes off — the
  // original shows an idle bot's pane as off. `endComputerUse` refuses while a handoff is still
  // on screen, because that card exists precisely to make the user look at it.
  endComputerUse(agentId);
  finishComputerUseRun(agentId);
  setPresence(agentId, { isRunning: false, isComposingMessage: false, isRetrying: false, currentActivity: null });
};

export function broadcastToAgents(a: { ids?: string[]; agentIds?: string[]; prompt?: string; content?: string; text?: string }) {
  const ids = a.ids ?? a.agentIds ?? listAgents().map((x) => x.id);
  const text = a.prompt ?? a.content ?? a.text ?? "";
  const sent: string[] = [];
  for (const id of ids) if (agents.has(id)) { sendPrompt({ agentId: id, content: text }); sent.push(id); }
  return { sent, count: sent.length };
}
/**
 * The subagent list behind `getSubagents({id}) → array`.
 *
 * Shape is the host's `listSubagents()` verbatim — it maps its registry to
 * `{subagentId, subagentType, title, status, startedAtMs}` and sorts by `startedAtMs`
 * ascending. Two details are worth stating because guessing either one produces a list that
 * renders but is wrong:
 *
 *  - `status` is `running | done | aborted | error`. **Not** "completed": that string is the
 *    *outcome*'s value, which the host maps to `"done"` on the way into the registry
 *    (`outcome.status === "completed" ? "done" : "error"`).
 *  - `subagentType` is a free string taken straight from the task's `subagent_type`, not an
 *    enum, so our own type names (browserUse / explore / shell) belong here as they are.
 *
 * The client also accepts a push: `ingestSubagentsEvent({parentAgentId, subagents})`.
 */

const subagentRuns = new Map<string, Map<string, SubagentRow>>();
let subagentSeq = 1;

/**
 * The computer session, as a `computerUse` subagent.
 *
 * That name is not decoration: the client filters the panes it draws with
 * `status === "running" && subagentType === "computerUse"` (`CTn`/`eht`), so a session under any
 * other type contributes no screen. One per bot at a time — a bot has one desktop, and opening a
 * second row would claim it has two.
 */
const COMPUTER_USE = "computerUse";
const computerRuns = new Map<string, string>();   // agentId → subagentId

function startComputerUseRun(agentId: string, tool: string): void {
  beginComputerUse(agentId);
  if (computerRuns.has(agentId)) return;
  const title = tool.startsWith("browser_") ? "Đang dùng trình duyệt" : "Đang cần bạn thao tác";
  computerRuns.set(agentId, startSubagentRun(agentId, COMPUTER_USE, title));
}

function finishComputerUseRun(agentId: string): void {
  const id = computerRuns.get(agentId);
  if (id == null) return;
  computerRuns.delete(agentId);
  finishSubagentRun(agentId, id, "done");
}

/** Register a starting subagent and return its id, so the caller can settle it later. */
export function startSubagentRun(parentAgentId: string, subagentType: string, title: string): string {
  const subagentId = `sub-${subagentSeq++}`;
  let rows = subagentRuns.get(parentAgentId);
  if (!rows) { rows = new Map(); subagentRuns.set(parentAgentId, rows); }
  rows.set(subagentId, { subagentId, subagentType, title, status: "running", startedAtMs: Date.now() });
  onUpdate(parentAgentId);
  return subagentId;
}

export function finishSubagentRun(parentAgentId: string, subagentId: string, status: SubagentRow["status"]): void {
  const row = subagentRuns.get(parentAgentId)?.get(subagentId);
  if (!row) return;
  // Immutable update: the row is handed straight to the client, and mutating one it already
  // holds is how a list stops re-rendering on a status change.
  subagentRuns.get(parentAgentId)!.set(subagentId, { ...row, status });
  onUpdate(parentAgentId);
}

export const getSubagents = (a: { id?: string; agentId?: string } = {}): SubagentRow[] => {
  const rows = subagentRuns.get(a.id ?? a.agentId ?? "");
  return rows ? [...rows.values()].sort((x, y) => x.startedAtMs - y.startedAtMs) : [];
};

/**
 * The background-task tray, `getAsyncTasks({id}) → array`.
 *
 * Shape is the client's own row: `{id, kind, startedAtMs, detail?}` where `kind` is one of
 * `subagent | shell | cloud-agent` — read off the renderer, which switches on exactly those three
 * for the row icon (`subagent → agent`, `shell → terminal-rectangle`,
 * `cloud-agent → cloud-arrow-up`) and folds `detail` into the label when it is non-empty.
 *
 * This returned `[]` until 2026-08-21, which is why a running subagent was invisible in the app:
 * `getSubagents` feeds a store the conversation screen does not render, while THIS list is the
 * visible `sand-async-task` tray. Only running rows belong here — a finished subagent is history,
 * and the tray is "what is happening now".
 */
export const getAsyncTasks = (a: { id?: string; agentId?: string } = {}): unknown[] => {
  const rows = subagentRuns.get(a.id ?? a.agentId ?? "");
  if (!rows) return [];
  return [...rows.values()]
    .filter((r) => r.status === "running")
    .sort((x, y) => x.startedAtMs - y.startedAtMs)
    .map((r) => ({ id: r.subagentId, kind: "subagent", startedAtMs: r.startedAtMs, detail: r.title }));
};

// ── run control ───────────────────────────────────────────────────────────────
/** True while a turn is streaming — lets a routine settle its run record. */
export const isAgentRunning = (agentId: string): boolean => inflight.has(agentId);

export function interruptAgentRun(a: { agentId?: string; id?: string }) {
  const agentId = a.agentId ?? a.id ?? "";
  inflight.get(agentId)?.abort(); inflight.delete(agentId);
  askWriteThisTurn.delete(agentId);
  const last = [...(transcripts.get(agentId) ?? [])].reverse().find((e) => e.kind === "send-message" && e.message.type === "text");
  if (last) {
    if (!textOf(last)) setText(last, "⏹ đã dừng");
    if (last.kind === "send-message") last.streaming = false;
    last.timestampMs = Date.now();
  }
  clearPresence(agentId);
  onUpdate(agentId);
  return { id: agentId, interrupted: true };
}

/** The capability object handed to a tool while it runs for one agent. */
const ctxFor = (agentId: string, history?: PoolMessage[]): ToolCtx => ({
  agentId,
  draft: (message) => {
    tail(agentId).push({ id: nextId(), kind: "send-message", author: authorOf(agentId), message, timestampMs: Date.now() });
    onUpdate(agentId);
  },
  attach: (dataUrl, fileName, alt) => postAttachment(agentId, dataUrl, fileName, alt),
  ask: (widget) => postWidget(agentId, widget),
  note: (text) => {
    tail(agentId).push({ id: nextId(), kind: "send-message", author: authorOf(agentId), message: { type: "text", content: text }, timestampMs: Date.now() });
    onUpdate(agentId);
  },
  requestBoxHelp: (instruction) => {
    const waited = requestBoxHelp(agentId, instruction);
    // Park the continuation too: if the backend restarts while the card is up, hand-back
    // has no Promise left to resolve and resumes from this instead.
    park({ kind: "handoff", key: agentId, agentId, name: "request_box_help", arg: instruction, history });
    onUpdate(agentId);   // push the handoff card out without waiting for the next poll
    // Resolved in-process, so the parked copy is no longer the resume path — drop it, or a
    // later restart would replay a handoff the user already finished.
    return waited.finally(() => { unpark("handoff", agentId); });
  },
});

/** Tools that never need an approval card, on top of the read-only box tools. */
// `request_box_help` belongs here for the same reason as `ask_question`: it asks the user to
// do something, it does not do anything itself. An approval card in front of it would make
// them click Allow before being allowed to be asked for help.
// `attach_file` is here for consistency with screenshots: browser tools call ctx.attach() and
// drop an image into the transcript with no prompt, so asking permission to show a file the
// agent could already read with read_file_v2 buys nothing. The tools that WRITE (edit_file_v2,
// edit_file, delete_file) still ask.
/**
 * Tools that run without a permission card.
 *
 * The bar is not "is this harmless" but "does the card tell the truth about it". The client's
 * copy for `local-tool-permission` is fixed and we cannot change it — the app is signed — and it
 * reads *"Allow Grok Bot and all Bots to run commands on your local computer?"*. Asked to suggest
 * a name for itself and told "Lumen", the model called `rename_agent({"to":"Lumen"})` and the user
 * was shown that sentence. Renaming a bot writes one string in the roster: no shell, no file, no
 * network. A warning that describes the wrong action is worse than no warning, because it teaches
 * people to click through the ones that matter.
 *
 * `create_agent` is deliberately NOT here. It is equally mis-described by that copy, but it brings
 * a new actor into the workspace rather than editing a label, so the call is the user's to make.
 */
const AUTO_APPROVED = new Set(["ask_question", "request_box_help", "get_mcp_tools", "message_agent", "attach_file", "attach_image", "generate_image", "send_to_user", "rename_agent", "echo", "time", "reverse", "upper", "count", "calc"]);

/** Native `/v1` turns ask on write tools even when the stock app saved "always". */
const askWriteThisTurn = new Set<string>();

/**
 * Run one tool and report it, whether it was auto-approved or the user clicked Allow.
 * Async by design: browser actions take seconds, so the tool card goes "running" and the
 * result lands out of band instead of blocking the gateway reply the FE is waiting on.
 */
function runTool(
  agentId: string,
  toolCallId: string,
  name: string,
  arg: string,
  history?: PoolMessage[],
  /**
   * Set by a batch owner. When present, this call does NOT continue the turn on its own — the owner
   * waits for every call in the batch and sends one combined follow-up instead. Without this, N
   * parallel calls would each start their own follow-up turn and the model would answer N times.
   */
  onDone?: (result: string) => void,
): void {
  const t = tail(agentId);
  const tc = t.find((e): e is Extract<Entry, { kind: "tool-call" }> => e.kind === "tool-call" && e.toolCallId === toolCallId);
  if (!tc) return;
  const fn = TOOLS[name];
  if (!fn) {
    tc.result = "(unknown tool)";
    tc.status = "failed";
    onUpdate(agentId);
    return;
  }
  tc.status = "running";
  // Claim the computer for this bot. Browser actions drive its Chrome window; a handoff puts a
  // card on screen the user has to act on. Either way this bot — and only this bot — should
  // show a live screen while it lasts.
  if (name.startsWith("browser_") || name === "request_box_help") startComputerUseRun(agentId, name);
  // A box handoff waits on a human, which can be minutes or never. Leaving the turn "running"
  // meanwhile is what made the app look dead: `isRunning` stayed true, the avatar spun behind
  // a card that needed a click, and because the promise had not settled nothing ever cleared
  // it. The same reasoning the ask_question branch below already applies — a parked turn is
  // waiting, not working — just applied at the right moment rather than after the wait.
  if (name === "request_box_help") clearPresence(agentId);

  void Promise.resolve(fn(arg, ctxFor(agentId, history)))
    .catch((e: Error) => `tool error: ${e.message}`)
    .then((result) => {
      tc.result = result;
      tc.status = "done";
      onUpdate(agentId);
      if (onDone) { onDone(result); return; }
      // A question is not a result to reason about — the follow-up turn happens when the
      // user answers it, not now, or the model talks over its own question.
      if (history && name !== "ask_question") continueAfterTool(agentId, history, name, arg, result);
      if (name === "ask_question" && history) park({ kind: "widget", key: agentId, agentId, history });
      // A parked turn is waiting on the user, not working: leaving it "running" spins the
      // indicator forever behind a card that needs a click.
      if (!history || name === "ask_question") clearPresence(agentId);
    });
}



// ── approvals ─────────────────────────────────────────────────────────────────
function findPending(requestId?: string) {
  if (requestId) {
    const p = pending.get(requestId);
    return p ? { requestId, ...p } : null;
  }
  const first = [...pending.entries()][0];
  return first ? { requestId: first[0], ...first[1] } : null;
}
// The FE sends {entryId, requestId, resolution, agentId} where resolution is
// "always" | "allow-once" | "never" | "deny" — reading approved/decision never matched.
export function resolveLocalToolPermission(a: { requestId?: string; entryId?: string; agentId?: string; resolution?: string; approved?: boolean; decision?: string; allow?: boolean }) {
  const p = findPending(a.requestId); if (!p) return { resolved: false };
  if (a.agentId && p.agentId !== a.agentId) return { resolved: false };
  const approved = a.resolution != null
    ? a.resolution === "always" || a.resolution === "allow-once" || a.resolution === "allow"
    : a.approved ?? a.allow ?? (a.decision === "approve" || a.decision === "allow");
  pending.delete(p.requestId);
  const t = transcripts.get(p.agentId) ?? [];
  const card = t.find((e) => e.id === p.entryId);
  if (card && card.kind === "send-message" && card.message.type === "local-tool-permission") card.message.ask.status = approved ? "approved" : "denied";
  const tc = t.find((e): e is Extract<Entry, { kind: "tool-call" }> => e.kind === "tool-call" && e.toolCallId === p.toolCallId);
  if (tc) {
    if (approved) {
      const fn = TOOLS[p.name ?? ""];
      if (!fn) {
        tc.result = "(unknown tool)";
        tc.status = "done";
      } else {
        // Browser actions take seconds, so show "running" and finish out of band rather than
        // blocking the gateway reply the FE is waiting on.
        tc.status = "running";
        void Promise.resolve(fn(p.arg ?? "", ctxFor(p.agentId, p.history)))
          .catch((e: Error) => `tool error: ${e.message}`)
          .then((result) => {
            tc.result = result;
            tc.status = "done";
            onUpdate(p.agentId);
            if (p.history) continueAfterTool(p.agentId, p.history, p.name ?? "", p.arg ?? "", result);
          });
      }
    }     else { tc.status = "failed"; tc.result = "denied"; }
  }
  onUpdate(p.agentId); return { resolved: true };
}
export function resolveAutoReviewApproval(a: { requestId?: string; approved?: boolean }) {
  const p = findPending(a.requestId); if (!p) return {};
  pending.delete(p.requestId);
  const card = (transcripts.get(p.agentId) ?? []).find((e) => e.id === p.entryId);
  if (card && card.kind === "send-message" && card.message.type === "auto-review-approval") card.message.approval.status = a.approved ? "approved" : "denied";
  onUpdate(p.agentId); return {};
}
/**
 * The user picked an option (or typed a custom answer).
 *
 * The declared reply is "record-or-null", so the updated entry goes back, not `{}`.
 * Key names are read broadly on purpose: the call site is built in the renderer and could not
 * be read statically, and guessing one spelling is exactly how five features died before
 * (HANDOFF §5). `GROKBOT2_LOG=1` prints the real payload.
 */
export function respondToWidget(a: any) {
  const entryId: string | undefined = a?.entryId ?? a?.id ?? a?.messageId;
  const agentId: string = a?.agentId ?? a?.id ?? "";
  const answer: string | undefined =
    a?.value ?? a?.answer ?? a?.respondedValue ?? a?.text ?? a?.freeformText ?? a?.selectedValue;

  // Find the widget entry: by id when we were given one, else the newest unanswered widget.
  const isWidget = (e: Entry): e is Extract<Entry, { kind: "send-message" }> =>
    e.kind === "send-message" && e.message.type === "widget";
  const search = (list: Entry[]) =>
    (entryId != null ? list.find((e) => e.id === entryId && isWidget(e)) : undefined) ??
    [...list].reverse().find((e) => isWidget(e) && e.respondedValue == null && e.widgetDismissed !== true);

  let found: Extract<Entry, { kind: "send-message" }> | undefined;
  let owner = agentId;
  const direct = transcripts.get(agentId);
  if (direct) found = search(direct) as typeof found;
  if (!found) {
    for (const [id, list] of transcripts) {
      const hit = search(list) as typeof found;
      if (hit) { found = hit; owner = id; break; }
    }
  }
  if (!found || found.message.type !== "widget") return null;

  const chosen = found.message.widget.options.find((o) => (o.value ?? o.label) === answer);
  const value = answer ?? chosen?.value ?? chosen?.label ?? "";
  found.respondedValue = value;

  // Echo the answer as a user turn so the transcript reads like a conversation, then let the
  // model continue from the question it asked.
  tail(owner).push({ id: nextId(), kind: "message", role: "user", content: value, timestampMs: Date.now() });
  onUpdate(owner);

  const waiting = unpark("widget", owner);
  if (waiting?.history) {
    continueAfterTool(owner, waiting.history, "ask_question", found.message.widget.prompt, value);
  }
  return found;
}
export function submitSecret(a: { requestId?: string }) {   // value intentionally not stored
  const p = findPending(a.requestId); if (p) { pending.delete(p.requestId); onUpdate(p.agentId); } return {};
}
export function dismissWidget(a: { requestId?: string; agentId?: string }): Record<string, never> {
  if (a.requestId) pending.delete(a.requestId);
  if (a.agentId) onUpdate(a.agentId);
  return {};
}

// ── send ──────────────────────────────────────────────────────────────────────
function reveal(target: Entry, full: string, agentId: string): void {
  if (process.env.GROKBOT2_PROGRESSIVE === "0") { setText(target, full); if (target.kind === "send-message") target.streaming = false; onUpdate(agentId); return; }
  const tokens = full.match(/\S+\s*/g) ?? [full];
  const per = Math.max(1, Math.ceil(tokens.length / 24));
  let i = 0;
  const tick = (): void => {
    i += per;
    if (i >= tokens.length) { setText(target, full); if (target.kind === "send-message") target.streaming = false; onUpdate(agentId); return; }
    setText(target, tokens.slice(0, i).join("")); onUpdate(agentId); setTimeout(tick, 45);
  };
  tick();
}

/**
 * Bot-to-bot messaging.
 *
 * The original's transcript shows this as "Messaged Thư ký" / "Message from Sales" /
 * "2 messages with 2 Bots". The renderer decides that purely from a `kind:"message"` entry
 * carrying `toAgent` (outbound) or `fromAgent` (inbound) — client: `fm`. Both sides get an
 * entry, so each bot's own transcript reads as a conversation.
 *
 * A hop budget is not optional. Two bots that answer each other will do so forever, burning
 * pool quota with nobody watching; the original has orchestration to stop that and we do not.
 */
const MAX_HOPS = 3;
const hops = new Map<string, number>();

export function messageAgent(fromId: string, target: string, content: string): string {
  const from = agents.get(fromId);
  const wanted = target.trim().toLowerCase().replace(/^@/, "");
  const to = agents.get(target) ??
    [...agents.values()].find((a) => a.name.toLowerCase() === wanted) ??
    [...agents.values()].find((a) => a.name.toLowerCase().includes(wanted));
  if (!from || !to) {
    const names = [...agents.values()].map((a) => a.name).slice(0, 12).join(", ");
    return `(không tìm thấy bot "${target}"; có: ${names})`;
  }
  if (to.id === fromId) return "(không thể tự nhắn cho chính mình)";

  const hop = (hops.get(fromId) ?? 0) + 1;
  if (hop > MAX_HOPS) return `(đã đạt trần ${MAX_HOPS} lượt chuyển tiếp giữa các bot — dừng để tránh vòng lặp)`;

  const now = Date.now();
  // Outbound on the sender's side: the renderer labels this "Messaged <name>".
  tail(fromId).push({ id: nextId(), kind: "message", role: "assistant", content, timestampMs: now,
    toAgent: { id: to.id, name: to.name, kind: "agent" } });
  onUpdate(fromId);

  // Inbound on the recipient's side. sendPrompt writes that entry itself, so pass `fromAgent`
  // through rather than pushing one here too — doing both showed the message twice in the
  // recipient's transcript, once labelled and once as a plain "[từ bot X] …" prompt.
  to.unread = true;
  hops.set(to.id, hop);
  sendPrompt({ agentId: to.id, content, fromAgent: { id: from.id, name: from.name } });

  return `đã nhắn cho ${to.name}`;
}

export function sendPrompt(args: SendArgs) {
  // Multi-tenant Phase 2: a caller may only prompt an agent they own. An explicit id they do not
  // own is rejected without any write; with no id, fall back to their OWN first agent (or a new one).
  // NOTE for future multi-user: internal bot-to-bot sends run in a background turn where
  // currentOwner() is the default identity — fine while every agent is owned by that identity, but
  // cross-user agent networks will need the owner threaded into the turn (roadmap Phase 6).
  if (args.agentId && !ownsAgent(args.agentId)) return { rejected: true as const };
  let agentId = args.agentId || [...agents.keys()].find(ownsAgent);
  if (!agentId) agentId = createAgent({}).id;
  if (args.askWriteTools) askWriteThisTurn.add(agentId);
  else askWriteThisTurn.delete(agentId);
  const text = args.content ?? args.prompt ?? args.text ?? args.richText?.text ?? "";
  const t = tail(agentId);

  /*
   * X6.3 — trả lời có tham chiếu THẬT. Caller chỉ gửi id; tên và trích đoạn tra ở đây vì backend
   * là nơi duy nhất còn giữ entry gốc (FE chỉ thấy cửa sổ 150 entry). Id không tra được thì bỏ
   * qua thay vì từ chối cả turn: một tin trả lời mất tham chiếu vẫn đáng gửi hơn là mất luôn.
   */
  let replyTo: { entryId: string; author: string; excerpt: string } | undefined;
  if (args.replyToEntryId) {
    const target = t.find((e) => e.id === args.replyToEntryId);
    if (target) {
      const author = target.kind === "send-message" ? target.author.name
        : target.kind === "message" && target.role === "user" ? "người dùng"
        : target.kind === "message" ? (target.fromAgent?.name ?? "bot") : "bot";
      const excerpt = (textOf(target) || attachmentNameOf(target)).slice(0, 160);
      replyTo = { entryId: target.id, author, excerpt };
    }
  }

  const userEntry: Entry = { id: nextId(), kind: "message", role: "user", content: text, timestampMs: Date.now(), ...(args.clientNonce ? { clientNonce: args.clientNonce } : {}), ...(args.fromAgent ? { fromAgent: args.fromAgent } : {}), ...(replyTo ? { replyTo } : {}) };
  t.push(userEntry);

  // Show what the user attached, instead of only the text they typed alongside it.
  //
  // The bytes reached the model once `attachmentPaths` was understood, but the transcript still
  // held a text-only entry, so the picture the user had just attached never appeared in the chat —
  // the reply talked about an image nobody could see. `type:"attachment"` is the shape the renderer
  // already draws for agent-side pictures (attach_image / screenshots), reused here for the user's
  // own upload; the bytes are served back through readAttachmentImage exactly the same way.
  // Which attachment entries belong to THIS turn - the only ones whose bytes ride the request.
  const freshAttIds = new Set<string>();
  for (const att of attachmentsOf(args)) {
    if (!att.path) continue;
    const attId = nextId();
    freshAttIds.add(attId);
    t.push({
      id: attId, kind: "message", role: "user",
      content: "", message: { type: "attachment", url: att.path, file_name: att.name ?? "", alt: att.name ?? "" },
      timestampMs: Date.now(),
    } as Entry);
  }

  // Record acceptance so the composer's poll confirms the bubble and refreshes the transcript.
  if (args.clientNonce) {
    acceptance.set(args.clientNonce, {
      accountSlot: "default", clientNonce: args.clientNonce, status: "accepted",
      acceptedAtMs: Date.now(), agentId, echoEntryId: userEntry.id, rejectionCode: null,
    });
  }

  // A new user message gets a fresh tool-step budget; without this the cap is cumulative and
  // the tenth message of a session gets no tools at all.
  resetToolSteps(agentId);
  // The bot-to-bot hop budget needs the same reset, and never had one.
  //
  // `hops` only ever counted up: nothing deleted or cleared it, in any file. So a bot that had
  // once received a relayed message at depth MAX_HOPS could never call `message_agent` again —
  // every later attempt answered "đã đạt trần 3 lượt", in a brand new conversation, with no
  // error anywhere. The team-of-bots feature quietly switched itself off as the roster got used.
  //
  // The reset belongs here and only here: a message FROM THE USER is what starts a new chain,
  // while one carrying `fromAgent` IS the chain and must keep counting or the loop guard is gone.
  if (!args.fromAgent) hops.delete(agentId);

  // Manual trigger: "/tool echo hello"
  const m = text.match(/^\/tool\s+(.+)/i);
  if (m) { injectTool(agentId, m[1]); return { accepted: true, entryId: userEntry.id, agentId }; }

  const bubble: Entry = { id: nextId(), kind: "send-message", author: authorOf(agentId), message: { type: "text", content: "" }, timestampMs: Date.now(), streaming: true };
  t.push(bubble);
  onUpdate(agentId);

  const key = loadPoolKey();
  if (!key) {
    setText(bubble, "[grokbot2] Chưa có key — dán hal_xxx vào services/grokbot-backend/pool-key.txt");
    if (bubble.kind === "send-message") bubble.streaming = false;
    onUpdate(agentId);
    return { accepted: true, entryId: userEntry.id, agentId };
  }

  // A message from another bot is attributed in the model's history, not in the entry text —
  // the entry carries `fromAgent` so the renderer can label it, and prefixing the stored text
  // instead would put "[từ bot X]" inside the visible bubble as well.
  const history: PoolMessage[] = t.filter((e) => (textOf(e) || attachmentNameOf(e)) && !isToolEcho(e))
    .map((e) => {
      const from = e.kind === "message" ? e.fromAgent : undefined;
      // An attachment entry has no text; name it so the turn it belongs to still exists in the
      // history. The bytes themselves ride the top-level `image` field, not this line.
      let body = textOf(e) || attachmentLineOf(e, freshAttIds.has(e.id));
      // A TEXT file attached THIS turn carries its content into the history (X8). The name alone
      // told the model nothing: "tóm tắt tệp này" got an answer invented from the file name.
      // Images ride the `image` field; older attachments stay name-only — re-inlining them every
      // turn would balloon the prompt with bytes the model has already seen.
      if (freshAttIds.has(e.id)) {
        const url = e.kind === "message" ? (e as { message?: { url?: string } }).message?.url : undefined;
        const inline = url ? stagedTextPreview(url) : null;
        if (inline) body += `${NEWLINE}Nội dung tệp:${NEWLINE}${inline.text}${inline.truncated ? `${NEWLINE}[…đã cắt: tệp dài hơn 32KB]` : ""}`;
      }
      // Tin trả lời mang theo tham chiếu cho model — không có dòng này thì `replyTo` chỉ là
      // trang trí ở FE, đúng cái bẫy X6.1 đã gọi tên.
      const rt = e.kind === "message" ? e.replyTo : undefined;
      if (rt) body = `[trả lời tin của ${rt.author}: "${rt.excerpt}"] ${body}`;
      return {
        role: e.kind === "message" && e.role === "user" ? "user" : "assistant",
        content: from ? `[tin nhắn từ bot ${from.name}] ${body}` : body,
      } as PoolMessage;
    });
  // Vertex refuses outright a conversation whose last turn is the model’s:
  //   "Vertex 400: Requests ending with a model turn are not supported"
  // Sending a picture with no caption produced exactly that. Both entries the turn appended -
  // the empty user message and the attachment - carried no text, the filter above dropped both,
  // and the last surviving entry was the bot’s PREVIOUS answer. Measured in the live transcript:
  // message(role=user, len 0), message(role=user, attachment), then the error bubble.
  // Naming the attachment above fixes that case; this guard covers what is left: a message with
  // no text and nothing attached, which would fail the same way for the same reason.
  if (history[history.length - 1]?.role !== "user") {
    history.push({ role: "user", content: text.trim() || `[tin nhắn rỗng]` });
  }
  const image = readImageAttachment(attachmentsOf(args));
  // Abort whatever was still running for this bot before replacing it. `inflight` is keyed by
  // agent, so overwriting it left the previous turn streaming into an older bubble with no way
  // to stop it — two turns writing at once, and the presence flags set by whichever finished
  // last. Sending a new message means the user has moved on.
  inflight.get(agentId)?.abort();
  const controller = new AbortController();
  inflight.set(agentId, controller);
  void startTurn(agentId, bubble, history.length ? history : [{ role: "user", content: text }], key, controller, image);
  return { accepted: true, entryId: userEntry.id, agentId };
}

/** Turn a tool request into a tool-call entry + a pending permission card. */
function injectTool(agentId: string, spec: string, history?: PoolMessage[]): void {
  const [name = "", ...rest] = spec.trim().split(/\s+/);
  const arg = rest.join(" ");
  const t = tail(agentId);
  const toolCallId = nextToolId();
  const requestId = nextReqId();
  const lower = name.toLowerCase();
  const known = lower in TOOLS;
  // `summary` is the client's own one-line description of a tool step — the outline panel
  // reads it (`n.summary != null ? firstLine(n.summary) : ""`) and shows nothing without it.
  t.push({ id: nextId(), kind: "tool-call", toolCallId, name, rawArgs: JSON.stringify({ arg }), summary: `${name}(${arg})`.slice(0, 160), status: "pending", timestampMs: Date.now() });

  // Read-only tools and questions run straight away. `isAutoApproved` existed but nothing
  // called it, so every harmless read still made the user click Allow.
  // Browser actions drive the BOX's own Chrome, which the user is watching live in the VNC
  // pane. The original asks for nothing here — a sign-in flow there runs navigate → screenshot
  // → click → screenshot in one breath, and a card per step would make that impossible. What
  // still asks is anything that writes to disk.
  const isBrowserAction = lower.startsWith("browser_");
  /**
   * The user's standing answer to the permission card, which we were storing and ignoring.
   *
   * The client persists it through `setHostSettings` as `localToolPermission` and its own card
   * says so — "Always allow … It can always be changed in Settings". Read off the live settings
   * on this machine it was already `"always"`, meaning the button had been pressed at some point
   * and every later request still put the card up again. From the user's side that is the app
   * forgetting an answer it explicitly promised to remember.
   *
   * `never` is honoured too, and honoured as a refusal rather than a silent drop: a tool that
   * does nothing and says nothing is indistinguishable from one that is broken.
   */
  const standing = askWriteThisTurn.has(agentId)
    ? "ask"
    : String((hostSettingsRef() as { localToolPermission?: unknown }).localToolPermission ?? "ask");
  if (known && standing === "never") {
    const denied: Entry = { id: nextId(), kind: "send-message", author: authorOf(agentId), timestampMs: Date.now(),
      message: { type: "local-tool-permission", ask: { status: "denied", target: `${name}(${arg})`, requestId } } };
    t.push(denied);
    const tc = t.find((e): e is Extract<Entry, { kind: "tool-call" }> => e.kind === "tool-call" && e.toolCallId === toolCallId);
    if (tc) { tc.status = "done"; tc.result = "(người dùng đã chặn công cụ chạy lệnh trên máy)"; }
    onUpdate(agentId);
    return;
  }
  if (known && (standing === "always" || AUTO_APPROVED.has(lower) || isBrowserAction || isAutoApproved(lower))) {
    runTool(agentId, toolCallId, lower, arg, history);
    onUpdate(agentId);
    return;
  }

  const card: Entry = { id: nextId(), kind: "send-message", author: authorOf(agentId), timestampMs: Date.now(),
    message: { type: "local-tool-permission", ask: { status: known ? "pending" : "denied", target: `${name}(${arg})`, requestId } } };
  t.push(card);
  if (known) pending.set(requestId, { agentId, entryId: card.id, toolCallId, name: lower, arg, history });
  onUpdate(agentId);
}

/** One model turn: stream tokens into `bubble`, then handle a TOOL_CALL if the model asked. */
/**
 * Compact if the conversation has outgrown its budget, then run the turn.
 *
 * Compaction happens before the request rather than after a failure: once the window is
 * exceeded the call fails outright, and a retry with the same oversized history fails the
 * same way.
 */
async function startTurn(agentId: string, bubble: Entry, history: PoolMessage[], key: string, controller: AbortController, image?: string): Promise<void> {
  // Per-user quota (multi-tenant Phase 5). Billed to the agent's OWNER, not the caller: this runs
  // detached from the request, so `ownerOf(agentId)` is the reliable identity (currentOwner() would
  // be the default here). Under GROKBOT2_BILLING=enforce an over-cap user does not spend a turn.
  const turnOwner = ownerOf(agentId) ?? DEFAULT_USER.authId;
  if (billingMode() === "enforce" && accessVerdict({ authId: turnOwner, email: "" }) === "payment_required") {
    setText(bubble, "[grokbot2] Hết hạn mức tháng — nâng cấp gói để tiếp tục.");
    if (bubble.kind === "send-message") bubble.streaming = false;
    clearPresence(agentId); onUpdate(agentId); persist();
    return;
  }
  // The indicator must appear before the first token, not after it — that gap is exactly
  // what reads as a frozen app.
  setPresence(agentId, { isRunning: true, isComposingMessage: false, currentActivity: { kind: "thinking" } });
  const prior = compaction.get(agentId) ?? null;
  if (needsCompaction(history)) {
    const next = await compact(history, key, prior, controller.signal);
    if (next) { compaction.set(agentId, next); persist(); }
  }
  return runTurn(agentId, bubble, applyCompaction(history, compaction.get(agentId) ?? null), key, controller, image);
}

async function runTurn(agentId: string, bubble: Entry, history: PoolMessage[], key: string, controller: AbortController, image?: string): Promise<void> {
  // Tiered so the ~5k-token base prompt stays a stable cacheable prefix; the timestamp and
  // anything else per-turn goes last. See prompt.ts.
  // Per-owner: the MCP paragraph names THIS account's servers, and picks up a plugin installed
  // since boot. Was a module-level constant built from the default owner's config at import time.
  const system = buildSystemPrompt(toolProtocolFor(ownerOf(agentId) ?? DEFAULT_USER.authId), {
    memory: renderMemory(await loadMemory(agentId)),
    agentName: agents.get(agentId)?.name,
    boxOn: boxConfigured(),
    browserOn: isBrowserConfigured(),
    timeZone: (hostSettingsRef() as { userTimeZone?: string }).userTimeZone,
  });
  // 2048 (the pool default) truncates a big tool call: an `ask_question` with several options runs
  // past it, and a cut-off `TOOL_CALL: ask_question({…` cannot parse, so it lands on screen as raw
  // JSON instead of a widget — exactly the reported bug. 4096 clears the realistic cases; tunable.
  const maxTokens = Number(process.env.GROKBOT2_MAX_TOKENS ?? 4096);
  // An image turn under claude-opus-5 sometimes comes back as
  //   TOOL_CALL: Read({"file_path":"/tmp/oc-img-a2ba17378f2712e5"})
  // because the pool hands the picture to its Claude Code CLI as a temp FILE. That path lives on the
  // pool host, so the call can never run here and the turn ends in “mình không đọc được ảnh” while the
  // picture is already in the request. Measured: it happens on some turns and not others, and
  // gemini-3.7-flash never does it. So say the one thing that removes the reason to reach for a tool.
  const visionNote = image
    ? [
        "",
        "",
        "## Ảnh đính kèm",
        "",
        "Ảnh của người dùng đã được đính kèm trực tiếp vào lượt này và bạn ĐANG thấy nó.",
        "Không có công cụ nào để mở ảnh và bạn không cần mở file nào — hãy nhìn ảnh rồi trả lời ngay.",
      ].join(NEWLINE)
    : "";
  const opts = { url: config.poolUrl, key, model: config.model, system: system + visionNote, maxTokens, signal: controller.signal, knownTools: Object.keys(TOOLS), ...(image ? { image } : {}) };
  // Typewriter buffer: the pool often delivers a whole answer in one chunk, which would pop
  // in with no motion. Feed chunks into a target and let the displayed text catch up on a
  // timer, so the reply always animates in (GROKBOT2_PROGRESSIVE=0 disables).
  let target = "";
  let shown = 0;
  let ticking = false;
  const instant = process.env.GROKBOT2_PROGRESSIVE === "0";
  const pump = (): void => {
    if (controller.signal.aborted) { ticking = false; return; }
    if (shown >= target.length) { ticking = false; return; }
    ticking = true;
    const step = Math.max(2, Math.ceil((target.length - shown) / 12));
    shown = Math.min(target.length, shown + step);
    setText(bubble, target.slice(0, shown));
    bubble.timestampMs = Date.now();
    onUpdate(agentId);
    setTimeout(pump, 40);
  };
  let r = await completeTurn(history, opts, (chunk) => {
    if (controller.signal.aborted) return;
    // First token: the indicator switches from "working" to "typing", which is the whole
    // difference between "it is doing something" and "it is answering you now".
    if (!target) setPresence(agentId, { isComposingMessage: true, currentActivity: null });
    target += chunk;
    if (instant) { setText(bubble, target); onUpdate(agentId); return; }
    if (!ticking) pump();
  });
  // Let the buffer drain before finishing the turn.
  if (!instant && r.ok) {
    for (let i = 0; i < 80 && shown < target.length && !controller.signal.aborted; i++) {
      await new Promise((res) => setTimeout(res, 40));
    }
    // Then publish the finished text once more, unconditionally.
    //
    // The reply arrived on screen two characters short — "bắt tay vào luô" for a stored "bắt tay vào
    // luôn?" — and two is exactly the typewriter's minimum step, so the last tick was the one that
    // went missing. Rather than chase which tick got lost, end the animation with a state that does
    // not depend on any tick having landed: same text the transcript already holds, so it is a no-op
    // whenever the pump did finish cleanly, and the difference between a correct answer and a
    // truncated one when it did not.
    if (!controller.signal.aborted && shown !== target.length) {
      shown = target.length;
      setText(bubble, target);
      onUpdate(agentId);
    }
  }
  const acc = target;
  // The pool's streaming route intermittently completes with no deltas (HTTP 200,
  // finish_reason "stop", empty content) while the non-streaming route answers fine —
  // so treat an empty stream as a failure and retry without streaming.
  const streamedNothing = r.ok && !(r.text ?? "").trim();
  if ((!r.ok || streamedNothing) && r.error !== "aborted" && !controller.signal.aborted) {
    if (streamedNothing) console.warn("[grokbot2] stream returned no content — falling back to non-streaming");
    r = await completeTurnPlain(history, opts);
    if (r.ok) reveal(bubble, r.text ?? "", agentId);
  }
  inflight.delete(agentId);
  if (controller.signal.aborted) {
    // An aborted turn used to just return, and it left two kinds of wreckage on screen.
    //
    // `sendPrompt` aborts whatever is running for that bot before starting the next turn, which
    // in a multi-agent conversation happens constantly — a peer messaging a bot mid-turn is the
    // normal case, not an edge case. Measured in a real run: Frontend Dev's transcript held an
    // EMPTY bubble right before an inbound message, and later a 28k-character bubble whose text
    // ended in a complete `TOOL_CALL: edit_file_v2({...})` that never ran. Both come from here:
    // the return happens before the bubble is tidied and before the call is parsed, so an empty
    // bubble stays empty for ever and a finished answer is shown with its machine line exposed.
    //
    // Deliberately NOT running the tool. The turn was abandoned because the user (or a peer)
    // moved on; acting on a superseded decision is worse than dropping it. Stripping the line is
    // enough — what the model SAID is kept, what it was about to DO is discarded with the turn.
    //
    // Strip from the FIRST `TOOL_CALL:` onward, not a balanced call anchored to the end.
    //
    // The previous regex was `/TOOL_CALL:\s*[A-Za-z_][\w-]*\s*\([\s\S]*?\)\s*$/`, which needs a
    // closing paren AND needs the call to be the last thing in the text. An abort is precisely the
    // case where neither holds: the stream is cut mid-`TOOL_CALL: edit_file_v2({"path":"…` , so
    // there is no `)` to match, nothing is stripped, and the user is shown the machine line — the
    // exact defect this block exists to prevent. It reproduced intermittently in
    // `e2e-abort-swallows-tool` for that reason. Two tool calls, or any prose after one, failed the
    // same way.
    //
    // Safe to cut from the first marker: the protocol tells the model to write NOTHING after those
    // lines, and the sibling cleanup below (the non-abort path) already strips this way.
    const text = textOf(bubble);
    const spoken = text.replace(/TOOL_CALL:[\s\S]*$/, "").trim();
    if (spoken) {
      setText(bubble, spoken);
      if (bubble.kind === "send-message") bubble.streaming = false;
    } else {
      const at = tail(agentId).indexOf(bubble);
      if (at >= 0) tail(agentId).splice(at, 1);
    }
    onUpdate(agentId);
    return;
  }
  if (!r.ok) {
    setText(bubble, `[grokbot2] Pool error: ${r.error}`);
    if (bubble.kind === "send-message") bubble.streaming = false;
    // Presence has to be cleared here too, and it was not. Every other exit from this function
    // clears it; this one returned early, so a pool failure left `isRunning` true with nothing
    // generating behind it — the bot span in the sidebar until the process restarted. It is the
    // one path the user is most likely to hit, because it is the path an outage takes.
    clearPresence(agentId);
    onUpdate(agentId); return;
  }
  // Both routes can answer HTTP 200 with no content. Leaving the bubble empty looks like the
  // app silently lost the reply; say so instead, so the failure is visible rather than blank.
  if (!(r.text ?? "").trim() && !acc.trim()) {
    console.warn("[grokbot2] pool returned no content on either route");
    setText(bubble, "[grokbot2] Pool trả về rỗng — thử gửi lại.");
  }
  if (bubble.kind === "send-message") bubble.streaming = false;

  // Usage meter (billing step ⑤, warn phase). Off unless GROKBOT2_BILLING is warn|enforce.
  //
  // ESTIMATES, not real counts: the pool returns no token usage (it runs Claude via subscription
  // CLIs, no per-token metering), so estimateTokens (len/2.8) is the only signal — labelled as such
  // so it is never mistaken for a measured number. `turns` is exact. Attributed to DEFAULT_USER
  // until the turn path threads a per-request user (enforce/multi-user step). This is a successful
  // model round trip: r.ok is true here and every earlier exit returned. A tool call recurses into
  // startTurn, so each pool round trip meters once — which is the real cost.
  if (billingMode() !== "off") {
    // Attribute to the agent's OWNER (Phase 5) — the turn runs detached, so ownerOf(agentId) is the
    // right identity, not currentOwner() (which would be the default here).
    const meterOwner = ownerOf(agentId) ?? DEFAULT_USER.authId;
    const tin = historyTokens(history);
    const tout = estimateTokens(r.text ?? acc ?? "");
    recordUsage(meterOwner, tin, tout);
    console.log(`[grokbot2:billing] turn metered auth=${meterOwner} ~in=${tin} ~out=${tout} (estimated)`);
  }

  // P5-2. `parseToolCalls` reads every call in the reply, not just a trailing one, and `planBatches`
  // decides what may run together: read-only calls accumulate, anything side-effecting stands alone
  // as a barrier. Only the FIRST batch runs now — its results go back to the model, which re-issues
  // whatever is left. That keeps approval and browser ordering exactly as they were while turning a
  // read-two-files request into one round trip instead of two.
  const calls = r.calls ?? parseToolCalls(textOf(bubble), isKnownTool);
  if (!calls.length) {
    // A `TOOL_CALL:` that did not parse means it was cut off mid-arguments (a big ask_question runs
    // past the token limit) or malformed. Left alone, the raw `TOOL_CALL: ask_question({…` shows on
    // screen as JSON — the reported bug. Never show that: strip from the last TOOL_CALL onward so only
    // the prose remains, and retry the turn ONCE so the model can reissue the call whole. The retry is
    // budgeted by the same MAX_TOOL_STEPS as any other continuation, so it cannot loop.
    if ((r.incomplete ?? hasIncompleteToolCall(textOf(bubble), isKnownTool)) && history) {
      const spoken = textOf(bubble).replace(/TOOL_CALL:[\s\S]*$/, "").trim();
      const step = (toolSteps.get(agentId) ?? 0) + 1;
      if (step < MAX_TOOL_STEPS) {
        toolSteps.set(agentId, step);
        if (spoken) { setText(bubble, spoken); if (bubble.kind === "send-message") bubble.streaming = false; }
        else { const at = tail(agentId).indexOf(bubble); if (at >= 0) tail(agentId).splice(at, 1); }
        onUpdate(agentId);
        const key2 = loadPoolKey();
        if (key2) {
          const b: Entry = { id: nextId(), kind: "send-message", author: authorOf(agentId), message: { type: "text", content: "" }, timestampMs: Date.now(), streaming: true };
          tail(agentId).push(b); onUpdate(agentId);
          const c = new AbortController(); inflight.set(agentId, c);
          void runTurn(agentId, b, history, key2, c);
          return;
        }
      }
      // Out of retries: at least never leave raw JSON on screen.
      if (spoken) setText(bubble, spoken);
      else { const at = tail(agentId).indexOf(bubble); if (at >= 0) tail(agentId).splice(at, 1); }
    }
    clearPresence(agentId); onUpdate(agentId); return;
  }
  const batches = planBatches(calls, isParallelSafe);
  const batch = batches[0];
  const call = batch[0];
  if (batches.length > 1) {
    // Never drop work silently: say what is deferred, or a turn that quietly ran 1 of 4 calls looks
    // like a turn that ran everything.
    const shape = planShape(batches);
    console.log(`[grokbot2] ${shape.calls} tool call(s) in one reply → ${shape.batches} batch(es), widest ${shape.widest}; running batch 1 of ${shape.batches}`);
  }
  // A tool call is not the end of the turn: stay running, and name what is being done.
  setPresence(agentId, {
    isComposingMessage: false,
    currentActivity: {
      kind: "tool",
      tool: ACTIVITY_TOOL[call.name] ?? call.name,
      ...(activityDetail(call.name, call.arg) ? { detail: activityDetail(call.name, call.arg) } : {}),
    },
  });
  // Keep whatever the model SAID; drop only the machine-readable line.
  //
  // The parser accepts prose in front of a call, so a narrating reply matches too — and this used
  // to delete the whole bubble on the assumption that the content was
  // "the model's raw TOOL_CALL: name(args)" and nothing else. That assumption was never checked.
  // If the model narrated before acting ("Mình mở trang trước đã." then the call), the narration
  // was thrown away, which is exactly the symptom we were blaming on the model: a multi-step
  // turn that runs tools, attaches screenshots and says nothing until the end.
  //
  // So: strip the call, keep the words. An empty remainder still removes the bubble, which is
  // the common case and the original's behaviour — a turn that only acts renders nothing.
  //
  // Strip by the EXACT text each call was parsed from (`ToolCall.raw`) rather than by a pattern.
  // A pattern anchored to the end of the reply removes only the last call, leaving the earlier ones
  // rendered to the user as raw `TOOL_CALL:` lines; and a global pattern would have to re-solve the
  // balanced-parenthesis problem the parser already solved.
  const spoken = calls.reduce((text, c) => text.replace(c.raw, ""), textOf(bubble)).trim();
  if (spoken) {
    setText(bubble, spoken);
    if (bubble.kind === "send-message") bubble.streaming = false;
    onUpdate(agentId);
  } else {
    const at = tail(agentId).indexOf(bubble);
    if (at >= 0) tail(agentId).splice(at, 1);
  }
  if (batch.length > 1) runToolBatch(agentId, batch.map((c) => ({ name: c.name, arg: c.arg })), history);
  else injectTool(agentId, `${call.name} ${call.arg}`, history);
}

/**
 * How many tools one user message may set off.
 *
 * This used to be 1: the follow-up prompt said "không gọi công cụ nữa", so a turn could open a
 * page and then had to stop. The original chains — navigate, screenshot, narrate, click,
 * screenshot, hand the box over — all from a single message, and a one-shot loop cannot
 * reproduce any flow with more than one step in it.
 *
 * Bounded rather than open-ended because each step is a full model round trip, and a model
 * that misreads a tool result can otherwise retry forever. On the last step the instruction
 * goes back to "answer now", so the turn always ends with a reply rather than a silent stop.
 */
const MAX_TOOL_STEPS = 8;
const toolSteps = new Map<string, number>();

/** A fresh user message starts a new budget. */
export const resetToolSteps = (agentId: string): void => { toolSteps.delete(agentId); };

/**
 * P5-2 — run one batch of read-only calls at the same time, then continue the turn ONCE.
 *
 * The turn loop was built around exactly one call per reply: `runTool` continued the turn itself, and
 * `continueAfterTool` fed one name/arg/result triple back. Fanning out therefore needs two things
 * beyond a wider parser — a batch owner that waits for all of them (`onDone` on `runTool`), and a
 * follow-up that carries every result in one message. Without the second, each finished call starts
 * its own turn and the model answers the user once per file it read.
 *
 * Calls are started together and awaited together, so the batch costs the slowest call rather than
 * the sum. Entries are pushed for all of them first, so the outline panel shows the whole fan-out
 * immediately instead of revealing it one row at a time.
 */
function runToolBatch(agentId: string, calls: { name: string; arg: string }[], history?: PoolMessage[]): void {
  // Defence in depth: this path calls `runTool` directly and therefore skips `injectTool`, where the
  // approval gate lives. Nothing side-effecting is supposed to reach here — `planBatches` gives such a
  // call its own batch of one, which routes to `injectTool` instead — but a permission boundary should
  // not rest on a single upstream assumption staying true. Anything that could ask for approval is
  // handed back to `injectTool`, which asks.
  const unsafe = calls.filter((c) => !isParallelSafe(c.name));
  if (unsafe.length) {
    console.warn(`[grokbot2] batch contained ${unsafe.map((c) => c.name).join(", ")} — routing through the approval gate instead`);
    for (const c of unsafe) injectTool(agentId, `${c.name} ${c.arg}`, history);
    calls = calls.filter((c) => isParallelSafe(c.name));
    if (!calls.length) return;
  }
  const t = tail(agentId);
  const results: (string | undefined)[] = new Array(calls.length).fill(undefined);
  let left = calls.length;

  const started = calls.map((c) => {
    const toolCallId = nextToolId();
    t.push({
      id: nextId(), kind: "tool-call", toolCallId, name: c.name, rawArgs: JSON.stringify({ arg: c.arg }),
      summary: `${c.name}(${c.arg})`.slice(0, 160), status: "pending", timestampMs: Date.now(),
    });
    return { ...c, toolCallId };
  });
  onUpdate(agentId);

  for (const [i, c] of started.entries()) {
    runTool(agentId, c.toolCallId, c.name, c.arg, history, (result) => {
      results[i] = result;
      left -= 1;
      if (left > 0 || !history) return;
      continueAfterTools(agentId, history, started.map((s, j) => ({ name: s.name, arg: s.arg, result: results[j] ?? "" })));
    });
  }
}

/** Hand a whole batch of results back in ONE follow-up, in the order the model asked for them. */
function continueAfterTools(agentId: string, history: PoolMessage[], done: { name: string; arg: string; result: string }[]): void {
  if (done.length === 1) {
    continueAfterTool(agentId, history, done[0].name, done[0].arg, done[0].result);
    return;
  }
  const key = loadPoolKey(); if (!key) return;
  const t = tail(agentId);
  const step = (toolSteps.get(agentId) ?? 0) + 1;
  toolSteps.set(agentId, step);
  const last = step >= MAX_TOOL_STEPS;

  const bubble: Entry = { id: nextId(), kind: "send-message", author: authorOf(agentId), message: { type: "text", content: "" }, timestampMs: Date.now(), streaming: true };
  t.push(bubble); onUpdate(agentId);
  const controller = new AbortController();
  inflight.set(agentId, controller);
  void runTurn(agentId, bubble, [
    ...history,
    { role: "assistant", content: done.map((d) => `TOOL_CALL: ${d.name}(${d.arg})`).join("\n") },
    {
      role: "user",
      // Label each result with its own call. A batch of reads comes back as several blocks of text
      // and, unlabelled, the model has to guess which file it is looking at — it guesses wrong.
      content: `${done.map((d) => `Kết quả công cụ ${d.name}(${d.arg}):\n${d.result}`).join("\n\n")}\n` + (last
        ? "Đã dùng đủ số bước công cụ cho lượt này — hãy trả lời người dùng ngay, không gọi công cụ nữa."
        : "Nếu công việc đã xong thì trả lời người dùng. Nếu còn bước tiếp theo, hãy gọi công cụ kế tiếp."),
    },
  ], key, controller);
}

/** Hand the tool result back to the model, which may call another tool or answer. */
function continueAfterTool(agentId: string, history: PoolMessage[], toolName: string, arg: string, result: string): void {
  const key = loadPoolKey(); if (!key) return;
  const t = tail(agentId);
  const step = (toolSteps.get(agentId) ?? 0) + 1;
  toolSteps.set(agentId, step);
  const last = step >= MAX_TOOL_STEPS;

  const bubble: Entry = { id: nextId(), kind: "send-message", author: authorOf(agentId), message: { type: "text", content: "" }, timestampMs: Date.now(), streaming: true };
  t.push(bubble); onUpdate(agentId);
  const controller = new AbortController();
  inflight.set(agentId, controller);
  void runTurn(agentId, bubble, [
    ...history,
    { role: "assistant", content: `TOOL_CALL: ${toolName}(${arg})` },
    {
      role: "user",
      content: `Kết quả công cụ ${toolName}: ${result}\n` + (last
        ? "Đã dùng đủ số bước công cụ cho lượt này — hãy trả lời người dùng ngay, không gọi công cụ nữa."
        : "Nếu công việc đã xong thì trả lời người dùng. Nếu còn bước tiếp theo, hãy gọi công cụ kế tiếp."),
    },
  ], key, controller);
}

/** Run one tool with a real ToolCtx. Exported for the e2e scripts only. */
export function runToolForTest(agentId: string, name: string, arg: string): Promise<string> {
  const fn = TOOLS[name];
  if (!fn) return Promise.resolve(`(no tool ${name})`);
  return Promise.resolve(fn(arg, ctxFor(agentId)));
}



turnHooks.sendPrompt = sendPrompt;
turnHooks.messageAgent = messageAgent;
turnHooks.startSubagentRun = startSubagentRun;
turnHooks.finishSubagentRun = finishSubagentRun;

