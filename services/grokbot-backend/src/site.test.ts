/**
 * Trang tải — hợp đồng của cửa đầu tiên người dùng gặp (site.ts).
 *
 *   npx tsx --test services/grokbot-backend/src/site.test.ts
 *
 * Ba thứ đáng khoá lại. Một: route lạ phải trả `false` để router đi tiếp — một trang tải nuốt
 * `/v1/*` thì hỏng cả backend, và lỗi đó im lặng. Hai: khi chưa dựng gói thì phải nói cách dựng,
 * vì người gặp cảnh đó là người đang phát triển. Ba: nút tải phải là **file đính kèm** — thiếu
 * `content-disposition` thì trình duyệt mở zip như văn bản.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

const { handleSite, newestSetup, SETUP_PREFIX, SETUP_KINDS } = await import("./site.js");

/** `ServerResponse` giả, chỉ giữ đúng ba thứ bài kiểm cần đọc. */
function fakeRes(): ServerResponse & { code: number; headers: Record<string, string>; body: string } {
  const r = {
    code: 0,
    headers: {} as Record<string, string>,
    body: "",
    writeHead(code: number, headers?: Record<string, string>) { r.code = code; Object.assign(r.headers, headers ?? {}); return r; },
    end(chunk?: unknown) { if (typeof chunk === "string") r.body += chunk; return r; },
  };
  return r as unknown as ServerResponse & { code: number; headers: Record<string, string>; body: string };
}

const GET = { method: "GET" } as IncomingMessage;
/** HEAD đi hết đường header rồi dừng trước khi bơm file — đủ để kiểm hợp đồng mà không cần stream giả. */
const HEAD = { method: "HEAD" } as IncomingMessage;

test("route lạ trả false — router đi tiếp, không nuốt /v1", async () => {
  // /download/linux đứng đây có chủ ý: chưa có bản Linux, nên nó phải rơi xuống 404 của router
  // chứ không phải một trang tải rỗng.
  for (const path of ["/v1/login", "/gw/api/listAgents", "/admin", "/downloads", "/download/linux"]) {
    const res = fakeRes();
    assert.equal(await handleSite(path, GET, res), false, `${path} không được nuốt`);
    assert.equal(res.code, 0, `${path} không được trả lời`);
  }
});

test("/ trả trang HTML thật", async () => {
  const res = fakeRes();
  assert.equal(await handleSite("/", GET, res), true);
  assert.equal(res.code, 200);
  assert.match(res.headers["content-type"], /text\/html/);
  assert.match(res.body, /download\/windows/, "trang phải có nút tải");
});

test("/download chuyển sang bản Windows", async () => {
  const res = fakeRes();
  assert.equal(await handleSite("/download", GET, res), true);
  assert.equal(res.code, 302);
  assert.equal(res.headers.location, "/download/windows");
});

test("chưa dựng gói thì 503 kèm cách dựng, không phải 404 trống", async () => {
  // Cùng đường dẫn thật của service; nếu máy đang có gói thì bài này không nói được gì —
  // nên nó chỉ khẳng định điều đúng trong cả hai trường hợp: có gói thì 200, không thì 503 có chỉ dẫn.
  const res = fakeRes();
  await handleSite("/download/windows", HEAD, res);
  if (res.code === 503) assert.match(res.body, /build-setup\.mjs/, "phải chỉ ra lệnh dựng");
  else {
    assert.equal(res.code, 200);
    assert.match(res.headers["content-disposition"], /attachment; filename="/, "phải tải về, không mở trong tab");
    assert.match(res.headers["content-type"], /application\/zip/);
  }
});

test("/download/mac phát gói Mac, không phải gói Windows", async () => {
  const res = fakeRes();
  assert.equal(await handleSite("/download/mac", HEAD, res), true);
  if (res.code === 200) {
    assert.match(res.headers["content-disposition"], /bot-noi-bo-setup-mac/,
      "người dùng Mac tải nhầm gói Windows thì lỗi rất khó hiểu");
  } else {
    assert.equal(res.code, 503);
  }
});

test("hai hệ hai tiền tố khác nhau — không chọn nhầm nhau", () => {
  const dir = mkdtempSync(join(tmpdir(), "setup2-"));
  writeFileSync(join(dir, `${SETUP_KINDS.windows}-20260825.zip`), "win");
  writeFileSync(join(dir, `${SETUP_KINDS.mac}-20260825.zip`), "mac-dai-hon");
  assert.equal(newestSetup(dir, SETUP_KINDS.windows)?.size, "win".length);
  assert.equal(newestSetup(dir, SETUP_KINDS.mac)?.size, "mac-dai-hon".length);
});

test("newestSetup chọn gói mới nhất và bỏ qua file lạ", () => {
  const dir = mkdtempSync(join(tmpdir(), "setup-"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${SETUP_PREFIX}-20260101.zip`), "cu");
  writeFileSync(join(dir, "ghi-chu.txt"), "khong phai goi");
  writeFileSync(join(dir, `${SETUP_PREFIX}-20260825.zip`), "moi hon");
  const found = newestSetup(dir);
  assert.ok(found, "phải thấy một gói");
  assert.equal(found.name, `${SETUP_PREFIX}-20260825.zip`);
  assert.equal(found.size, "moi hon".length);
});

test("thư mục trống trả null thay vì ném lỗi", () => {
  assert.equal(newestSetup(join(tmpdir(), "khong-ton-tai-" + process.pid)), null);
});
