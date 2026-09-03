/**
 * Kênh cập nhật — chỗ DUY NHẤT quyết định ai thấy banner "New update available".
 *
 * Vì sao đáng test kỹ hơn vẻ ngoài của nó: sai theo hướng "trả 200 khi không nên" thì mọi máy người
 * dùng hiện banner cho một bản chưa nghiệm thu, và khác website, họ đã cài rồi thì không F5 về được
 * — phải chờ ta phát hành bản sửa. Sai hướng kia thì banner không bao giờ hiện và không ai biết vì
 * sao, vì "im lặng" chính là câu trả lời đúng 99% thời gian.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { traLoi, moiHon } = await import("./update-feed.js");

const WIN = (ver: string) => `/updates/api/update/win32-x64/sand/${ver}/may-1/stable`;
const MAC = (ver: string) => `/updates/api/update/darwin-arm64/sand/${ver}/may-1/stable`;

/** Ghi manifest vào thư mục tạm rồi trỏ env sang đó — không chạm `.data` thật. */
const datManifest = (noiDung: unknown): void => {
  const d = mkdtempSync(join(tmpdir(), "gb2-feed-"));
  const p = join(d, "phat-hanh.json");
  writeFileSync(p, JSON.stringify(noiDung));
  process.env.GROKBOT2_RELEASE_MANIFEST = p;
};

test("chưa phát hành lần nào → 204, im lặng", () => {
  process.env.GROKBOT2_RELEASE_MANIFEST = join(tmpdir(), "khong-ton-tai-gb2.json");
  assert.equal(traLoi(WIN("0.29.0")).status, 204);
});

test("manifest HỎNG → 204, không phát bừa bản gần nhất", () => {
  const d = mkdtempSync(join(tmpdir(), "gb2-feed-"));
  const p = join(d, "phat-hanh.json");
  writeFileSync(p, "{ đây không phải json");
  process.env.GROKBOT2_RELEASE_MANIFEST = p;
  assert.equal(traLoi(WIN("0.29.0")).status, 204);
});

test("bản đang chạy BẰNG bản đã phát hành → 204", () => {
  datManifest({ stable: { version: "0.29.3", url: "https://x/y.exe" } });
  assert.equal(traLoi(WIN("0.29.3")).status, 204);
});

test("bản đang chạy MỚI HƠN (máy nội bộ) → 204, không ép hạ cấp", () => {
  datManifest({ stable: { version: "0.29.3", url: "https://x/y.exe" } });
  assert.equal(traLoi(WIN("0.30.0")).status, 204);
});

test("bản đang chạy CŨ HƠN → 200 kèm url + version + sha256", () => {
  datManifest({ stable: { version: "0.29.3", url: "https://x/y.exe", sha256hash: "abc123" } });
  const r = traLoi(WIN("0.29.0"));
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { url: "https://x/y.exe", version: "0.29.3", sha256hash: "abc123" });
});

test("macOS nhận hình dạng của NÓ — có `name`, vì schema squirrel khác iupdate", () => {
  datManifest({ stable: { version: "0.29.3", url: "https://x/y.zip" } });
  const r = traLoi(MAC("0.29.0"));
  assert.equal(r.status, 200);
  assert.equal(r.body?.name, "0.29.3", "thiếu `name` là feed_malformed phía client");
});

test("kênh riêng biệt: dogfood có bản mới KHÔNG làm stable thấy gì", () => {
  datManifest({ dogfood: { version: "0.30.0", url: "https://x/thu.exe" } });
  assert.equal(traLoi(WIN("0.29.0")).status, 204, "người dùng stable phải im lặng");
  assert.equal(traLoi("/updates/api/update/win32-x64/sand-dogfood/0.29.0/may-1/stable").status, 200);
});

test("đường sai hoặc kênh lạ → 400, không đoán bừa", () => {
  datManifest({ stable: { version: "9.9.9", url: "https://x/y.exe" } });
  assert.equal(traLoi("/updates/api/update/win32-x64/khong-co-kenh-nay/0.1.0/m/stable").status, 400);
  assert.equal(traLoi("/updates/api/update/thieu-doan").status, 400);
});

/*
 * So phiên bản bằng SỐ, không bằng chuỗi.
 *
 * `"0.29.10" < "0.29.9"` theo thứ tự chữ — nên nếu so chuỗi thì bản vá thứ mười trở đi sẽ không bao
 * giờ được phát, và triệu chứng là "không ai nhận được bản mới" mà không lỗi nào nổi lên.
 */
test("so phiên bản: 0.29.10 mới hơn 0.29.9", () => {
  assert.equal(moiHon("0.29.10", "0.29.9"), true);
  assert.equal(moiHon("0.29.9", "0.29.10"), false);
  assert.equal(moiHon("0.30.0", "0.29.99"), true);
  assert.equal(moiHon("1.0.0", "0.99.99"), true);
  assert.equal(moiHon("0.29.3", "0.29.3"), false);
});
