/**
 * Hợp đồng `/v1` — **một** định nghĩa, ba chỗ dùng.
 *
 *   BE  → validate đầu vào ở biên, và kiểu cho `toNative*`
 *   FE  → `import type`, không tốn một byte runtime nào
 *   docs → sinh `docs/api/grokbot2-v0.yaml`
 *
 * ── Vì sao package này tồn tại ────────────────────────────────────────────────
 *
 * Trước hôm nay hợp đồng chỉ sống trong `native-map.ts`, và FE **tự khai lại**. Hai bản đã lệch
 * nhau thật, đo được 2026-08-22:
 *
 *   | trường                  | BE                        | FE (tự khai)        |
 *   |-------------------------|---------------------------|---------------------|
 *   | createdAtMs/updatedAtMs | bắt buộc                  | tuỳ chọn            |
 *   | presence                | 4 trường                  | 2 trường            |
 *   | notificationsEnabled    | có                        | KHÔNG có            |
 *   | notifyOnUpdates         | có                        | KHÔNG có            |
 *   | role                    | có (`"user"`)             | KHÔNG có            |
 *   | rawArgs                 | có                        | KHÔNG có            |
 *   | lastEntry               | union 3 nhánh             | `{kind, text?}` đoán |
 *
 * FE làm việc trên một **tập con đoán được**. Nó chạy, vì FE chỉ đọc những gì nó biết — nhưng thêm
 * một trường ở BE thì FE không bao giờ thấy, và bỏ một trường thì FE hỏng lúc chạy chứ không hỏng
 * lúc typecheck. Đó là loại nợ chỉ lộ ra vào lúc tệ nhất.
 *
 * Dùng TypeBox chứ không phải "kiểu TS + một JSON Schema viết tay": hai artifact thì lại trôi khỏi
 * nhau, đúng bệnh mà file này chữa. TypeBox cho **một** khai báo, ra cả kiểu tĩnh (`Static<>`) lẫn
 * JSON Schema chạy được.
 */
import { type Static, Type } from "@sinclair/typebox";

// ── nguyên tử ────────────────────────────────────────────────────────────────

export const Author = Type.Object({
  id: Type.String(),
  name: Type.String(),
});

export const Attachment = Type.Object({
  path: Type.String(),
  name: Type.String(),
  href: Type.String(),
});

export const Reaction = Type.Object({
  emoji: Type.String(),
  /** `"me"` là chủ máy. Bot cũng react được, nên đây là id, không phải cờ boolean. */
  by: Type.String(),
});

/**
 * Dòng xem trước trong roster. **Union, không phải một hình dạng** — FE từng đoán nó là
 * `{kind, text?}` nên nhánh `attachment` và `link` render sai.
 */
export const LastEntry = Type.Union([
  Type.Object({ kind: Type.Literal("text"), text: Type.String() }),
  Type.Object({
    kind: Type.Literal("attachment"),
    count: Type.Integer(),
    kinds: Type.Array(Type.Object({ kind: Type.String(), count: Type.Integer() })),
  }),
  Type.Object({ kind: Type.Literal("link"), url: Type.String() }),
]);

export const Activity = Type.Object({
  kind: Type.String(),
  tool: Type.Optional(Type.String()),
});

export const Presence = Type.Object({
  isRunning: Type.Boolean(),
  isComposingMessage: Type.Boolean(),
  isRetrying: Type.Boolean(),
  currentActivity: Type.Union([Activity, Type.Null()]),
});

// ── tài nguyên ───────────────────────────────────────────────────────────────

export const Agent = Type.Object({
  id: Type.String({ pattern: "^agent-[0-9]+$" }),
  name: Type.String(),
  description: Type.String(),
  createdAtMs: Type.Integer(),
  updatedAtMs: Type.Integer(),
  unread: Type.Boolean(),
  hidden: Type.Boolean(),
  /** `null` ⇒ chưa có ảnh; chuỗi là bản để ghim cache (`?v=`). */
  avatarVersion: Type.Union([Type.String(), Type.Null()]),
  notificationsEnabled: Type.Boolean(),
  notifyOnUpdates: Type.Boolean(),
  presence: Presence,
  lastEntry: Type.Union([LastEntry, Type.Null()]),
});

/**
 * Event trong transcript — **union hai nhánh**, không phải `{type: string}` mở.
 *
 * Bản đầu tôi viết `{type}` với `additionalProperties: true`. Nó *chạy*, nhưng nói sai: FE đọc
 * `event.from` / `event.to` để render "đổi tên A → B", và với hợp đồng mở thì hai trường đó không
 * được hứa ở đâu cả — typecheck FE đỏ ngay khi dùng chung kiểu. Đúng loại nợ mà package này sinh ra
 * để trả: hợp đồng phải hứa những gì client thật sự đọc.
 */
export const TranscriptEvent = Type.Union([
  Type.Object({
    type: Type.Literal("name-changed"),
    from: Type.String(),
    to: Type.String(),
  }),
  Type.Object({
    type: Type.Literal("automation-changed"),
    action: Type.Union([Type.Literal("created"), Type.Literal("updated"), Type.Literal("deleted")]),
    automationId: Type.String(),
    automationName: Type.String(),
  }),
]);

export const WidgetOption = Type.Object({
  label: Type.String(),
  value: Type.Optional(Type.String()),
  description: Type.Optional(Type.String()),
  style: Type.Optional(Type.Union([
    Type.Literal("default"), Type.Literal("primary"), Type.Literal("danger"),
  ])),
});

export const Widget = Type.Object({
  prompt: Type.String(),
  helpText: Type.Optional(Type.String()),
  options: Type.Array(WidgetOption),
  allowCustom: Type.Optional(Type.Boolean()),
});

/**
 * Một dòng trong transcript.
 *
 * Cố ý là **một object có nhiều trường tuỳ chọn**, không phải union theo `kind`. Union sẽ đúng hơn
 * về mặt kiểu, nhưng đây là hợp đồng đã chạy: đổi sang union là đổi hình dạng JSON mà FE và app
 * đang đọc. Ghi lại để người sau biết đó là lựa chọn, không phải thiếu sót.
 */
export const Entry = Type.Object({
  id: Type.String(),
  seq: Type.Integer({ minimum: 1 }),
  timestampMs: Type.Integer(),
  kind: Type.Union([
    Type.Literal("message"), Type.Literal("agent-message"),
    Type.Literal("tool-call"), Type.Literal("event"), Type.Literal("widget"),
  ]),
  reactions: Type.Optional(Type.Array(Reaction)),
  isStreaming: Type.Optional(Type.Boolean()),
  role: Type.Optional(Type.Literal("user")),
  content: Type.Optional(Type.String()),
  clientNonce: Type.Optional(Type.String()),
  author: Type.Optional(Author),
  attachment: Type.Optional(Attachment),
  toolCallId: Type.Optional(Type.String()),
  requestId: Type.Optional(Type.String()),
  needsApproval: Type.Optional(Type.Boolean()),
  name: Type.Optional(Type.String()),
  rawArgs: Type.Optional(Type.String()),
  summary: Type.Optional(Type.String()),
  status: Type.Optional(Type.Union([
    Type.Literal("pending"), Type.Literal("running"),
    Type.Literal("done"), Type.Literal("failed"),
  ])),
  result: Type.Optional(Type.String()),
  event: Type.Optional(TranscriptEvent),
  widget: Type.Optional(Widget),
  respondedValue: Type.Optional(Type.String()),
});

export const TranscriptPage = Type.Object({
  entries: Type.Array(Entry),
  hasMore: Type.Boolean(),
});

export const ComputerStatus = Type.Object({
  agentId: Type.String(),
  state: Type.Union([Type.Literal("running"), Type.Literal("off")]),
  vncUrl: Type.Optional(Type.String()),
  /** Phân biệt "chưa cấu hình màn hình" với "đã cấu hình mà không ai đang dùng". */
  screenConfigured: Type.Optional(Type.Boolean()),
});

export const SidebarSection = Type.Object({
  id: Type.String(),
  name: Type.String(),
  agentIds: Type.Array(Type.String()),
});

export const Session = Type.Object({ token: Type.String() });
export const ErrorBody = Type.Object({ error: Type.String() });

// ── thân request ─────────────────────────────────────────────────────────────

export const CreateAgentBody = Type.Object({
  name: Type.Optional(Type.String()),
  description: Type.Optional(Type.String()),
});

export const PatchAgentBody = Type.Object({
  name: Type.Optional(Type.String()),
  description: Type.Optional(Type.String()),
  unread: Type.Optional(Type.Boolean()),
  hidden: Type.Optional(Type.Boolean()),
  notificationsEnabled: Type.Optional(Type.Boolean()),
  notifyOnUpdates: Type.Optional(Type.Boolean()),
});

export const TurnBody = Type.Object({
  content: Type.Optional(Type.String()),
  clientNonce: Type.Optional(Type.String()),
  attachments: Type.Optional(Type.Array(Type.Object({
    path: Type.String(),
    name: Type.Optional(Type.String()),
  }))),
});

export const AvatarBody = Type.Object({
  dataUrl: Type.Optional(Type.String()),
  pngBase64: Type.Optional(Type.String()),
});

export const ReactionBody = Type.Object({ emoji: Type.String({ minLength: 1 }) });

export const PermissionBody = Type.Object({
  requestId: Type.String(),
  approved: Type.Boolean(),
});

export const WidgetReplyBody = Type.Object({
  entryId: Type.String(),
  value: Type.String(),
});

// ── kiểu suy ra ──────────────────────────────────────────────────────────────

export type Author = Static<typeof Author>;
export type Attachment = Static<typeof Attachment>;
export type Reaction = Static<typeof Reaction>;
export type LastEntry = Static<typeof LastEntry>;
export type Activity = Static<typeof Activity>;
export type Presence = Static<typeof Presence>;
export type Agent = Static<typeof Agent>;
export type TranscriptEvent = Static<typeof TranscriptEvent>;
export type WidgetOption = Static<typeof WidgetOption>;
export type Widget = Static<typeof Widget>;
export type Entry = Static<typeof Entry>;
export type TranscriptPage = Static<typeof TranscriptPage>;
export type ComputerStatus = Static<typeof ComputerStatus>;
export type SidebarSection = Static<typeof SidebarSection>;
export type Session = Static<typeof Session>;
export type CreateAgentBody = Static<typeof CreateAgentBody>;
export type PatchAgentBody = Static<typeof PatchAgentBody>;
export type TurnBody = Static<typeof TurnBody>;
export type AvatarBody = Static<typeof AvatarBody>;
export type ReactionBody = Static<typeof ReactionBody>;
export type PermissionBody = Static<typeof PermissionBody>;
export type WidgetReplyBody = Static<typeof WidgetReplyBody>;

/**
 * Bảng route — nguồn để sinh OpenAPI.
 *
 * Để ở đây, cạnh schema, chứ không để trong file sinh: một route thêm vào `native.ts` mà quên thêm
 * ở đây thì OpenAPI thiếu route đó và **không ai biết**. Ở cạnh nhau thì lúc sửa schema là lúc nhìn
 * thấy bảng này.
 */
/**
 * Bố cục người dùng tự chỉnh — bề rộng sidebar, panel phải, và trạng thái gập.
 *
 * Giới hạn ở đây KHÔNG phải số chọn bừa: chúng là ngưỡng đo được trên app gốc bằng
 * `x-ray --drag` (sidebar: hàng bot 63–375px; panel phải: 280–480px, và kéo quá mức tối thiểu thì
 * panel đóng hẳn chứ không kẹp lại). Kẹp ở backend chứ không chỉ ở FE: một client hỏng ghi
 * `sidebarWidth: 5000` xuống thì lần mở sau app không dùng được, mà người dùng không hiểu vì sao.
 */
export const UiPrefs = Type.Object({
  sidebarWidth: Type.Optional(Type.Integer({ minimum: 88, maximum: 400 })),
  sidebarCollapsed: Type.Optional(Type.Boolean()),
  paneWidth: Type.Optional(Type.Integer({ minimum: 280, maximum: 480 })),
  paneOpen: Type.Optional(Type.Boolean()),
});
export type UiPrefs = Static<typeof UiPrefs>;

export const ROUTES = [
  { method: "get", path: "/v1/health", res: Type.Object({ ok: Type.Boolean(), isBusy: Type.Boolean() }), auth: false, summary: "Sống hay không" },
  { method: "get", path: "/v1/session", res: Session, auth: false, summary: "Lấy token cho FE" },
  { method: "get", path: "/v1/agents", res: Type.Array(Agent), summary: "Danh sách bot", query: ["includeHidden", "q"] },
  { method: "post", path: "/v1/agents", req: CreateAgentBody, res: Type.Object({ agent: Agent, transcript: TranscriptPage }), summary: "Tạo bot" },
  { method: "get", path: "/v1/agents/{id}", res: Agent, summary: "Một bot" },
  { method: "patch", path: "/v1/agents/{id}", req: PatchAgentBody, res: Agent, summary: "Sửa bot" },
  { method: "delete", path: "/v1/agents/{id}", summary: "Xoá bot" },
  { method: "get", path: "/v1/agents/{id}/transcript", res: TranscriptPage, summary: "Transcript, phân trang bằng beforeSeq", query: ["limit", "beforeSeq"] },
  { method: "post", path: "/v1/agents/{id}/turns", req: TurnBody, res: TranscriptPage, summary: "Gửi một lượt" },
  { method: "get", path: "/v1/agents/{id}/computer", res: ComputerStatus, summary: "Trạng thái màn hình bot" },
  { method: "get", path: "/v1/agents/{id}/avatar", summary: "Ảnh avatar (bytes)", query: ["v"] },
  { method: "put", path: "/v1/agents/{id}/avatar", req: AvatarBody, res: Agent, summary: "Đặt avatar" },
  { method: "delete", path: "/v1/agents/{id}/avatar", summary: "Về avatar mặc định" },
  { method: "post", path: "/v1/agents/{id}/entries/{entryId}/reactions", req: ReactionBody, res: Entry, summary: "Bật/tắt một reaction" },
  { method: "post", path: "/v1/agents/{id}/permissions", req: PermissionBody, summary: "Cho phép / từ chối một tool call" },
  { method: "post", path: "/v1/agents/{id}/widgets", req: WidgetReplyBody, summary: "Trả lời một widget" },
  { method: "get", path: "/v1/host/sidebar", res: Type.Object({ sections: Type.Array(SidebarSection) }), summary: "Nhóm sidebar" },
  { method: "get", path: "/v1/host/settings", res: Type.Object({ ui: UiPrefs }), summary: "Bố cục của chính người đang đăng nhập" },
  { method: "patch", path: "/v1/host/settings", req: UiPrefs, res: Type.Object({ ui: UiPrefs }), summary: "Ghi bố cục, kẹp theo ngưỡng đo được ở app gốc" },
  { method: "get", path: "/v1/events", summary: "SSE: agent.upserted · transcript.append · computer.status" },
  { method: "post", path: "/v1/attachments", summary: "Nạp ảnh/tệp, trả path + href" },
] as const;
