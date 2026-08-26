/**
 * Khoá pool không được rời khỏi máy chủ, và không được lọt vào log.
 *
 * Câu hỏi thật của người dùng, 27/08: *"đặt khoá lên VPS thì máy khác tải app về có nhìn thấy không?"*
 * Trả lời bằng đo đạc chứ không bằng lời hứa, và khoá phép đo đó lại ở đây.
 *
 * Ba đường một khoá có thể lộ, và bài này giữ cả ba:
 *
 *   1. **Đi kèm bộ cài** — app tải về mang theo file khoá
 *   2. **Đi qua dây** — backend trả khoá về cho client trong một câu trả lời nào đó
 *   3. **Đi vào log** — khoá in ra nhật ký, rồi nhật ký được dán đi đâu đó
 *
 * Đường 1 và 2 được giữ bằng kiến trúc: bộ cài chỉ chứa client + launcher + icon, còn khoá thì chỉ
 * `loadPoolKey()` đọc, và cả ba nơi gọi nó đều nằm phía máy chủ. Đường 3 mới cần `redact`, nên phần
 * lớn bài này đo `redact`.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { redact } from "./redact.js";

const srcDir = dirname(fileURLToPath(import.meta.url));

/** Đúng hình dạng admin-dashboard phát ra: `hal_` + 48 hex. */
const KEY = `hal_${"a1b2c3d4".repeat(6)}`;

test("khoá pool bị che khi lọt vào log", () => {
  const out = redact(`goi pool bang authorization: Bearer ${KEY}`);
  assert.ok(!out.includes(KEY), `khoá lộ nguyên văn: ${out}`);
});

test("che cả khi khoá nằm giữa một dòng có nhãn", () => {
  // Đúng hình dạng dòng thật trong `pool-key.txt`: một nhãn rồi tới khoá.
  const out = redact(`API-key-HALCION= ${KEY}`);
  assert.ok(!out.includes(KEY), out);
});

test("che khi khoá nằm trong JSON — hình dạng hay gặp nhất khi log một request", () => {
  const out = redact(JSON.stringify({ authorization: `Bearer ${KEY}`, model: "opus" }));
  assert.ok(!out.includes(KEY), out);
});

test("che khi khoá nằm trong query string", () => {
  const out = redact(`GET /v1/claude?api_key=${KEY}&model=opus`);
  assert.ok(!out.includes(KEY), out);
});

test("phần còn lại của dòng vẫn đọc được — che chứ không xoá sạch", () => {
  // Che mà nuốt luôn ngữ cảnh thì log thành vô dụng, và người ta sẽ tắt che.
  const out = redact(`POST https://admin.halcion.vn/v1/claude · Bearer ${KEY} · model=opus`);
  assert.match(out, /admin\.halcion\.vn/);
  assert.match(out, /model=opus/);
});

/*
 * Ba bài dưới đọc CẤU TRÚC, không đọc hành vi — vì đường 1 và 2 không có hành vi để đo: chúng được
 * giữ bằng việc *không có* mã nào làm điều đó. Thứ cần khoá là sự vắng mặt ấy.
 */
test("bộ cài KHÔNG chở theo file khoá nào", () => {
  const iss = readFileSync(join(srcDir, "..", "scripts", "setup-exe.mjs"), "utf8");
  const sources = [...iss.matchAll(/^Source:\s*"([^"]+)"/gm)].map((m) => m[1]);
  assert.ok(sources.length > 0, "không đọc được danh sách file của bộ cài");
  for (const s of sources) {
    assert.doesNotMatch(s, /pool-key|\.env|secret|key\.txt/i, `bộ cài chở theo file khoá: ${s}`);
  }
});

test("chỉ loadPoolKey đọc khoá, và nó không xuất ra ngoài config", () => {
  const cfg = readFileSync(join(srcDir, "config.ts"), "utf8");
  // Khoá KHÔNG được nằm trong object `config` — object đó bị in ra log và trả về ở vài chỗ chẩn đoán.
  const configObject = cfg.slice(cfg.indexOf("export const config"), cfg.indexOf("export function loadPoolKey"));
  assert.ok(!/poolKey/.test(configObject),
    "khoá pool không được là một trường của `config` — object đó có bị in ra");
});

test("không nơi nào gửi khoá về phía client", () => {
  // Khoá chỉ được đi vào header của lượt gọi pool. Bất kỳ chỗ nào nhét nó vào một `res.end` /
  // response body là một đường rò — kiểm bằng cách: các file phục vụ HTTP không được nhắc tới nó.
  for (const f of ["index.ts", "native.ts", "gateway.ts", "site.ts", "admin.ts"]) {
    const text = readFileSync(join(srcDir, f), "utf8");
    const code = text.split(/\r?\n/)
      .filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("//") && !l.trim().startsWith("/*"));
    assert.ok(!code.some((l) => /loadPoolKey|CLAUDE_POOL_KEY/.test(l)),
      `${f} chạm vào khoá pool — file phục vụ HTTP thì không nên`);
  }
});
