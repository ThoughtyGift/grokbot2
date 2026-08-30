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
/**
 * Thẻ bot tự soát rồi xin duyệt — hình dạng trích từ transcript thật của app gốc:
 *
 *     {"type":"auto-review-approval","approval":{"requestId":"16bce518-…","surface":"computer",
 *       "summary":"Open “…/pricing” in the box browser","reason":"The navigation targets…",
 *       "status":"approved","proposedRule":"Navigate to pages within https://cinai.tv/ …"}}
 *
 * Renderer 0.29 chỉ đọc `requestId`, `status`, `summary`; `proposedRule` xuất hiện 0 lần trong
 * bundle. Ba trường sau vẫn gửi vì chúng giải thích quyết định — xem `postAutoReview`.
 */
export type ApprovalMsg = {
  type: "auto-review-approval";
  approval: {
    status: "pending" | "approved" | "denied";
    summary: string;
    requestId: string;
    surface?: string;
    reason?: string;
    proposedRule?: string;
  };
};
export type ListenerConnectMsg = { type: "listener-connect"; platform: string; reason: string };
/**
 * Tệp đính kèm trong bản ghi.
 *
 * `width`/`height` trích từ transcript THẬT của app gốc, không đoán — nó gửi video kèm kích thước:
 *
 *     {"type":"attachment",
 *      "url":"file:///home/box/sand-data/agents/<id>/attachments/<sha256>.mp4",
 *      "file_name":"2026-08-30_20-07-57.mp4","width":1280,"height":800}
 *
 * Tuỳ chọn vì ảnh do `stageImage` đo được kích thước từ bytes, còn video thì phải hỏi ffprobe —
 * và một thẻ không có kích thước vẫn vẽ được, chỉ là khung hình nhảy một nhịp khi tải xong.
 */
export type AttachmentMsg = { type: "attachment"; url: string; file_name: string; alt: string; width?: number; height?: number };
export type EmailDraftMsg = { type: "email-draft"; draft: { from?: string; to: string[]; subject: string; body: string } };
export type SlackDraftMsg = { type: "slack-draft"; draft: { workspace?: string; target: string; thread?: string; body: string } };
/**
 * Xin một giá trị BÍ MẬT — thẻ `secret-request` của 0.29/0.30.
 *
 * Trích từ chunk vẽ thẻ (`cards/send-message/secret-request/view.tsx`), không đoán:
 *
 *     entry.message.secretRequest.label          ← BẮT BUỘC, renderer đọc `.label.length` không guard
 *     entry.message.secretRequest.description    ← `!= null` mới vẽ dòng phụ, nên "" là một dòng trống
 *     entry.secretProvided === true              ← vẽ thẻ "đã lưu" thay cho ô nhập
 *
 * Ô nhập là `type="password"`, `autoComplete="off"`, và nhãn chính là placeholder.
 */
export type SecretRequestMsg = {
  type: "secret-request";
  secretRequest: { label: string; description?: string };
};

/** Một ô trong biểu mẫu. `type` quyết định thuộc tính `<input>` — xem bảng trong `postUserForm`. */
export type FormField = {
  id: string;
  label: string;
  type?: "text" | "email" | "tel" | "password" | "otp" | "number" | "date";
  placeholder?: string;
  required?: boolean;
  secret?: boolean;
  options?: { value: string; label: string }[];
};

/**
 * Biểu mẫu nhiều ô — thẻ `user-form`.
 *
 * `title` và `fields` BẮT BUỘC: renderer đọc `.title.length` và `.fields.length` không guard, nên
 * thiếu một trong hai là nó ném giữa lúc vẽ và error boundary nuốt cả cột phải.
 *
 * `liveHost`/`domain` dựng origin `https://<host>/` để thẻ nói rõ đang điền cho trang nào.
 */
export type UserFormMsg = {
  type: "user-form";
  formRequest: {
    title: string;
    instruction?: string;
    fields: FormField[];
    liveHost?: string;
    domain?: string;
  };
};

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
  | (Base & { kind: "send-message"; author: Author; boxRequestId?: string; boxInstruction?: string; boxResolution?: "handed_back" | "replied" | "dismissed"; message: TextMsg | PermMsg | ApprovalMsg | AttachmentMsg | WidgetMsg | EmailDraftMsg | SlackDraftMsg | ListenerConnectMsg | SecretRequestMsg | UserFormMsg; streaming?: boolean; respondedValue?: string; respondedValueEchoed?: boolean; widgetDismissed?: boolean; widgetSkipped?: boolean;
      /** Đã gửi bí mật chưa — renderer dùng để vẽ thẻ "đã lưu" thay cho ô nhập. Giá trị KHÔNG lưu. */
      secretProvided?: boolean;
      /** Trạng thái biểu mẫu; `!= null` thì renderer vẽ thẻ đã xong, không vẽ form nữa. */
      formResolution?: "sending" | "submitted" | "fill_failed" | "escalated" })
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
  | (Base & {
      kind: "user-attachment"; file_path: string; file_name: string;
      /*
       * `width`/`height`/`byteSize` — trích từ transcript THẬT của app gốc:
       *
       *     {"kind":"user-attachment","id":"t8ua0","file_path":"/home/box/…/<sha256>.png",
       *      "file_name":"image.png","width":1920,"height":1078,"byteSize":520543,
       *      "batchId":"…","clientNonce":"…"}
       *
       * Renderer đọc chúng khi dựng thư viện ảnh của hội thoại:
       *
       *     case "user-attachment":
       *       ag(a.file_path) && i.addImage(a.file_path, a.width ?? null, a.height ?? null, a.file_name)
       *
       * `?? null` nên thiếu vẫn vẽ được — nhưng có thì khung ảnh không nhảy một nhịp lúc tải xong.
       */
      width?: number; height?: number; byteSize?: number;
      batchId?: string; clientNonce?: string;
      replyTo?: { entryId: string; author: string; excerpt: string };
    });

export type AgentActivity = { kind: "thinking" } | { kind: "tool"; tool: string; detail?: string };

export interface AgentRecord {
  id: string; name: string; agentOwnerAuthId: string; createdAtMs: number; unread: boolean; hidden: boolean;
  avatarDataUrl?: string; avatarVersion?: string; notificationsEnabled?: boolean; notifyOnUpdates?: boolean;
  description?: string;
  /**
   * Ô "Label" trong Settings của bot — app gốc gọi trường này là `title`.
   *
   * Renderer chỉ DỰNG ô đó khi trường tồn tại: `mq(t) = !t.isGroup && t.title !== void 0`, và ô
   * nhập lấy `initialValue: n.title` với placeholder "Research, marketing, admin" (`Pqtvzz`).
   * `AgentRecord` của ta không có trường này, nên ô Label chưa bao giờ hiện — thấy rõ khi đặt hai
   * ảnh Settings cạnh nhau: app gốc có Name / Label / Description, ta chỉ có Name / Description.
   *
   * Để chuỗi rỗng chứ KHÔNG bỏ trống: `undefined` làm renderer ẩn hẳn ô, còn `""` cho ra một ô
   * trống người dùng gõ được — đó mới là hành vi tương đương.
   */
  title?: string;
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
  /**
   * Xin một giá trị bí mật (`secret-request`). `null` nếu thiếu nhãn — xem `postSecretRequest`.
   *
   * Giá trị người dùng gõ KHÔNG quay lại đây và không vào ngữ cảnh model: tool chỉ biết "đã gửi".
   */
  askSecret(spec: { label: string; description?: string }): string | null;
  /** Hỏi một biểu mẫu nhiều ô (`user-form`). `null` nếu thiếu tiêu đề hoặc không ô nào dùng được. */
  askForm(spec: { title: string; instruction?: string; fields: FormField[]; liveHost?: string; domain?: string }): string | null;
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
  /**
   * Lời nhắc tới được model nhưng KHÔNG hiện thành tin của người dùng trong bản ghi.
   *
   * Cần cho lời tự giới thiệu lúc tạo bot: app gốc chỉ gửi cờ `kickstart_requested` rồi bot nói,
   * bản ghi không có câu hỏi nào cả. Nếu ta dùng `sendPrompt` thường thì bản ghi sẽ mọc ra một câu
   * kiểu "hãy tự giới thiệu" đứng tên NGƯỜI DÙNG — đặt lời vào miệng họ trong chính bản ghi của họ,
   * và bản ghi thì sống mãi.
   */
  silent?: boolean;
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
