/**
 * Shared transcript / roster / tool types. Domain modules import this; they do not
 * re-declare the client's entry contract.
 */
import type { PoolMessage } from "@grokbot2/pool-client";

export interface Reaction { emoji: string; by: string }
export interface Base { id: string; timestampMs: number; reactions?: Reaction[]; seq?: number }
export interface Author { id: string; name: string }

export type TextMsg = { type: "text"; content: string };
/**
 * `action` KHÔNG phải trang trí — thiếu nó thì cả cái thẻ chết.
 *
 * Đo được 28/08 trong app 0.29 đang chạy. Renderer chuyển thẳng `ask.action` xuống IPC của tiến
 * trình main khi người dùng bấm "Allow once":
 *
 *     recordApproval(requestId, ask.action, ask.target)   →  recordLocalToolApproval
 *
 * và main VALIDATE nó. Gọi tay hai lần, chỉ khác đúng trường này:
 *
 *     action=undefined      → NÉM  "recordLocalToolApproval: args.action: must be local tool
 *                                   action, got undefined"
 *     action="run-command"  → OK
 *
 * Lời hứa `n$t(...)` vỡ, `.catch(()=>b({kind:"failed"}))` bắt, và thẻ hiện
 * **"Your answer didn't go through. Check your connection and try again."** — một câu đổ lỗi cho
 * đường truyền trong khi đường truyền không liên quan gì. Bấm bao nhiêu lần cũng thế.
 *
 * Tôi từng đoán sai chỗ này: đoán rằng thẻ thuộc cụm `GrokBotUserComputer` ta cố ý không phục vụ,
 * nên "không sửa được". Sai hoàn toàn — backend của ta chưa bao giờ bị gọi tới, vì lời gọi chết ở
 * trong chính app trước khi ra khỏi renderer. Không có request nào để mà bắt, và đó đúng là lý do
 * lần bắt gói trước không thấy gì.
 *
 * Tập giá trị hợp lệ, nguyên văn bundle 0.29:
 *     ["run-command","send-input","read-file","list-directory","write-file"]
 */
export type LocalToolAction = "run-command" | "send-input" | "read-file" | "list-directory" | "write-file";
export type PermMsg = { type: "local-tool-permission"; ask: { status: "pending" | "approved" | "denied" | "expired"; action: LocalToolAction; target: string; requestId: string } };
export type ApprovalMsg = { type: "auto-review-approval"; approval: { status: "pending" | "approved" | "denied"; summary: string; requestId: string } };
export type ListenerConnectMsg = { type: "listener-connect"; platform: string; reason: string };
export type AttachmentMsg = { type: "attachment"; url: string; file_name: string; alt: string };
export type EmailDraftMsg = { type: "email-draft"; draft: { from?: string; to: string[]; subject: string; body: string } };
export type SlackDraftMsg = { type: "slack-draft"; draft: { workspace?: string; target: string; thread?: string; body: string } };
export type WidgetOption = { label: string; value?: string; description?: string; style?: "default" | "primary" | "danger" };
export type WidgetMsg = {
  type: "widget";
  /**
   * `multiSelect` — 0.29 render thật, ta thì chưa bao giờ gửi.
   *
   * Renderer 0.29: `multiSelect:AM()` trong schema widget, và nhánh vẽ riêng
   * `if(e.multiSelect===!0)return Oon(n).map(…)`. Thiếu trường này thì mọi câu hỏi nhiều-lựa-chọn
   * bị vẽ thành chọn-một — đúng ca "chọn những plugin nào cần cài" của tính năng 2.
   */
  widget: { prompt: string; helpText?: string; options: WidgetOption[]; allowCustom?: boolean; multiSelect?: boolean; dismissOnMoveOn?: boolean };
};

export type TranscriptEvent =
  | { type: "name-changed"; from: string; to: string }
  | { type: "automation-changed"; action: "created" | "updated" | "deleted"; automationId: string; automationName: string };

export type Entry =
  | (Base & { kind: "message"; role: "user" | "assistant"; content: string; clientNonce?: string; isStreaming?: boolean; fromAgent?: { id: string; name: string }; toAgent?: { id: string; name: string; kind: "agent" }; message?: AttachmentMsg; replyTo?: { entryId: string; author: string; excerpt: string } })
  | (Base & { kind: "send-message"; author: Author; boxRequestId?: string; boxInstruction?: string; boxResolution?: "handed_back" | "replied" | "dismissed"; message: TextMsg | PermMsg | ApprovalMsg | AttachmentMsg | WidgetMsg | EmailDraftMsg | SlackDraftMsg | ListenerConnectMsg; streaming?: boolean; respondedValue?: string; respondedValueEchoed?: boolean; widgetDismissed?: boolean; widgetSkipped?: boolean })
  | (Base & { kind: "tool-call"; toolCallId: string; name: string; rawArgs: string; summary?: string; status: "pending" | "running" | "done" | "failed"; result?: string })
  | (Base & { kind: "event"; event: TranscriptEvent })
  /**
   * Lời hệ thống trong dòng hội thoại — không phải người nói, cũng không phải bot nói.
   *
   * Renderer 0.29 biết vẽ sẵn: `case"notice":return{role:"note",timestampMs:Zp(t)}`, và khoá vẽ lại
   * là `${t.id}:${t.text.length}`. Nó nằm trong danh sách kind chuẩn của renderer
   * (`["message","tool-call","send-message","user-attachment","notice","event"]`) — ta chỉ chưa
   * bao giờ phát. Trước đó mọi thông báo hệ thống phải giả dạng lời của bot, tức gán cho bot một
   * câu nó không nói.
   */
  | (Base & { kind: "notice"; text: string; replyTo?: { entryId: string; author: string; excerpt: string } })
  /**
   * File NGƯỜI DÙNG gửi, ở dạng entry gốc (không phải đính kèm bên trong lời của bot).
   *
   * Renderer 0.29: `if(t.kind==="user-attachment")return{path:t.file_path,name:t.file_name}` và
   * `t.kind==="user-attachment"?"user":…` — tức nó được vẽ về phía NGƯỜI. Tên trường là
   * `file_path`/`file_name` (snake_case), không phải camelCase.
   */
  | (Base & { kind: "user-attachment"; file_path: string; file_name: string; replyTo?: { entryId: string; author: string; excerpt: string } });

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
  /**
   * Nhóm — một hội thoại có nhiều bot cùng ngồi.
   *
   * Client vẽ nhóm bằng chính hai trường này, đọc từ bản dựng 0.20:
   *   `n.isGroup` quyết định biểu tượng và nhánh "group" của roster
   *   `rows.find(r => r.id === id)?.memberIds` là danh sách thành viên
   * Nên nhóm KHÔNG phải một bảng riêng: nó là một agent mang thêm hai trường, và `summarise` trải
   * `...a` nên chúng tự chảy ra roster.
   */
  isGroup?: boolean;
  memberIds?: string[];
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
  ask(widget: { prompt: string; helpText?: string; options: WidgetOption[]; allowCustom?: boolean; multiSelect?: boolean; dismissOnMoveOn?: boolean }): string | null;
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
  /**
   * Client 0.29 đính cờ này vào `sendPrompt` — và backend này từng bỏ qua nó hoàn toàn.
   *
   * Bằng chứng là payload client THẬT bắt được: `.data/coverage.json` → `lastArgs.sendPrompt` mang
   * `"directAddressedAcceptance": true` cạnh `agentId`/`prompt`/`clientNonce`. Trong bundle 0.29 nó
   * nằm đúng chỗ dựng đối số `sendPrompt` (`node-agent-coordinator/main.cjs`).
   *
   * Nghĩa quan sát được: người dùng gõ THẲNG vào hộp thoại của bot này. Mẫu bắt được là hội thoại
   * 1:1, nên đây là tất cả những gì đo được — **không** suy ra luật chọn người nói trong phòng từ
   * một mẫu. Luật thật của hãng chạy trong workflow Temporal phía server, không có trong client
   * (xem docs/extracted/0-29-mapping.md §0.3).
   */
  directAddressedAcceptance?: boolean;
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
