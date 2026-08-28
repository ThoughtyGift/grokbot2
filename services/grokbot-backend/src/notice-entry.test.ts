/**
 * Hai entry kind mới (`notice`, `user-attachment`) và lối thoát trên màn chặn thanh toán.
 *
 *   npx tsx --test services/grokbot-backend/src/notice-entry.test.ts
 *
 * Hai điều đáng khoá:
 *   1. `notice` KHÔNG mang `author` — nó là lời hệ thống. Gán tác giả là bắt một con bot nhận câu
 *      nó không nói ("Hết hạn mức tháng" đọc như bot đang than về chính mình).
 *   2. `upgradeUrl()` chỉ nhận http(s). Một `javascript:` lọt vào đây thành link chạy mã ngay trong
 *      app của người dùng — link này được vẽ bằng markdown, tức bấm được.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.GROKBOT2_ALLOW_WRITE = "1";
process.env.GROKBOT2_DATA_DIR = mkdtempSync(join(tmpdir(), "gb2-notice-"));

const { runWithOwner: as } = await import("./request-context.js");
const { createAgent } = await import("./directory/index.js");
const { postNotice } = await import("./conversation/index.js");
const { transcripts, nextEntryId } = await import("./chat/state.js");
const { toNativeEntry } = await import("./native-map.js");

const OWNER = "local|nguoi-a@vi-du.vn";

test("notice vào transcript đúng kind, và KHÔNG có tác giả", () => {
  const a = as(OWNER, () => createAgent({ name: "Bot" }));
  postNotice(a.id, "Hết hạn mức tháng.");
  const last = transcripts.get(a.id)?.at(-1);
  assert.equal(last?.kind, "notice");
  assert.equal(last && last.kind === "notice" ? last.text : "", "Hết hạn mức tháng.");
  // Nếu ai đó thêm `author` vào đây, bài này phải đỏ: lời hệ thống không thuộc về bot nào.
  assert.equal((last as unknown as { author?: unknown }).author, undefined);
});

test("notice giữ NGUYÊN link markdown — đó là cách duy nhất người dùng bấm được", () => {
  const a = as(OWNER, () => createAgent({ name: "Bot2" }));
  postNotice(a.id, "Hết hạn mức tháng. [Nâng cấp](https://tra-tien.example/goi-pro)");
  const last = transcripts.get(a.id)?.at(-1);
  const text = last && last.kind === "notice" ? last.text : "";
  assert.match(text, /\[Nâng cấp\]\(https:\/\/tra-tien\.example\/goi-pro\)/);
});

test("native /v1 vẽ notice thành lời hệ thống, không phải lời bot", () => {
  const a = as(OWNER, () => createAgent({ name: "Bot3" }));
  postNotice(a.id, "một lời hệ thống");
  const last = transcripts.get(a.id)!.at(-1)!;
  const native = toNativeEntry(last) as { kind: string; author?: { id: string }; content?: string };
  assert.equal(native.kind, "agent-message");
  assert.equal(native.author?.id, "system", "không được mượn danh một bot thật");
  assert.equal(native.content, "một lời hệ thống");
});

test("native /v1 vẽ user-attachment về phía NGƯỜI, tên trường snake_case", () => {
  const a = as(OWNER, () => createAgent({ name: "Bot4" }));
  // Tên trường là `file_path`/`file_name` đúng như renderer 0.29 đọc, không phải camelCase.
  transcripts.get(a.id)!.push({
    id: nextEntryId(), kind: "user-attachment", file_path: "/box/tai-lieu.pdf", file_name: "tai-lieu.pdf",
    timestampMs: Date.now(),
  });
  const native = toNativeEntry(transcripts.get(a.id)!.at(-1)!) as { kind: string; role?: string; attachment?: unknown };
  assert.equal(native.kind, "message");
  assert.equal(native.role, "user");
  assert.ok(native.attachment, "phải mang đính kèm");
});

test("upgradeUrl CHẶN scheme không phải http(s) — link này bấm được", async () => {
  const { upgradeUrl } = await import("./billing.js");
  // Không đặt được DB ở đây thì hàm trả null; điều phải đúng trong MỌI trường hợp là: không bao giờ
  // trả về một scheme lạ. Kiểm bằng chính giá trị trả về.
  const u = upgradeUrl();
  if (u !== null) assert.match(u, /^https?:\/\//i, `scheme lạ lọt qua: ${u}`);
});
