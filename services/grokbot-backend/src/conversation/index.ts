/**
 * Conversation context — transcript entries, seq, outline, attachments in the log.
 * Does not create agents (directory does). Reads agent name only via state.authorOf.
 */
import { extname } from "node:path";
import { stageImage } from "../attachments.js";
import { ME } from "../identity/index.js";
import { persist, onUpdate, tail, authorOf, nextEntryId, EPOCH, acceptance, transcripts, ownsAgent } from "../chat/state.js";
import { mocSeq, datCho } from "../chat/epoch-ben.js";
import { ensureSeq as stampSeq, isToolEcho, textOf } from "./seq.js";
import type { Entry, LastEntry, WidgetOption, TranscriptEvent } from "./types.js";

export { ensureSeq, isToolEcho, textOf, TOOL_ECHO } from "./seq.js";

export const IMG_MIME: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp",
};

export const attachmentNameOf = (e: Entry): string => {
  const m = e.kind === "message" ? (e as { message?: { type: string; file_name?: string; alt?: string } }).message : undefined;
  return m?.type === "attachment" ? (m.file_name || m.alt || "ảnh") : "";
};

export const attachmentLineOf = (e: Entry, isThisTurn: boolean): string => {
  const m = e.kind === "message" ? (e as { message?: { type: string; file_name?: string; url?: string } }).message : undefined;
  const name = attachmentNameOf(e);
  const isImage = IMG_MIME[extname(m?.file_name || m?.url || "").toLowerCase()] != null;
  if (!isImage) return `[người dùng gửi kèm tệp “${name}”]`;
  return isThisTurn
    ? `[người dùng gửi kèm ảnh “${name}” — ảnh đã có sẵn trong lượt này, hãy xem trực tiếp]`
    : `[người dùng đã gửi kèm ảnh “${name}” ở một lượt trước]`;
};

export const setText = (e: Entry, v: string): void => { if (e.kind === "send-message" && e.message.type === "text") e.message.content = v; };

export function attachmentKind(name: string): string {
  const ext = (name.split(/[/\\]/).pop() ?? "").split(".").pop()?.toLowerCase() ?? "";
  if (["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "avif"].includes(ext)) return "image";
  if (["mp4", "mov", "webm", "mkv"].includes(ext)) return "video";
  if (["mp3", "wav", "ogg", "m4a", "flac"].includes(ext)) return "audio";
  if (ext === "pdf") return "pdf";
  if (["md", "markdown", "mdx"].includes(ext)) return "markdown";
  if (["csv", "tsv", "xlsx", "xls"].includes(ext)) return "table";
  if (["json", "jsonc", "ndjson"].includes(ext)) return "json";
  if (["txt", "text", "log", "yaml", "yml", "toml", "ini", "conf"].includes(ext)) return "text";
  if (["doc", "docx", "odt", "rtf"].includes(ext)) return "document";
  if (["zip", "tar", "gz", "7z", "rar"].includes(ext)) return "archive";
  return "file";
}

export function lastEntryOf(agentId: string): LastEntry | undefined {
  const t = transcripts.get(agentId);
  if (!t?.length) return undefined;
  for (let i = t.length - 1; i >= 0; i--) {
    const e = t[i];
    if (e.kind === "send-message" && e.message.type === "attachment") {
      const name = e.message.file_name || e.message.url;
      return { kind: "attachment", count: 1, kinds: [{ kind: attachmentKind(name), count: 1 }] };
    }
    if (isToolEcho(e)) continue;
    const text = textOf(e).trim();
    if (text) return { kind: "text", text };
  }
  return undefined;
}

export function transcriptContains(agentId: string, q: string): boolean {
  return (transcripts.get(agentId) ?? []).some((e) => textOf(e).toLowerCase().includes(q));
}

const transcriptSeq = new Map<string, number>();

/** Khoá mốc bền của một bot — cùng chuỗi với `replicaKey` để đọc tệp mốc là biết ngay của ai. */
const khoaSeq = (agentId: string) => `transcript:${agentId}`;

export function seqFor(agentId: string): number {
  const known = transcriptSeq.get(agentId);
  if (known !== undefined) return known;
  // Sàn là MAX(độ dài bản ghi, mốc đã đặt chỗ): mốc giữ cho số KHÔNG TỤT sau khởi động lại
  // (`sequence` tăng mỗi SỰ KIỆN nên nó vượt xa độ dài trong một lượt streaming), còn độ dài lo cho
  // bot có bản ghi mà chưa từng phát khung nào (mốc = 0).
  const seeded = Math.max((transcripts.get(agentId) ?? []).length, mocSeq(khoaSeq(agentId)));
  transcriptSeq.set(agentId, seeded);
  return seeded;
}

/**
 * `OrderedStamp` của một sự kiện bản ghi — đúng hình 0.43: `replicaKey` = `transcript:<agentId>` (renderer
 * `Lh`/`tz` tách agentId sau tiền tố `transcript:`), `epoch` chuỗi **BỀN qua khởi động lại**
 * (trước 08/09 nó là `Date.now()` mỗi lần nạp, và chú thích ở đây từng khẳng định *"client thấy
 * epoch lạ → tự tải đuôi neo lại"* — đo thì **không**: nó thôi hỏi luôn, xem `chat/epoch-ben.ts`),
 * `sequence` +1 mỗi sự kiện của bot đó.
 * Viết 08/2026 cho một lần thử không thành trên client 0.30; từ 06/09/2026 `sse.ts` dùng thật cho 0.43 —
 * bằng chứng hãng đi đường này: replica bản ghi mà client app gốc 0.43 ghi xuống đĩa mang
 * `epochHint: "fbf22d21-…"`, `acceptedSequenceHint: 9` (bot cũ 01/09 thì `null`).
 */
export function nextTranscriptOrdered(agentId: string) {
  const next = seqFor(agentId) + 1;
  transcriptSeq.set(agentId, next);
  datCho(khoaSeq(agentId), next);
  return { replicaKey: khoaSeq(agentId), epoch: EPOCH, sequence: next };
}

const numbered = (agentId: string | undefined, all: Entry[]) => stampSeq(agentId, all, persist);

/*
 * Entry gửi cho CLIENT GỐC: `replyTo` phải là một STRING id, không phải object.
 *
 * Đo 01/09. Backend nhận tham chiếu đúng — entry `e13969` mang
 * `replyTo: {entryId:"e13968", author:"New Bot", excerpt:"Ảnh chưa tới được…"}` — mà client vẫn vẽ
 * `↩ (deleted)`. Renderer 0.30 nói vì sao, ngay trong một dòng:
 *
 *     replyToId == null ? {} : { replyTo: e.replyToId }
 *
 * Với nó, `replyTo` LÀ id; nó tự tra tin gốc trong danh sách đang giữ, và "(deleted)" là câu nó nói
 * khi tra không ra. Ta đưa một object vào chỗ chờ một chuỗi, nên nó không tra được gì cả.
 *
 * Gửi kèm `replyToId` (tên renderer dùng 55 lần) để khỏi phụ thuộc vào việc nó đọc tên nào.
 *
 * Object đầy đủ VẪN ở lại trong bản ghi nội bộ, và đó là cố ý: `historyFor` cần `author` +
 * `excerpt` để dựng dòng "[trả lời tin của X: …]" cho model, còn `api-contract` của FE riêng cố
 * tình mang object để FE khỏi tra ngược khi tin gốc đã rơi khỏi cửa sổ 150 entry. Ba nơi, ba shape
 * — chỗ này chỉ đổi shape ở cửa ra `/gw`.
 */
type CoSeq = Entry & { seq: number };
const choClientGoc = (e: CoSeq): CoSeq => {
  const rt = (e as { replyTo?: { entryId: string } }).replyTo;
  // Cast qua `unknown`: shape ra dây KHÁC `Entry` đúng ở một trường, và nói thật điều đó bằng một
  // cast hẹp thì rõ hơn là dựng một kiểu song song chỉ để lệch một chỗ.
  let raDay = rt ? ({ ...e, replyTo: rt.entryId, replyToId: rt.entryId } as unknown as CoSeq) : e;
  // `SandToolCallEntry` 0.43 chỉ có id·kind·name·status·summary·timestampMs·reactions; renderer đọc
  // `rawArgs` 0 lần và `result` 0 lần trên hàng tool-call. Đo 06/09 trên New Bot: hai khoá ấy chiếm
  // **51 %** của trang đuôi 292 KB (117 tool-call) mà client tải lại sau MỖI khung SSE — bỏ ở cửa `/gw`,
  // bản ghi nội bộ (và `/v1` cho FE riêng) vẫn giữ nguyên.
  if (raDay.kind === "tool-call") {
    const { rawArgs: _a, result: _r, ...gon } = raDay as CoSeq & { rawArgs?: unknown; result?: unknown };
    raDay = gon as CoSeq;
  }
  // `SandMessageEntry` 0.43 bắt buộc `isStreaming`; tin người dùng ghi vào tail không có nó, và một
  // entry trượt là cả trang bị coordinator coi là hỏng → app chỉ còn "Showing saved messages".
  return raDay.kind === "message" && (raDay as { isStreaming?: boolean }).isStreaming === undefined
    ? ({ ...raDay, isStreaming: false } as CoSeq) : raDay;
};


export function latestEntry(agentId: string): (Entry & { seq: number }) | null {
  const all = transcripts.get(agentId) ?? [];
  if (!all.length) return null;
  const withSeq = numbered(agentId, all);
  const cuoi = withSeq[withSeq.length - 1];
  return cuoi ? choClientGoc(cuoi) : null;
}

const PAGE = 200;

export function transcriptTail(a?: { agentId?: string; id?: string; limit?: number; beforeSeq?: number; before?: string; cursor?: string } | string) {
  const args = typeof a === "string" || a === undefined ? { agentId: a as string | undefined } : a;
  const agentId = args.agentId ?? args.id;
  // Multi-tenant Phase 2: never hand back a transcript for an agent the caller does not own.
  const all = (agentId && ownsAgent(agentId) && transcripts.get(agentId)) || [];
  const withSeq = numbered(agentId, all);
  const limit = Math.max(1, Math.min(args.limit ?? PAGE, 1000));

  let end = withSeq.length;
  if (typeof args.beforeSeq === "number") end = Math.max(0, withSeq.findIndex((e) => e.seq >= args.beforeSeq!));
  else if (args.before ?? args.cursor) {
    const at = withSeq.findIndex((e) => e.id === (args.before ?? args.cursor));
    if (at >= 0) end = at;
  }
  const start = Math.max(0, end - limit);
  const entries = withSeq.slice(start, end).map(choClientGoc);
  return {
    reachable: true,
    entries,
    beforeSeq: typeof args.beforeSeq === "number" ? args.beforeSeq : null,
    // `SandTranscriptPage.nextBeforeSeq` là `number`, không nullable — hết trang thì VẮNG khoá.
    ...(start > 0 && entries[0] ? { nextBeforeSeq: entries[0].seq } : {}),
    hasMore: start > 0,
    cursor: entries[0]?.id ?? null,
    total: withSeq.length,
  };
}

/**
 * The conversation outline — the jump-list down the side of a conversation.
 *
 * The item shape is the client's, read off its own renderer rather than invented, because every
 * field here is one the outline component actually indexes:
 *
 *   id      `onToggle(t.id)` and the detail element id — NOT `entryId`, which the UI never reads
 *   kind    "user" | "thinking" | "assistant-text" | "tool-call" | "send-message" — its OWN
 *           vocabulary, not our transcript kinds ("message" / "event" mean nothing to it)
 *   text    label for user / thinking / assistant-text (first line is taken)
 *   summary label for tool-call; `name` picks the row's label, `status` picks the icon
 *           ("pending" → loading, "failed" → x-circle, else wrench)
 *   message passed through the client's own text extractor for send-message
 *
 * This used to answer `{entryId, text, timestampMs}` for user messages only — narrower than the
 * component is built for (it renders tool-calls with a live status) and keyed on a field the
 * component does not look at.
 *
 * `event` entries are dropped: there is no outline kind for them, and a row whose `kind` matches
 * none of the five switches falls through every label/icon function and renders blank.
 */
export type OutlineItem =
  | { id: string; kind: "user"; text: string; timestampMs: number }
  | { id: string; kind: "tool-call"; name: string; summary: string; status: "pending" | "running" | "done" | "failed"; timestampMs: number }
  | { id: string; kind: "send-message"; message: unknown; timestampMs: number };

export function getConversationOutline(a: { agentId?: string; id?: string }): OutlineItem[] {
  const oid = a.agentId ?? a.id;
  const t = (oid && ownsAgent(oid) && transcripts.get(oid)) || [];
  return t.flatMap((e): OutlineItem[] => {
    if (e.kind === "message" && e.role === "user" && e.content) {
      return [{ id: e.id, kind: "user" as const, text: textOf(e), timestampMs: e.timestampMs }];
    }
    if (e.kind === "tool-call") {
      return [{
        id: e.id,
        kind: "tool-call" as const,
        name: e.name,
        summary: e.summary ?? e.name,
        status: e.status,
        timestampMs: e.timestampMs,
      }];
    }
    if (e.kind === "send-message") {
      return [{ id: e.id, kind: "send-message" as const, message: e.message, timestampMs: e.timestampMs }];
    }
    return [];
  });
}

export function reactToMessage(a: { agentId?: string; entryId?: string; id?: string; reaction?: string; emoji?: string }): Record<string, never> {
  const rid = a.agentId ?? a.id;
  const t = (rid && ownsAgent(rid) && transcripts.get(rid)) || [];
  const e = t.find((x) => x.id === a.entryId);
  const emoji = a.emoji ?? a.reaction;
  if (e && emoji) {
    const list = (e.reactions ??= []);
    const at = list.findIndex((r) => r.emoji === emoji && r.by === ME);
    if (at >= 0) list.splice(at, 1);
    else list.push({ emoji, by: ME });
  }
  if (a.agentId) onUpdate(a.agentId); else persist();
  return {};
}

export const voteFeedback = (): Record<string, never> => ({});

export function promptAcceptanceStatus(a: { clientNonce?: string; accountSlot?: string }) {
  const rec = a?.clientNonce ? acceptance.get(a.clientNonce) : undefined;
  return rec ? { outcome: "found", record: rec } : { outcome: "not-found" };
}

export function pushTranscriptEvent(agentId: string, event: TranscriptEvent): void {
  const t = transcripts.get(agentId);
  if (!t) return;
  t.push({ id: `event-${nextEntryId()}`, kind: "event", event, timestampMs: Date.now() });
  persist();
  onUpdate(agentId);
}

export function pushListenerConnect(agentId: string, platform: string, reason = "so this routine can fire"): void {
  const t = transcripts.get(agentId);
  if (!t) return;
  t.push({
    id: nextEntryId(), kind: "send-message", author: authorOf(agentId),
    message: { type: "listener-connect", platform, reason }, timestampMs: Date.now(),
  });
  persist();
  onUpdate(agentId);
}

export function postAttachment(agentId: string, dataUrl: string, fileName: string, alt: string): void {
  const path = stageImage(dataUrl, fileName);
  if (path == null) return;
  tail(agentId).push({
    id: nextEntryId(),
    kind: "send-message",
    author: authorOf(agentId),
    message: { type: "attachment", url: path, file_name: fileName, alt },
    timestampMs: Date.now(),
  });
  onUpdate(agentId);
}

export function postFileAttachment(
  agentId: string, path: string, fileName: string, alt: string,
  /** Kích thước, nếu biết. App gốc gửi kèm cho video — xem `AttachmentMsg`. */
  co?: { width?: number; height?: number },
): void {
  tail(agentId).push({
    id: nextEntryId(),
    kind: "send-message",
    author: authorOf(agentId),
    message: {
      type: "attachment", url: path, file_name: fileName, alt,
      ...(co?.width && co?.height ? { width: co.width, height: co.height } : {}),
    },
    timestampMs: Date.now(),
  });
  onUpdate(agentId);
}

/**
 * Một lời của HỆ THỐNG trong dòng hội thoại.
 *
 * Trước đây mọi thông báo kiểu này phải giả dạng lời bot (`author: authorOf(agentId)`), tức gán cho
 * bot một câu nó không hề nói — người dùng đọc "Hết hạn mức tháng" mà tưởng con bot đang tự nói về
 * mình. Renderer 0.29 có sẵn kind cho việc này và vẽ thành `role:"note"`.
 *
 * Chữ đi qua nguyên vẹn, kể cả link markdown: bản ghi app gốc cho thấy client vẽ được cả
 * `[Shopee Open Platform](https://open.shopee.com)` lẫn deep-link `[Updates](grokbot://app/v1/…)`.
 */
export function postNotice(agentId: string, text: string): void {
  tail(agentId).push({ id: nextEntryId(), kind: "notice", text, timestampMs: Date.now() });
  onUpdate(agentId);
}

const MAX_WIDGET_OPTIONS = 6;

export function postWidget(
  agentId: string,
  widget: { prompt: string; helpText?: string; options: WidgetOption[]; allowCustom?: boolean; dismissOnMoveOn?: boolean },
): string | null {
  const options = widget.options.filter((o) => typeof o?.label === "string" && o.label.trim().length > 0).slice(0, MAX_WIDGET_OPTIONS);
  if (widget.prompt.trim().length === 0 || options.length === 0) return null;
  const id = nextEntryId();
  tail(agentId).push({
    id,
    kind: "send-message",
    author: authorOf(agentId),
    message: { type: "widget", widget: { ...widget, options } },
    timestampMs: Date.now(),
  });
  onUpdate(agentId);
  return id;
}
