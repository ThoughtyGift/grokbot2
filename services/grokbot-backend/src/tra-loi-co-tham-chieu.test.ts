/**
 * Trả lời CÓ THAM CHIẾU — bot nối câu trả lời vào đúng tin người dùng đã bấm reply.
 *
 *   npx tsx --test services/grokbot-backend/src/tra-loi-co-tham-chieu.test.ts
 *
 * ── Vì sao bài này tồn tại ──────────────────────────────────────────────────────────────────────
 *
 * Đo 01/09 trên bản ghi thật: 748 entry, **0 entry của bot** mang `replyTo`. Kiểu dữ liệu có sẵn
 * trường ấy — `send-message` khai báo nó và `native-map.ts` phát nó ra — nhưng không chỗ nào ĐẶT.
 * Đúng họ với bẫy `awaitingUserResponse`: khai báo đủ, phát đủ, không ai gán.
 *
 * Hậu quả nhìn thấy được: app gốc vẽ trích dẫn phía trên MỌI tin trong luồng (ảnh người dùng gửi:
 * cả tin họ lẫn tin bot đều dẫn lại cùng một câu hỏi), còn bot ta trả lời trôi giữa dòng.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { agents, transcripts, tail } from "./chat/state.js";
import { sendPrompt } from "./runtime/turn.js";

let dem = 0;
const botThu = (): string => {
  const id = `agent-reply-${(dem += 1)}-${Math.random().toString(36).slice(2, 6)}`;
  agents.set(id, { id, name: `bot ${id}`, createdAt: Date.now() } as never);
  transcripts.set(id, []);
  return id;
};

test("người dùng bấm reply → câu trả lời của bot nối vào ĐÚNG tin đó", () => {
  const a = botThu();
  // Một tin của bot để trả lời vào.
  const goc = { id: "e-goc", kind: "send-message", author: { id: a, name: "bot" },
    message: { type: "text", content: "Muốn nối connector nào?" }, timestampMs: Date.now() };
  tail(a).push(goc as never);

  sendPrompt({ agentId: a, content: "Jira", replyToEntryId: "e-goc" } as never);

  const ds = tail(a);
  const tinNguoi = ds.find((e) => e.kind === "message" && (e as { role?: string }).role === "user");
  const tinBot = ds.filter((e) => e.kind === "send-message" && e.id !== "e-goc");
  assert.ok(tinNguoi, "phải có tin người dùng");
  assert.equal((tinNguoi as { replyTo?: { entryId: string } }).replyTo?.entryId, "e-goc");
  assert.ok(tinBot.length > 0, "lượt phải dựng một bubble cho bot");
  // Đây là dòng khoá cái đã thiếu suốt: bot cũng phải mang tham chiếu, không chỉ người dùng.
  assert.equal((tinBot[0] as { replyTo?: { entryId: string } }).replyTo?.entryId, "e-goc",
    "bot trả lời vào tin gốc, đúng như app gốc vẽ trích dẫn trên mọi tin trong luồng");
});

test("không bấm reply thì KHÔNG gắn gì — tin thường vẫn là tin thường", () => {
  const a = botThu();
  sendPrompt({ agentId: a, content: "chào" } as never);
  for (const e of tail(a)) {
    assert.equal((e as { replyTo?: unknown }).replyTo, undefined,
      "gắn tham chiếu vào tin không ai trả lời là vẽ thừa một khung trích dẫn rỗng nghĩa");
  }
});

test("id không tra được thì bỏ qua, không mất lượt", () => {
  const a = botThu();
  // Cửa sổ bản ghi FE chỉ 150 entry; một id cũ hơn thế là chuyện bình thường, không phải lỗi.
  sendPrompt({ agentId: a, content: "hỏi tiếp", replyToEntryId: "e-khong-ton-tai" } as never);
  const tinNguoi = tail(a).find((e) => e.kind === "message");
  assert.ok(tinNguoi, "lượt vẫn phải chạy");
  assert.equal((tinNguoi as { replyTo?: unknown }).replyTo, undefined);
});

/*
 * ── Tên trường client THẬT SỰ gửi ───────────────────────────────────────────────────────────────
 *
 * Trích 01/09 từ `SendGrokBotUserMessageRequest` của app gốc 0.30:
 *
 *     6 reply_to_id      ← client gửi cái này
 *
 * `replyToEntryId` là tên TÔI tự đặt, và nó không khớp cái nào. Renderer dùng `replyToId` 55 lần.
 * Hệ quả đã đo: 0 trên 748 entry mang `replyTo` — tham chiếu trả lời chưa từng tới backend, và bản
 * vá "bot trả lời có tham chiếu" chạy trên một đường không ai đi.
 */
test("nhận replyToId — tên client 0.30 gửi thật", () => {
  const a = botThu();
  tail(a).push({ id: "e-goc-2", kind: "send-message", author: { id: a, name: "bot" },
    message: { type: "text", content: "Muốn nối connector nào?" }, timestampMs: Date.now() } as never);
  sendPrompt({ agentId: a, content: "Jira", replyToId: "e-goc-2" } as never);
  const tinNguoi = tail(a).find((e) => e.kind === "message" && (e as { role?: string }).role === "user");
  assert.equal((tinNguoi as { replyTo?: { entryId: string } }).replyTo?.entryId, "e-goc-2");
});

test("nhận cả reply_to_id (snake_case, đúng tên proto)", () => {
  const a = botThu();
  tail(a).push({ id: "e-goc-3", kind: "send-message", author: { id: a, name: "bot" },
    message: { type: "text", content: "câu hỏi" }, timestampMs: Date.now() } as never);
  sendPrompt({ agentId: a, content: "trả lời", reply_to_id: "e-goc-3" } as never);
  const tinNguoi = tail(a).find((e) => e.kind === "message" && (e as { role?: string }).role === "user");
  assert.equal((tinNguoi as { replyTo?: { entryId: string } }).replyTo?.entryId, "e-goc-3");
});

test("replyToEntryId vẫn chạy — caller nội bộ đang dùng tên đó", () => {
  const a = botThu();
  tail(a).push({ id: "e-goc-4", kind: "send-message", author: { id: a, name: "bot" },
    message: { type: "text", content: "câu hỏi" }, timestampMs: Date.now() } as never);
  sendPrompt({ agentId: a, content: "trả lời", replyToEntryId: "e-goc-4" } as never);
  const tinNguoi = tail(a).find((e) => e.kind === "message" && (e as { role?: string }).role === "user");
  assert.equal((tinNguoi as { replyTo?: { entryId: string } }).replyTo?.entryId, "e-goc-4");
});

/*
 * ── Shape RA DÂY cho client gốc: `replyTo` là STRING id ─────────────────────────────────────────
 *
 * Đo 01/09: backend nhận tham chiếu đúng và bản ghi mang object đầy đủ, mà client vẫn vẽ
 * `↩ (deleted)`. Renderer 0.30 nói vì sao, trong một dòng:
 *
 *     replyToId == null ? {} : { replyTo: e.replyToId }
 *
 * Với nó `replyTo` LÀ id; "(deleted)" là câu nó nói khi tra tin gốc không ra. Ta đưa object vào chỗ
 * chờ một chuỗi nên nó không tra được gì.
 *
 * Ba nơi ba shape, và đó là cố ý: bản ghi nội bộ giữ object (model cần `author` + `excerpt`),
 * `api-contract` của FE riêng cũng giữ object (FE khỏi tra ngược khi tin gốc rơi khỏi cửa sổ 150
 * entry), còn cửa `/gw` trả string. Bài này khoá cửa `/gw`.
 */
test("cửa /gw trả replyTo là string id, kèm replyToId", async () => {
  const { transcriptTail } = await import("./conversation/index.js");
  const a = botThu();
  tail(a).push({ id: "e-goc-9", kind: "send-message", author: { id: a, name: "bot" },
    message: { type: "text", content: "câu hỏi gốc" }, timestampMs: Date.now() } as never);
  sendPrompt({ agentId: a, content: "trả lời", replyToId: "e-goc-9" } as never);

  const raDay = transcriptTail({ id: a, limit: 20 }).entries.find(
    (e: { replyTo?: unknown }) => e.replyTo != null,
  ) as { replyTo?: unknown; replyToId?: unknown } | undefined;
  assert.ok(raDay, "phải có entry mang tham chiếu");
  assert.equal(typeof raDay.replyTo, "string", "client chờ một chuỗi id, không phải object");
  assert.equal(raDay.replyTo, "e-goc-9");
  assert.equal(raDay.replyToId, "e-goc-9");
});

test("bản ghi NỘI BỘ vẫn giữ object — model cần author và excerpt", () => {
  const a = botThu();
  tail(a).push({ id: "e-goc-10", kind: "send-message", author: { id: a, name: "bot" },
    message: { type: "text", content: "câu hỏi gốc" }, timestampMs: Date.now() } as never);
  sendPrompt({ agentId: a, content: "trả lời", replyToId: "e-goc-10" } as never);
  const trong = tail(a).find((e) => (e as { replyTo?: unknown }).replyTo != null) as
    { replyTo?: { entryId?: string; author?: string; excerpt?: string } };
  assert.equal(typeof trong.replyTo, "object", "đổi shape ở cửa ra, KHÔNG đổi trong bản ghi");
  assert.equal(trong.replyTo?.entryId, "e-goc-10");
  assert.ok(String(trong.replyTo?.excerpt ?? "").length > 0);
});
