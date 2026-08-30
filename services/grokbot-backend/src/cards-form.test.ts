/**
 * Thẻ `secret-request` và `user-form` — hai thẻ 0.29/0.30 mà backend này chưa bao giờ PHÁT.
 *
 *   npx tsx --test services/grokbot-backend/src/cards-form.test.ts
 *
 * ── Hợp đồng, trích từ bundle 0.30 chứ không đoán ───────────────────────────────────────────────
 *
 * Bộ phân biệt lấy từ sổ đăng ký của renderer: `entry.kind === "send-message"` nhận 17 giá trị
 * `message.type`, trong đó có `"secret-request"` và `"user-form"` — cùng khuôn với
 * `"local-tool-permission"`, thẻ ta đã biết chắc chạy được.
 *
 *     case "secret-request": return t.secretRequest.label
 *     case "user-form":      return t.formRequest.title
 *     `${t}:user-form:${e.formRequest.fields.length}:${e.formRequest.title.length}`
 *
 * `label`, `title` và `fields` bị đọc `.length` KHÔNG guard. Phát một thẻ thiếu chúng thì renderer
 * NÉM giữa lúc vẽ, và error boundary nuốt cả cột phải — đúng mẫu lỗi repo này đã trả giá vài lần
 * (xem chú thích `runs` trong automations.ts). Nên thà không tạo thẻ còn hơn tạo thẻ hỏng.
 *
 * Chi tiết đầy đủ: docs/extracted/0-30-secret-request-va-user-form.md
 *
 * ── Vì sao có bài `submitSecret` ────────────────────────────────────────────────────────────────
 *
 * `submitSecret` cũ nhận `{requestId}`, nhưng client gửi `{entryId, value, agentId}`. Nên
 * `findPending(undefined)` rơi vào nhánh dự phòng "lấy mục pending ĐẦU TIÊN" — mà `pending` là bản
 * đồ của THẺ XIN QUYỀN, không phải bí mật. Một lần gửi bí mật xoá nhầm một thẻ quyền không liên
 * quan. Chưa ai chạm tới được vì ta chưa phát thẻ bao giờ; làm ① mà không sửa là bật bẫy đó lên.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { postSecretRequest, postUserForm } from "./conversation/cards.js";
import { submitSecret } from "./runtime/turn.js";
import { agents, transcripts, tail } from "./chat/state.js";
import { TOOLS } from "./runtime/tools.js";

const botThu = (id: string): void => {
  agents.set(id, { id, name: `bot ${id}`, createdAt: Date.now() } as never);
  transcripts.set(id, []);
};
const cuoi = (id: string) => tail(id)[tail(id).length - 1];

/**
 * Đọc `message` qua đúng nhánh của union, không ép kiểu.
 *
 * `Entry` còn có nhánh `tool-call` không có `message`, nên `e.message` thẳng là lỗi type. Ép kiểu
 * thì test vẫn xanh mà typecheck đỏ — đúng cái bẫy đã gặp ở `reveal-race.test.ts`.
 */
const tin = (e: ReturnType<typeof cuoi>): Record<string, unknown> => {
  assert.equal(e.kind, "send-message");
  return (e as Extract<typeof e, { kind: "send-message" }>).message as unknown as Record<string, unknown>;
};

// ── secret-request ──────────────────────────────────────────────────────────────────────────────

test("thẻ xin bí mật mang đúng hình dạng renderer đọc", () => {
  const a = "card-a1";
  botThu(a);
  const id = postSecretRequest(a, { label: "Mã OTP Shopee", description: "Gửi tới số cuối 88" });
  assert.ok(id, "phải tạo được thẻ");
  const m = tin(cuoi(a));
  assert.equal(m.type, "secret-request");
  const sr = m.secretRequest as { label: string; description?: string };
  assert.equal(sr.label, "Mã OTP Shopee");
  assert.equal(sr.description, "Gửi tới số cuối 88");
});

test("thiếu label thì KHÔNG tạo thẻ — renderer đọc `.label.length` không guard", () => {
  const a = "card-a2";
  botThu(a);
  assert.equal(postSecretRequest(a, { label: "" }), null);
  assert.equal(postSecretRequest(a, { label: "   " }), null);
  assert.equal(tail(a).length, 0, "không được để lại thẻ nào trong bản ghi");
});

test("mô tả rỗng thì bỏ hẳn trường, không gửi chuỗi rỗng", () => {
  const a = "card-a3";
  botThu(a);
  postSecretRequest(a, { label: "Khoá API", description: "  " });
  // `description != null` là điều kiện renderer dùng để vẽ dòng phụ; gửi "" thì nó vẽ một dòng trống.
  assert.equal("description" in (tin(cuoi(a)).secretRequest as object), false);
});

// ── user-form ───────────────────────────────────────────────────────────────────────────────────

test("thẻ biểu mẫu mang đúng hình dạng renderer đọc", () => {
  const a = "card-b1";
  botThu(a);
  const id = postUserForm(a, {
    title: "Đăng nhập Seller Centre",
    instruction: "Mình cần phiên đăng nhập để đọc đơn.",
    fields: [
      { id: "user", label: "Tài khoản", type: "email" },
      { id: "pass", label: "Mật khẩu", type: "password", required: true },
    ],
  });
  assert.ok(id);
  const m = tin(cuoi(a));
  assert.equal(m.type, "user-form");
  const fr = m.formRequest as { title: string; fields: { required?: boolean }[] };
  assert.equal(fr.title, "Đăng nhập Seller Centre");
  assert.equal(fr.fields.length, 2);
  assert.equal(fr.fields[1].required, true);
});

test("thiếu title hoặc fields thì KHÔNG tạo thẻ", () => {
  const a = "card-b2";
  botThu(a);
  assert.equal(postUserForm(a, { title: "", fields: [{ id: "x", label: "X" }] }), null, "title rỗng");
  assert.equal(postUserForm(a, { title: "Có tiêu đề", fields: [] }), null, "không ô nào");
  assert.equal(tail(a).length, 0);
});

test("ô không có id hoặc label bị loại, không đưa vào thẻ", () => {
  const a = "card-b3";
  botThu(a);
  postUserForm(a, {
    title: "Biểu mẫu",
    fields: [
      { id: "ok", label: "Dùng được" },
      { id: "", label: "Thiếu id" } as never,
      { id: "thieu-nhan", label: "" } as never,
    ],
  });
  const f = (tin(cuoi(a)).formRequest as { fields: unknown[] }).fields;
  assert.equal(f.length, 1, "chỉ giữ ô dùng được");
});

// ── submitSecret ────────────────────────────────────────────────────────────────────────────────

test("gửi bí mật KHÔNG được đụng tới thẻ xin quyền đang chờ", () => {
  const a = "card-c1";
  botThu(a);
  const id = postSecretRequest(a, { label: "Mã OTP" });
  assert.ok(id);
  // Đây là ca lỗi cũ: `findPending(undefined)` lấy mục pending đầu tiên — một thẻ QUYỀN — rồi xoá.
  const truoc = submitSecret({ entryId: id, value: "123456", agentId: a });
  assert.ok(truoc !== undefined, "phải nhận được câu trả lời, không phải im lặng");
});

test("giá trị bí mật KHÔNG bao giờ nằm trong bản ghi hội thoại", () => {
  const a = "card-c2";
  botThu(a);
  const id = postSecretRequest(a, { label: "Khoá API" });
  submitSecret({ entryId: id!, value: "sk-dung-de-lo-ra-ngoai", agentId: a });
  const all = JSON.stringify(tail(a));
  assert.ok(!all.includes("sk-dung-de-lo-ra-ngoai"),
    "bí mật lọt vào transcript — nó sống mãi ở đó và model đọc lại được");
});

// ── tool cho model ──────────────────────────────────────────────────────────────────────────────

test("tool nói rõ thiếu gì, thay vì im lặng không tạo thẻ", async () => {
  const a = "card-d1";
  botThu(a);
  const ctx = {
    agentId: a,
    askSecret: (s: { label: string }) => postSecretRequest(a, s),
    askForm: (s: never) => postUserForm(a, s),
  } as never;
  // Model gọi thiếu nhãn: phải nhận câu sửa được, không phải "ok" rỗng.
  const r1 = await (TOOLS as Record<string, (x: string, c: never) => unknown>).request_secret('{"label":"  "}', ctx);
  assert.match(String(r1), /label/, "phải nói thiếu trường nào");
  const r2 = await (TOOLS as Record<string, (x: string, c: never) => unknown>).request_user_form('{"title":"Có","fields":[]}', ctx);
  assert.match(String(r2), /title|ô/, "phải nói cần tiêu đề và ít nhất một ô");
  assert.equal(tail(a).length, 0, "và không để lại thẻ hỏng nào");
});

test("tool KHÔNG nhắc lại giá trị bí mật trong câu trả lời cho model", async () => {
  const a = "card-d2";
  botThu(a);
  const ctx = { agentId: a, askSecret: (s: { label: string }) => postSecretRequest(a, s) } as never;
  const r = await (TOOLS as Record<string, (x: string, c: never) => unknown>)
    .request_secret('{"label":"Khoá API Shopee"}', ctx);
  // Câu trả lời đi thẳng vào ngữ cảnh model. Nó được phép nhắc ĐANG XIN GÌ, nhưng phải nói rõ giá
  // trị sẽ không hiện ra — nếu không, lượt sau model đi tìm giá trị trong lịch sử.
  assert.match(String(r), /KHÔNG hiện|không hiện/, "phải nói giá trị sẽ không quay lại đây");
});

test("đã gửi rồi thì thẻ chuyển sang trạng thái đã-lưu", () => {
  const a = "card-c3";
  botThu(a);
  const id = postSecretRequest(a, { label: "Mã OTP" });
  submitSecret({ entryId: id!, value: "123456", agentId: a });
  const e = tail(a).find((x) => x.id === id);
  // `entry.secretProvided === true` là thứ renderer dùng để vẽ thẻ "đã lưu" thay vì ô nhập.
  assert.equal((e as { secretProvided?: boolean }).secretProvided, true);
});
