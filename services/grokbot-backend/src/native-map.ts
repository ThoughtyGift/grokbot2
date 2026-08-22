/**
 * Domain transcript/roster → OpenAPI v0 shapes (`docs/api/grokbot2-v0.yaml`).
 *
 * The native FE must not see Cursor dialect kinds (`send-message`). Mapping lives here so the
 * HTTP adapter stays a router. `ask_question` is a grokbot2 `widget` kind (prompt + buttons),
 * not a flattened agent-message.
 */
import type { AgentRecord, Entry, LastEntry, RosterRow } from "./conversation/types.js";
import { textOf } from "./conversation/seq.js";

export type NativeAttachment = {
  path: string;
  name: string;
  href: string;
};

export const attachmentHref = (path: string): string =>
  `/v1/attachments?path=${encodeURIComponent(path)}`;

function nativeAttachment(url: string, name: string): NativeAttachment {
  return { path: url, name, href: attachmentHref(url) };
}

export type NativeWidgetOption = {
  label: string;
  value?: string;
  description?: string;
  style?: "default" | "primary" | "danger";
};

export type NativeWidget = {
  prompt: string;
  helpText?: string;
  options: NativeWidgetOption[];
  allowCustom?: boolean;
};

export type NativeEntry = {
  id: string;
  seq: number;
  timestampMs: number;
  kind: "message" | "agent-message" | "tool-call" | "event" | "widget";
  reactions?: { emoji: string; by: string }[];
  isStreaming?: boolean;
  role?: "user";
  content?: string;
  clientNonce?: string;
  author?: { id: string; name: string };
  attachment?: NativeAttachment;
  toolCallId?: string;
  requestId?: string;
  needsApproval?: boolean;
  name?: string;
  rawArgs?: string;
  summary?: string;
  status?: "pending" | "running" | "done" | "failed";
  result?: string;
  event?: { type: string; [k: string]: unknown };
  widget?: NativeWidget;
  respondedValue?: string;
};

export type NativeAgent = {
  id: string;
  name: string;
  description: string;
  createdAtMs: number;
  updatedAtMs: number;
  unread: boolean;
  hidden: boolean;
  avatarVersion: string | null;
  notificationsEnabled: boolean;
  notifyOnUpdates: boolean;
  presence: {
    isRunning: boolean;
    isComposingMessage: boolean;
    isRetrying: boolean;
    currentActivity: AgentRecord["currentActivity"];
  };
  lastEntry: LastEntry | null;
};

export type NativeTranscriptPage = {
  entries: NativeEntry[];
  hasMore: boolean;
};

const seqOf = (e: Entry): number => (typeof e.seq === "number" && e.seq >= 1 ? e.seq : 1);

export function toNativeEntry(e: Entry): NativeEntry {
  const base = {
    id: e.id,
    seq: seqOf(e),
    timestampMs: e.timestampMs,
    ...(e.reactions?.length ? { reactions: e.reactions } : {}),
  };

  if (e.kind === "message") {
    const attachment = e.message?.type === "attachment" ? e.message : undefined;
    const att = attachment?.url
      ? nativeAttachment(attachment.url, attachment.file_name || attachment.alt || "")
      : undefined;
    const content = e.content || (attachment ? (attachment.file_name || attachment.alt || "") : "");
    if (e.role === "user") {
      return {
        ...base,
        kind: "message",
        role: "user",
        content,
        ...(e.clientNonce ? { clientNonce: e.clientNonce } : {}),
        ...(e.isStreaming ? { isStreaming: true } : {}),
        ...(att ? { attachment: att } : {}),
      };
    }
    return {
      ...base,
      kind: "agent-message",
      author: e.fromAgent ?? { id: "assistant", name: "Claude" },
      content,
      ...(att ? { attachment: att } : {}),
    };
  }

  if (e.kind === "tool-call") {
    return {
      ...base,
      kind: "tool-call",
      toolCallId: e.toolCallId,
      name: e.name,
      rawArgs: e.rawArgs,
      ...(e.summary ? { summary: e.summary } : {}),
      status: e.status,
      ...(e.result != null ? { result: e.result } : {}),
    };
  }

  if (e.kind === "event") {
    return { ...base, kind: "event", event: e.event };
  }

  if (e.message.type === "text") {
    return {
      ...base,
      kind: "agent-message",
      author: e.author,
      content: e.message.content,
      ...(e.streaming ? { isStreaming: true } : {}),
    };
  }

  if (e.message.type === "local-tool-permission") {
    const st = e.message.ask.status;
    return {
      ...base,
      kind: "tool-call",
      toolCallId: e.message.ask.requestId,
      requestId: e.message.ask.requestId,
      needsApproval: true,
      name: e.message.ask.target,
      rawArgs: "",
      summary: `permission: ${e.message.ask.target}`,
      status: st === "pending" ? "pending" : st === "approved" ? "done" : "failed",
    };
  }

  if (e.message.type === "auto-review-approval") {
    const st = e.message.approval.status;
    return {
      ...base,
      kind: "tool-call",
      toolCallId: e.message.approval.requestId,
      name: "auto-review",
      rawArgs: "",
      summary: e.message.approval.summary,
      status: st === "pending" ? "pending" : st === "approved" ? "done" : "failed",
    };
  }

  if (e.message.type === "attachment") {
    const att = e.message.url
      ? nativeAttachment(e.message.url, e.message.file_name || e.message.alt || "")
      : undefined;
    return {
      ...base,
      kind: "agent-message",
      author: e.author,
      content: e.message.file_name || e.message.alt || e.message.url,
      ...(att ? { attachment: att } : {}),
    };
  }

  if (e.message.type === "widget") {
    const w = e.message.widget;
    return {
      ...base,
      kind: "widget",
      author: e.author,
      content: w.prompt,
      widget: {
        prompt: w.prompt,
        options: w.options.map((o) => ({
          label: o.label,
          ...(o.value != null ? { value: o.value } : {}),
          ...(o.description ? { description: o.description } : {}),
          ...(o.style ? { style: o.style } : {}),
        })),
        ...(w.helpText ? { helpText: w.helpText } : {}),
        ...(w.allowCustom ? { allowCustom: true } : {}),
      },
      ...(e.respondedValue != null ? { respondedValue: e.respondedValue } : {}),
    };
  }

  return {
    ...base,
    kind: "agent-message",
    author: e.author,
    content: textOf(e) || e.message.type,
  };
}

export function toNativeAgent(a: RosterRow | AgentRecord): NativeAgent {
  const row = a as RosterRow;
  const updatedAt = typeof row.updatedAt === "number" ? row.updatedAt : a.createdAtMs;
  const last = (row.lastEntry as LastEntry | null | undefined) ?? null;
  return {
    id: a.id,
    name: a.name,
    description: a.description ?? "",
    createdAtMs: a.createdAtMs,
    updatedAtMs: updatedAt,
    unread: a.unread === true,
    hidden: a.hidden === true,
    avatarVersion: a.avatarVersion ?? null,
    notificationsEnabled: a.notificationsEnabled === true,
    notifyOnUpdates: a.notifyOnUpdates !== false,
    presence: {
      isRunning: a.isRunning === true,
      isComposingMessage: a.isComposingMessage === true,
      isRetrying: a.isRetrying === true,
      currentActivity: a.currentActivity ?? null,
    },
    lastEntry: last,
  };
}

export function toNativeTranscriptPage(entries: Entry[], hasMore: boolean): NativeTranscriptPage {
  const skip = new Set<string>();
  const requestFor = new Map<string, { requestId: string; perm: "pending" | "approved" | "denied" | "expired" }>();
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e.kind !== "send-message" || e.message.type !== "local-tool-permission") continue;
    for (let j = i - 1; j >= 0; j--) {
      const prev = entries[j];
      if (prev.kind === "message" && prev.role === "user") break;
      if (prev.kind === "tool-call") {
        requestFor.set(prev.id, { requestId: e.message.ask.requestId, perm: e.message.ask.status });
        skip.add(e.id);
        break;
      }
    }
  }
  const mapped = entries.filter((e) => !skip.has(e.id)).map((e) => {
    const n = toNativeEntry(e);
    if (e.kind !== "tool-call") return n;
    const extra = requestFor.get(e.id);
    if (!extra) return n;
    n.requestId = extra.requestId;
    n.needsApproval = true;
    if (extra.perm === "pending") n.status = "pending";
    else if (extra.perm === "denied") n.status = "failed";
    return n;
  });
  return { entries: mapped, hasMore };
}
