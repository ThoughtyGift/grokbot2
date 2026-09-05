/**
 * Hai thẻ 0.29/0.30 mà backend này chưa bao giờ PHÁT: `secret-request` và `user-form`.
 *
 * ── Hợp đồng, đọc từ sổ đăng ký của renderer chứ không đoán ─────────────────────────────────────
 *
 *     ben = ["text","attachment","widget","cursor-agent","secret-request","user-form","email-draft",
 *            "slack-draft","permission-request","connector","connectors","listener-connect",
 *            "bot-template-share","auto-review-approval","local-tool-permission",
 *            "virtual-card-approval","cookie-origin-approval"]
 *     xen = new Map([["send-message", new Set(ben)], …])
 *
 * `entry.kind === "send-message"` nhận 17 giá trị `message.type`, và hai cái ta cần nằm trong đó —
 * cùng khuôn với `local-tool-permission`, thẻ đã biết chắc chạy được.
 *
 * ── Vì sao thà KHÔNG tạo thẻ còn hơn tạo thẻ thiếu ─────────────────────────────────────────────
 *
 *     case "secret-request": return t.secretRequest.label
 *     case "user-form":      return t.formRequest.title
 *     `${t}:user-form:${e.formRequest.fields.length}:${e.formRequest.title.length}`
 *
 * `label`, `title`, `fields` đều bị đọc `.length` KHÔNG guard. Phát một thẻ thiếu chúng thì renderer
 * ném GIỮA LÚC VẼ, và error boundary nuốt cả cột phải — đúng mẫu lỗi đã ghi ở chú thích `runs`
 * trong automations.ts. Nên mọi hàm dưới đây trả `null` thay vì tạo một thẻ hỏng.
 *
 * Chi tiết đầy đủ: docs/extracted/0-30-secret-request-va-user-form.md
 */
import { randomUUID } from "node:crypto";
import { tail, authorOf, nextEntryId, onUpdate } from "../chat/state.js";
import type { BotTemplateShareMsg, FormField } from "./types.js";

/**
 * Xin một giá trị bí mật. Trả về id của thẻ, hoặc `null` nếu không đủ dữ liệu để vẽ.
 *
 * `description` rỗng thì BỎ HẲN trường, không gửi chuỗi rỗng: renderer vẽ dòng phụ khi
 * `description != null`, nên `""` cho ra một dòng trống trông như lỗi hiển thị.
 */
export function postSecretRequest(
  agentId: string,
  spec: { label: string; description?: string },
): string | null {
  const label = String(spec?.label ?? "").trim();
  if (!label) return null;
  const description = String(spec?.description ?? "").trim();
  const id = nextEntryId();
  tail(agentId).push({
    id,
    kind: "send-message",
    author: authorOf(agentId),
    message: { type: "secret-request", secretRequest: { label, ...(description ? { description } : {}) } },
    timestampMs: Date.now(),
  });
  onUpdate(agentId);
  return id;
}

/**
 * Hỏi một biểu mẫu nhiều ô.
 *
 * Ô thiếu `id` hoặc `label` bị loại chứ không giữ: renderer khoá giá trị theo `field.id`
 * (`values[field.id]`), nên một ô không id thì người dùng gõ vào đâu cũng không gửi đi được — nó
 * chỉ là một ô chết trên thẻ.
 *
 * Bảng ánh xạ `type` → `<input>` nằm ở PHÍA CLIENT (hàm `qe`), ta không dựng lại; ta chỉ gửi đúng
 * tên loại nó biết. Đáng ghi vì nó giải thích vì sao `id`/`label` quan trọng hơn vẻ ngoài: nhánh
 * mặc định của client soi `"${id} ${label}"` bằng `/user|login|account/i` để đặt
 * `autoComplete="username"`, và soi `{password,passwd,pwd,passcode}` để đặt `current-password`.
 * Đặt tên tuỳ tiện thì mất tự-điền của trình duyệt, chứ không hỏng gì.
 */
export function postUserForm(
  agentId: string,
  spec: { title: string; instruction?: string; fields: FormField[]; liveHost?: string; domain?: string },
): string | null {
  const title = String(spec?.title ?? "").trim();
  if (!title) return null;
  const fields = (Array.isArray(spec?.fields) ? spec.fields : [])
    .filter((f) => String(f?.id ?? "").trim() && String(f?.label ?? "").trim())
    .map((f) => ({
      id: String(f.id).trim(),
      label: String(f.label).trim(),
      ...(f.type ? { type: f.type } : {}),
      ...(f.placeholder ? { placeholder: String(f.placeholder) } : {}),
      ...(f.required === true ? { required: true } : {}),
      ...(f.secret === true ? { secret: true } : {}),
      ...(Array.isArray(f.options) && f.options.length
        ? { options: f.options.filter((o) => o?.value != null && o?.label != null) }
        : {}),
    }));
  if (!fields.length) return null;
  const instruction = String(spec?.instruction ?? "").trim();
  const id = nextEntryId();
  tail(agentId).push({
    id,
    kind: "send-message",
    author: authorOf(agentId),
    message: {
      type: "user-form",
      formRequest: {
        title,
        ...(instruction ? { instruction } : {}),
        fields,
        ...(spec?.liveHost ? { liveHost: String(spec.liveHost) } : {}),
        ...(spec?.domain ? { domain: String(spec.domain) } : {}),
      },
    },
    timestampMs: Date.now(),
  });
  onUpdate(agentId);
  return id;
}

/**
 * Thẻ `auto-review-approval` — bot tự soát rồi xin duyệt một hành động nó định làm.
 *
 * Khác `local-tool-permission` ở chỗ CÂU HỎI. Thẻ quyền hỏi "cho phép chạm vào máy không"; thẻ này
 * hỏi "việc tôi định làm có nằm trong thứ bạn đã nhờ không" — và nó kèm LÝ DO, do chính lớp soát
 * viết ra sau khi đọc hội thoại.
 *
 * Hình dạng trích từ transcript thật của app gốc:
 *
 *     {"type":"auto-review-approval","approval":{
 *       "requestId":"16bce518-…","surface":"computer",
 *       "summary":"Open “https://cinai.app/en/pricing” in the box browser",
 *       "reason":"The navigation targets cinai.app, but the user authorized cinai.tv…",
 *       "status":"approved","proposedRule":"Navigate to pages within https://cinai.tv/ …"}}
 *
 * Renderer 0.29 đọc `requestId`, `status` và `summary` (`${t}:auto-review-approval:${requestId}:${status}`
 * là khoá cache của nó). `reason` và `proposedRule` KHÔNG được nó vẽ — đo được: `proposedRule` xuất
 * hiện 0 lần trong bundle. Vẫn gửi cả hai, vì chúng là thứ giải thích quyết định, và một thẻ xin
 * duyệt không nói vì sao thì người ta chỉ còn cách bấm bừa.
 *
 * `null` khi thiếu `summary`: renderer dựng khoá cache từ nó, và một thẻ không có tóm tắt là một
 * thẻ hỏi người dùng duyệt một khoảng trắng.
 */
export function postAutoReview(
  agentId: string,
  spec: { surface: string; summary: string; reason?: string; proposedRule?: string },
): string | null {
  const summary = String(spec?.summary ?? "").trim();
  if (!summary) return null;
  const id = nextEntryId();
  tail(agentId).push({
    id,
    kind: "send-message",
    author: authorOf(agentId),
    message: {
      type: "auto-review-approval",
      approval: {
        status: "pending",
        requestId: randomUUID(),
        summary,
        surface: String(spec.surface ?? ""),
        ...(spec.reason ? { reason: String(spec.reason) } : {}),
        ...(spec.proposedRule ? { proposedRule: String(spec.proposedRule) } : {}),
      },
    },
    timestampMs: Date.now(),
  });
  onUpdate(agentId);
  return id;
}

/**
 * Thẻ "mẫu bot" — bot vừa đóng gói chính nó (tool `share_bot_template`). Hình dạng: `BotTemplateShareMsg`.
 *
 * Sáu khoá đầu là `required` của `SandSendMessage` 0.43; `body` rỗng vẫn hợp lệ (client bỏ dòng mô tả),
 * nhưng `shareId`/`name`/`shareUrl` rỗng thì thẻ không trỏ vào đâu → `null`, không tạo thẻ hỏng.
 * Khoá tuỳ chọn vắng thì BỎ HẲN, không gửi `undefined`/`null`: renderer đọc `t.published==null` để
 * quyết định có ghép trường vào view hay không.
 */
export function postBotTemplateShareCard(agentId: string, m: Omit<BotTemplateShareMsg, "type">): string | null {
  if (!m.shareId || !m.name || !m.shareUrl) return null;
  const message: BotTemplateShareMsg = {
    type: "bot-template-share",
    shareId: m.shareId,
    name: m.name,
    avatarShape: m.avatarShape,
    avatarColor: m.avatarColor,
    body: m.body ?? "",
    shareUrl: m.shareUrl,
    ...(m.version != null ? { version: m.version } : {}),
    ...(m.activeVersion != null ? { activeVersion: m.activeVersion } : {}),
    ...(m.published != null ? { published: m.published } : {}),
    ...(m.visibility != null ? { visibility: m.visibility } : {}),
  };
  const id = nextEntryId();
  tail(agentId).push({ id, kind: "send-message", author: authorOf(agentId), message, timestampMs: Date.now() });
  onUpdate(agentId);
  return id;
}
