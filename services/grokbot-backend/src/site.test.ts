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
import { mkdtempSync, writeFileSync, mkdirSync, utimesSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";

const { handleSite, newestSetup, SETUP_KINDS } = await import("./site.js");
const { registerUser } = await import("./web-auth.js");

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
    assert.match(res.headers["content-type"], /octet-stream/);
  }
});

test("/download/mac phát gói Mac, không phải gói Windows", async () => {
  const res = fakeRes();
  assert.equal(await handleSite("/download/mac", HEAD, res), true);
  if (res.code === 200) {
    assert.match(res.headers["content-disposition"], /Cai-dat-Bot-Noi-Bo-mac.*\.command/,
      "người dùng Mac tải nhầm gói Windows thì lỗi rất khó hiểu");
  } else {
    assert.equal(res.code, 503);
  }
});

test("thứ tự ưu tiên: bản chở app → bản cấu hình → .cmd", () => {
  const dir = mkdtempSync(join(tmpdir(), "setup3-"));
  const [full, cfg, cmd] = SETUP_KINDS.windows;
  // Chỉ có .cmd: phải dùng nó, không được trả null.
  writeFileSync(join(dir, `${cmd.prefix}-20260825${cmd.ext}`), "ban cmd");
  assert.match(newestSetup(dir, "windows")?.name ?? "", /\.cmd$/, "chưa có .exe thì dùng .cmd");
  // Thêm bản cấu hình: .exe thắng .cmd dù .cmd mới hơn — dạng quan trọng hơn thời gian.
  writeFileSync(join(dir, `${cfg.prefix}0260825${cfg.ext}`), "ban cau hinh");
  assert.match(newestSetup(dir, "windows")?.name ?? "", /^Cai-dat-Bot-Noi-Bo-2/, "có bản .exe cấu hình thì dùng nó");
  // Thêm bản chở app: nó phải thắng cả hai, vì nó là bản người tải về không cần chuẩn bị gì.
  writeFileSync(join(dir, `${full.prefix}-20260825${full.ext}`), "ban cho app");
  assert.match(newestSetup(dir, "windows")?.name ?? "", /^Bot-Noi-Bo-Setup/, "bản chở app phải thắng");
});

test("hai hệ hai tiền tố khác nhau — không chọn nhầm nhau", () => {
  const dir = mkdtempSync(join(tmpdir(), "setup2-"));
  // Lấy dạng cuối của mỗi hệ (.cmd cho Windows) — dạng đầu là .exe, chỉ có khi máy dựng có Inno Setup.
  const win = SETUP_KINDS.windows.at(-1)!, mac = SETUP_KINDS.mac.at(-1)!;
  writeFileSync(join(dir, `${win.prefix}-20260825${win.ext}`), "win");
  writeFileSync(join(dir, `${mac.prefix}-20260825${mac.ext}`), "mac-dai-hon");
  assert.equal(newestSetup(dir, "windows")?.size, "win".length);
  assert.equal(newestSetup(dir, "mac")?.size, "mac-dai-hon".length);
});

test("newestSetup chọn gói mới nhất và bỏ qua file lạ", () => {
  const dir = mkdtempSync(join(tmpdir(), "setup-"));
  mkdirSync(dir, { recursive: true });
  const { prefix, ext } = SETUP_KINDS.windows.at(-1)!;
  writeFileSync(join(dir, `${prefix}-20260101${ext}`), "cu");
  writeFileSync(join(dir, "ghi-chu.txt"), "khong phai goi");
  writeFileSync(join(dir, `${prefix}-20260825${ext}`), "moi hon");
  const found = newestSetup(dir);
  assert.ok(found, "phải thấy một gói");
  assert.equal(found.name, `${prefix}-20260825${ext}`);
  assert.equal(found.size, "moi hon".length);
});

test("thư mục trống trả null thay vì ném lỗi", () => {
  assert.equal(newestSetup(join(tmpdir(), "khong-ton-tai-" + process.pid)), null);
});

/*
 * Chính sách đăng ký — kiểm qua CỬA CÔNG KHAI (`registerUser`), không qua hàm nội bộ.
 *
 * Bài này chỉ khoá nhánh "bật cờ thì mở", vì nhánh "sổ trống thì mở" cần một sổ riêng — nhánh đó đã
 * được chứng minh trên máy thật ở chặng 2: đóng thì `/v1/register` trả **403**, mở cờ thì **200**.
 */
test("bật GROKBOT2_ALLOW_REGISTER=1 thì đăng ký không bị chặn vì lý do chính sách", () => {
  const before = process.env.GROKBOT2_ALLOW_REGISTER;
  process.env.GROKBOT2_ALLOW_REGISTER = "1";
  try {
    const out = registerUser("khong-phai-email", "mat-khau-du-dai");
    // Vẫn hỏng — nhưng vì email sai, KHÔNG phải vì chính sách. Đó là điều cần khẳng định.
    assert.equal(out.ok, false);
    assert.notEqual(out.error, "registration is closed");
  } finally {
    if (before === undefined) delete process.env.GROKBOT2_ALLOW_REGISTER;
    else process.env.GROKBOT2_ALLOW_REGISTER = before;
  }
});

/*
 * Gói CŨ thuộc loại "sang" không được thắng gói MỚI thuộc loại thường.
 *
 * Đo 03/09 trên máy thật: `/download/windows` phát `Bot-Noi-Bo-Setup-20260827.exe` trong khi
 * `Cai-dat-Bot-Noi-Bo-20260902.exe` đã nằm cạnh — vì bản cũ duyệt theo THỨ TỰ LOẠI và trả về ngay
 * khi loại đầu tiên có file. Người tải nhận gói thiếu sáu ngày tính năng, gồm cả bản vá chặn app tự
 * cập nhật, và không có cách nào tự biết.
 */
test("trang tải phát gói MỚI NHẤT, kể cả khi nó thuộc loại xếp sau", () => {
  const dir = mkdtempSync(join(tmpdir(), "gb2-site-"));
  // Loại ưu tiên cao (chở-cả-app) nhưng CŨ.
  writeFileSync(join(dir, "Bot-Noi-Bo-Setup-20260827.exe"), "cu");
  // Loại xếp sau nhưng MỚI.
  const moi = join(dir, "Cai-dat-Bot-Noi-Bo-20260902.exe");
  writeFileSync(moi, "moi");
  utimesSync(join(dir, "Bot-Noi-Bo-Setup-20260827.exe"), new Date(1), new Date(1));
  utimesSync(moi, new Date(2_000_000_000_000), new Date(2_000_000_000_000));

  assert.equal(newestSetup(dir, "windows")?.name, "Cai-dat-Bot-Noi-Bo-20260902.exe");
});

test("bằng tuổi thì loại đứng trước trong danh sách thắng", () => {
  const dir = mkdtempSync(join(tmpdir(), "gb2-site-"));
  const a = join(dir, "Bot-Noi-Bo-Setup-20260902.exe");
  const b = join(dir, "Cai-dat-Bot-Noi-Bo-20260902.exe");
  writeFileSync(a, "a");
  writeFileSync(b, "b");
  const t = new Date(1_900_000_000_000);
  utimesSync(a, t, t);
  utimesSync(b, t, t);

  assert.equal(newestSetup(dir, "windows")?.name, "Bot-Noi-Bo-Setup-20260902.exe");
});

/*
 * ── Kích cỡ gói: ĐO, không gõ tay ───────────────────────────────────────────────────────────────
 *
 * Trang từng ghi cứng "bộ cài 28 KB" ở hai chỗ và "27 KB" cho Mac. Đo E2E 03/09 bằng chính trình
 * duyệt trên `cinai.app/agent`: gói Windows đang phát là **2.0 MB**. Con số sai gần trăm lần, và nó
 * sai một cách không ai thấy được — vì nó nằm trong HTML còn file thì đổi theo mỗi lần phát hành.
 *
 * Bài này khoá đúng cái hồi quy đó: một con số về FILE không được nằm trong HTML.
 */
test("trang tải không ghi cứng kích cỡ bộ cài — phải là placeholder", () => {
  const html = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "apps", "grokbot-site", "index.html"),
    "utf8",
  );
  assert.ok(html.includes("{{CO_WIN}}"), "thiếu {{CO_WIN}} — kích cỡ Windows đang bị gõ tay?");
  assert.ok(html.includes("{{CO_MAC}}"), "thiếu {{CO_MAC}} — kích cỡ Mac đang bị gõ tay?");
  // "bộ cài <số> KB/MB" là dạng câu đã sai một lần. Không cho nó quay lại dưới bất kỳ con số nào.
  assert.doesNotMatch(html, /bộ cài\s+\d+([.,]\d+)?\s*(KB|MB)/i, "có người gõ lại một con số kích cỡ");
});
