/**
 * Shared transcript / roster / tool types. Domain modules import this; they do not
 * re-declare the client's entry contract.
 */
import type { PoolMessage } from "@grokbot2/pool-client";

export interface Reaction { emoji: string; by: string }
export interface Base { id: string; timestampMs: number; reactions?: Reaction[]; seq?: number }
export interface Author { id: string; name: string }

export type TextMsg = { type: "text"; content: string };
export type PermMsg = { type: "local-tool-permission"; ask: { status: "pending" | "approved" | "denied" | "expired"; target: string; requestId: string } };
export type ApprovalMsg = { type: "auto-review-approval"; approval: { status: "pending" | "approved" | "denied"; summary: string; requestId: string } };
export type ListenerConnectMsg = { type: "listener-connect"; platform: string; reason: string };
export type AttachmentMsg = { type: "attachment"; url: string; file_name: string; alt: string };
export type EmailDraftMsg = { type: "email-draft"; draft: { from?: string; to: string[]; subject: string; body: string } };
export type SlackDraftMsg = { type: "slack-draft"; draft: { workspace?: string; target: string; thread?: string; body: string } };
export type WidgetOption = { label: string; value?: string; description?: string; style?: "default" | "primary" | "danger" };
export type WidgetMsg = {
  type: "widget";
  widget: { prompt: string; helpText?: string; options: WidgetOption[]; allowCustom?: boolean; dismissOnMoveOn?: boolean };
};

export type TranscriptEvent =
  | { type: "name-changed"; from: string; to: string }
  | { type: "automation-changed"; action: "created" | "updated" | "deleted"; automationId: string; automationName: string };

export type Entry =
  | (Base & { kind: "message"; role: "user" | "assistant"; content: string; clientNonce?: string; isStreaming?: boolean; fromAgent?: { id: string; name: string }; toAgent?: { id: string; name: string; kind: "agent" }; message?: AttachmentMsg; replyTo?: { entryId: string; author: string; excerpt: string } })
  | (Base & { kind: "send-message"; author: Author; boxRequestId?: string; boxInstruction?: string; boxResolution?: "handed_back" | "replied" | "dismissed"; message: TextMsg | PermMsg | ApprovalMsg | AttachmentMsg | WidgetMsg | EmailDraftMsg | SlackDraftMsg | ListenerConnectMsg; streaming?: boolean; respondedValue?: string; respondedValueEchoed?: boolean; widgetDismissed?: boolean; widgetSkipped?: boolean })
  | (Base & { kind: "tool-call"; toolCallId: string; name: string; rawArgs: string; summary?: string; status: "pending" | "running" | "done" | "failed"; result?: string })
  | (Base & { kind: "event"; event: TranscriptEvent });

export type AgentActivity = { kind: "thinking" } | { kind: "tool"; tool: string; detail?: string };

export interface AgentRecord {
  id: string; name: string; agentOwnerAuthId: string; createdAtMs: number; unread: boolean; hidden: boolean;
  avatarDataUrl?: string; avatarVersion?: string; notificationsEnabled?: boolean; notifyOnUpdates?: boolean;
  description?: string;
  isRunning?: boolean;
  isComposingMessage?: boolean;
  isRetrying?: boolean;
  awaitingUserResponse?: unknown;
  currentActivity?: AgentActivity | null;
}

export interface Parked {
  kind: "approval" | "widget" | "handoff";
  key: string;
  agentId: string;
  history?: PoolMessage[];
  entryId?: string;
  toolCallId?: string;
  name?: string;
  arg?: string;
}

export interface ToolCtx {
  attach(dataUrl: string, fileName: string, alt: string): void;
  /**
   * Show this picture to the MODEL on the follow-up turn, not only to the person.
   *
   * `attach` puts an image in the transcript, which is where the user sees it — and that is all it
   * ever did. The model's next turn is built from text, so a tool that answered with a screenshot
   * was talking to the room and not to the model: it read "đã chụp màn hình 1920x1080" and nothing
   * else. Measured on a real box, the bot said so itself — "ảnh chụp trả về nhưng mình không nhận
   * được nội dung hình để đọc".
   *
   * Only for tools whose whole point is that the model looks. The pool carries one picture per
   * request, so the last call before the follow-up wins.
   */
  see(dataUrl: string): void;
  ask(widget: { prompt: string; helpText?: string; options: WidgetOption[]; allowCustom?: boolean; dismissOnMoveOn?: boolean }): string | null;
  note(text: string): void;
  requestBoxHelp(instruction: string): Promise<string>;
  agentId: string;
  draft(message: EmailDraftMsg | SlackDraftMsg): void;
}

export interface SendArgs {
  agentId?: string; content?: string; prompt?: string; text?: string; richText?: { text?: string };
  clientNonce?: string; attachments?: { path?: string; name?: string }[];
  attachmentPaths?: string[]; attachmentNames?: string[];
  fromAgent?: { id: string; name: string };
  /** Native FE: write tools ask even if the stock app stored localToolPermission=always. */
  askWriteTools?: boolean;
  /** X6.3: entry được trả lời. Backend tra tên + trích đoạn từ transcript, caller chỉ gửi id. */
  replyToEntryId?: string;
}

export interface SubagentRow {
  subagentId: string;
  subagentType: string;
  title: string;
  status: "running" | "done" | "aborted" | "error";
  startedAtMs: number;
}

export interface AcceptanceRecord {
  accountSlot: string; clientNonce: string; status: "pending" | "accepted" | "rejected";
  acceptedAtMs: number; agentId: string; echoEntryId: string | null; rejectionCode: string | null;
}

export interface Todo { text: string; done: boolean }

export type LastEntry =
  | { kind: "text"; text: string }
  | { kind: "attachment"; count: number; kinds: { kind: string; count: number }[] }
  | { kind: "link"; url: string };

export type RosterRow = AgentRecord & Record<string, unknown>;
