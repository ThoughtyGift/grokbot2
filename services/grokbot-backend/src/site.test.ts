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

/*
 * Tiền tố viết THẲNG, không lấy theo vị trí trong `SETUP_KINDS`.
 *
 * Bản trước dùng `SETUP_KINDS.windows.at(-1)!` với chú thích "dạng cuối là .cmd". Ngày 03/09 tôi sắp
 * lại danh sách và ba bài test đổi nghĩa trong im lặng — chúng vẫn xanh/đỏ vì lý do khác hẳn thứ
 * chúng định khoá. Một bài test trỏ vào "phần tử cuối" là một bài test có thể bị đổi ý nghĩa bởi một
 * lần sắp lại mảng.
 */
const CMD = { prefix: "Cai-dat-Bot-Noi-Bo-win", ext: ".cmd" };
const EXE_CHUA_KY = { prefix: "Cai-dat-Bot-Noi-Bo-2", ext: ".exe" };
const CHO_APP = { prefix: "Bot-Noi-Bo-Setup", ext: ".exe" };

test("KHÔNG phát .exe chưa ký số, dù nó mới hơn — Defender xoá nó", () => {
  const dir = mkdtempSync(join(tmpdir(), "setup3-"));
  writeFileSync(join(dir, `${CMD.prefix}-20260825${CMD.ext}`), "ban cmd");
  assert.match(newestSetup(dir, "windows")?.name ?? "", /\.cmd$/);

  // `.exe` 2 MB mới hơn hẳn. Trước 03/09 nó thắng; nay bị loại vì `Trojan:Win32/Wacatac.B!ml`.
  const exe = join(dir, `${EXE_CHUA_KY.prefix}0260903${EXE_CHUA_KY.ext}`);
  writeFileSync(exe, "ban cau hinh");
  utimesSync(exe, new Date(2_000_000_000_000), new Date(2_000_000_000_000));
  assert.match(newestSetup(dir, "windows")?.name ?? "", /\.cmd$/, "một bộ cài bị xoá trước khi chạy thì không phải bộ cài");

  /*
   * Bản chở-cả-app dù MỚI NHẤT vẫn KHÔNG được ra cửa công khai.
   *
   * Đây là ranh giới của `docs/legal.md` ("Do not redistribute a modified client"), nên nó không được
   * dựa vào ngày tháng. Bản trước chỉ dựa vào "gói kia mới hơn" — và bài test này, khi hai file cùng
   * tuổi, đã cho thấy nút công khai phát 118 MB mà không ai cố ý.
   */
  const full = join(dir, `${CHO_APP.prefix}-20260903${CHO_APP.ext}`);
  writeFileSync(full, "ban cho app");
  utimesSync(full, new Date(2_100_000_000_000), new Date(2_100_000_000_000));
  assert.match(newestSetup(dir, "windows")?.name ?? "", /\.cmd$/,
    "gói chở client của nhà phát hành KHÔNG được ra nút Tải, kể cả khi nó mới nhất");
});

test("cờ GROKBOT2_PHAT_EXE_CHUA_KY=1 mở lại .exe — để thử, không phải mặc định", () => {
  const dir = mkdtempSync(join(tmpdir(), "setup4-"));
  writeFileSync(join(dir, `${CMD.prefix}-20260825${CMD.ext}`), "cmd");
  const exe = join(dir, `${EXE_CHUA_KY.prefix}0260903${EXE_CHUA_KY.ext}`);
  writeFileSync(exe, "exe");
  utimesSync(exe, new Date(2_000_000_000_000), new Date(2_000_000_000_000));

  const cu = process.env.GROKBOT2_PHAT_EXE_CHUA_KY;
  process.env.GROKBOT2_PHAT_EXE_CHUA_KY = "1";
  try {
    assert.match(newestSetup(dir, "windows")?.name ?? "", /\.exe$/);
  } finally {
    if (cu != null) process.env.GROKBOT2_PHAT_EXE_CHUA_KY = cu; else delete process.env.GROKBOT2_PHAT_EXE_CHUA_KY;
  }
});

test("hai hệ hai tiền tố khác nhau — không chọn nhầm nhau", () => {
  const dir = mkdtempSync(join(tmpdir(), "setup2-"));
  const mac = SETUP_KINDS.mac[0];
  writeFileSync(join(dir, `${CMD.prefix}-20260825${CMD.ext}`), "win");
  writeFileSync(join(dir, `${mac.prefix}-20260825${mac.ext}`), "mac-dai-hon");
  assert.equal(newestSetup(dir, "windows")?.size, "win".length);
  assert.equal(newestSetup(dir, "mac")?.size, "mac-dai-hon".length);
});

test("newestSetup chọn gói mới nhất và bỏ qua file lạ", () => {
  const dir = mkdtempSync(join(tmpdir(), "setup-"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${CMD.prefix}-20260101${CMD.ext}`), "cu");
  writeFileSync(join(dir, "ghi-chu.txt"), "khong phai goi");
  writeFileSync(join(dir, `${CMD.prefix}-20260825${CMD.ext}`), "moi hon");
  const found = newestSetup(dir);
  assert.ok(found, "phải thấy một gói");
  assert.equal(found.name, `${CMD.prefix}-20260825${CMD.ext}`);
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
  // Loại xếp TRƯỚC (chở-cả-app) nhưng CŨ.
  writeFileSync(join(dir, "Bot-Noi-Bo-Setup-20260827.exe"), "cu");
  // Loại xếp sau nhưng MỚI. Dùng `.cmd` chứ không `.exe` 2 MB: bản `.exe` nay bị loại vì antivirus,
  // nên nếu viết bằng nó thì bài này khoá sai luật — độ mới thắng, không phải "exe thắng".
  const moi = join(dir, "Cai-dat-Bot-Noi-Bo-win-20260902.cmd");
  writeFileSync(moi, "moi");
  utimesSync(join(dir, "Bot-Noi-Bo-Setup-20260827.exe"), new Date(1), new Date(1));
  utimesSync(moi, new Date(2_000_000_000_000), new Date(2_000_000_000_000));

  assert.equal(newestSetup(dir, "windows")?.name, "Cai-dat-Bot-Noi-Bo-win-20260902.cmd");
});

test("bằng tuổi thì loại đứng trước trong danh sách thắng", () => {
  /*
   * Phá hoà chỉ xét giữa các loại ĐƯỢC PHÁT CÔNG KHAI. Bản trước dùng gói chở-cả-app làm một vế —
   * nay nó bị loại khỏi cửa công khai bằng cờ `chiRieng`, nên hai vế phải là `.cmd` và `.exe` 2 MB
   * (mở tạm bằng cờ). `.cmd` đứng trước trong danh sách, nên hoà thì nó thắng.
   */
  const dir = mkdtempSync(join(tmpdir(), "gb2-site-"));
  const a = join(dir, `${CMD.prefix}-20260902${CMD.ext}`);
  const b = join(dir, `${EXE_CHUA_KY.prefix}0260902${EXE_CHUA_KY.ext}`);
  writeFileSync(a, "a");
  writeFileSync(b, "b");
  const t = new Date(1_900_000_000_000);
  utimesSync(a, t, t);
  utimesSync(b, t, t);

  const cu = process.env.GROKBOT2_PHAT_EXE_CHUA_KY;
  process.env.GROKBOT2_PHAT_EXE_CHUA_KY = "1";
  try {
    assert.equal(newestSetup(dir, "windows")?.name, `${CMD.prefix}-20260902${CMD.ext}`);
  } finally {
    if (cu != null) process.env.GROKBOT2_PHAT_EXE_CHUA_KY = cu; else delete process.env.GROKBOT2_PHAT_EXE_CHUA_KY;
  }
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
  /*
   * Phiên bản cũng vậy: đọc từ manifest qua `{{PHIEN_BAN}}`/`{{NGAY_BAN}}`, không gõ tay. Một số
   * phiên bản viết cứng trong HTML sẽ sai ngay lần phát hành kế tiếp — và sai ở đúng chỗ người dùng
   * nhìn để biết mình tải bản nào.
   */
  assert.ok(html.includes("{{PHIEN_BAN}}"), "thiếu {{PHIEN_BAN}} — trang phải nói rõ bản nào");
  assert.ok(html.includes("{{NGAY_BAN}}"), "thiếu {{NGAY_BAN}}");
  assert.doesNotMatch(html, /Phiên bản\s+\d+\.\d+\.\d+/i, "có người gõ cứng một số phiên bản");
});

test("trang tải có ĐÚNG MỘT nút tải (hero) ngoài nav — khối CTA cuối trang lặp đã bỏ", () => {
  const html = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "apps", "grokbot-site", "index.html"),
    "utf8",
  );
  // nav "Tải xuống" + hero "Tải cho Windows" = 2. Cái thứ ba từng là khối `.close` ở cuối trang.
  const soNutWin = (html.match(/href="download\/windows"/g) ?? []).length;
  assert.equal(soNutWin, 2, `có ${soNutWin} link download/windows — hai nút tải trỏ cùng chỗ là một câu hỏi phải trả lời hai lần`);
  assert.doesNotMatch(html, /class="close"/, "khối CTA lặp cuối trang phải bỏ");
});

/*
 * ── Nút công khai phát bản chở-app: một CỜ, không phải mặc định ─────────────────────────────────
 *
 * Quyết định của chủ dự án 03/09 (ghi trong docs/legal.md). Mã giữ nó là `GROKBOT2_PUBLIC_FULL=1`:
 * tắt ⇒ hành vi cũ (gói 50 KB, gói chở-app chỉ sau `?k=`); bật ⇒ `/download/windows` phát gói chở-app
 * cho mọi người. Và vì nghĩa của `/download/windows` nay đổi theo cờ, cửa `/download/windows-cfg` ra
 * đời với nghĩa CỐ ĐỊNH — manifest của launcher công khai trỏ vào đó, không thì bật cờ là hash lệch.
 */
const voiCongKhaiFull = async <T>(bat: boolean, f: () => Promise<T>): Promise<T> => {
  const cu = process.env.GROKBOT2_PUBLIC_FULL;
  if (bat) process.env.GROKBOT2_PUBLIC_FULL = "1"; else delete process.env.GROKBOT2_PUBLIC_FULL;
  try { return await f(); } finally {
    if (cu != null) process.env.GROKBOT2_PUBLIC_FULL = cu; else delete process.env.GROKBOT2_PUBLIC_FULL;
  }
};

test("GROKBOT2_PUBLIC_FULL=1 → nút công khai phát bản chở-app; tắt → vẫn gói 50 KB", async () => {
  const dir = mkdtempSync(join(tmpdir(), "gb2-full-"));
  writeFileSync(join(dir, "Bot-Noi-Bo-Setup-20260903.exe"), "cho ca app");
  writeFileSync(join(dir, `${CMD.prefix}-20260903${CMD.ext}`), "50KB");

  assert.equal((await voiCongKhaiFull(true, () => dungCuaTai(dir, "/download/windows", undefined))).ten, "Bot-Noi-Bo-Setup-20260903.exe");
  assert.equal((await voiCongKhaiFull(false, () => dungCuaTai(dir, "/download/windows", undefined))).ten, `${CMD.prefix}-20260903${CMD.ext}`,
    "mặc định phải là hành vi cũ — cờ này chỉ máy chủ của chủ dự án đặt");
});

test("/download/windows-cfg LUÔN là bộ cấu hình, kể cả khi cờ bật", async () => {
  const dir = mkdtempSync(join(tmpdir(), "gb2-cfg-"));
  writeFileSync(join(dir, "Bot-Noi-Bo-Setup-20260903.exe"), "cho ca app");
  writeFileSync(join(dir, `${CMD.prefix}-20260903${CMD.ext}`), "50KB");
  // Đây là cửa manifest của launcher công khai trỏ vào: đổi cờ không được làm nó đổi file.
  assert.equal((await voiCongKhaiFull(true, () => dungCuaTai(dir, "/download/windows-cfg", undefined))).ten, `${CMD.prefix}-20260903${CMD.ext}`);
  assert.equal((await voiCongKhaiFull(false, () => dungCuaTai(dir, "/download/windows-cfg", undefined))).ten, `${CMD.prefix}-20260903${CMD.ext}`);
});

/*
 * ── Đường tải riêng `?k=` cho bản chở-cả-app ────────────────────────────────────────────────────
 *
 * Trang hứa đường này từ lâu và JS của nó còn đổi chữ thành "bản chở cả ứng dụng (118 MB)" khi thấy
 * `?k=`. Máy chủ thì **chưa bao giờ đọc `k`** — nên ai có token vẫn nhận gói 50 KB trong khi trang
 * nói là 118 MB. Phát hiện 03/09 bằng cách grep `site.ts`: không một dòng nào chạm tham số đó.
 *
 * Hai luật, và luật thứ hai quan trọng hơn: token sai thì **rơi về gói công khai**, KHÔNG phải 403.
 * Một câu 403 xác nhận "có một bản khác ở đây" cho bất kỳ ai thử đoán.
 */
const dungCuaTai = async (dir: string, url: string, token?: string): Promise<{ code: number; ten?: string }> => {
  const cu = process.env.GROKBOT2_FULL_DOWNLOAD_TOKEN;
  const cuDist = process.env.GROKBOT2_DIST_DIR;
  if (token != null) process.env.GROKBOT2_FULL_DOWNLOAD_TOKEN = token; else delete process.env.GROKBOT2_FULL_DOWNLOAD_TOKEN;
  process.env.GROKBOT2_DIST_DIR = dir;
  try {
    let code = 0; let ten: string | undefined;
    const res = {
      writeHead(c: number, h?: Record<string, string>) { code = c; ten = /filename="([^"]+)"/.exec(h?.["content-disposition"] ?? "")?.[1]; },
      end() {}, on() {}, once() {}, emit() {},
    } as unknown as ServerResponse;
    await handleSite(url, { method: "HEAD" } as IncomingMessage, res);
    return { code, ten };
  } finally {
    if (cu != null) process.env.GROKBOT2_FULL_DOWNLOAD_TOKEN = cu; else delete process.env.GROKBOT2_FULL_DOWNLOAD_TOKEN;
    if (cuDist != null) process.env.GROKBOT2_DIST_DIR = cuDist; else delete process.env.GROKBOT2_DIST_DIR;
  }
};

test("token ĐÚNG → phát bản chở-cả-app; token SAI → rơi về gói công khai, không lộ là có bản khác", async () => {
  const dir = mkdtempSync(join(tmpdir(), "gb2-k-"));
  writeFileSync(join(dir, "Bot-Noi-Bo-Setup-20260903.exe"), "day la ban cho ca app");
  writeFileSync(join(dir, `${CMD.prefix}-20260903${CMD.ext}`), "day la ban 50KB");

  assert.equal((await dungCuaTai(dir, "/download/windows?k=bi-mat", "bi-mat")).ten, "Bot-Noi-Bo-Setup-20260903.exe");
  assert.equal((await dungCuaTai(dir, "/download/windows?k=doan-bua", "bi-mat")).ten, `${CMD.prefix}-20260903${CMD.ext}`);
  assert.equal((await dungCuaTai(dir, "/download/windows", "bi-mat")).ten, `${CMD.prefix}-20260903${CMD.ext}`);
});

test("chưa đặt token thì `?k=` bất kỳ cũng KHÔNG mở được bản chở-cả-app", async () => {
  const dir = mkdtempSync(join(tmpdir(), "gb2-k2-"));
  writeFileSync(join(dir, "Bot-Noi-Bo-Setup-20260903.exe"), "x");
  writeFileSync(join(dir, `${CMD.prefix}-20260903${CMD.ext}`), "y");
  // Token rỗng phải là "đóng", không phải "ai gửi chuỗi rỗng cũng vào được".
  assert.equal((await dungCuaTai(dir, "/download/windows?k=", undefined)).ten, `${CMD.prefix}-20260903${CMD.ext}`);
});

/*
 * Ngày phát hành trên trang: từ khi manifest chép số của bundle (06/09), đuôi version là ngày ĐÓNG DẤU (patch-client),
 * còn ngày phát hành nằm trong TÊN GÓI. Đo bằng Chrome thật 06/09: trang ghi "phát hành 05/09/2026" cho bản phát 06/09.
 */
test("ngayPhatHanh: ưu tiên ngày trong tên gói, rơi về đuôi version, không có gì thì gạch", async () => {
  const { ngayPhatHanh } = await import("./site.js");
  assert.equal(ngayPhatHanh({ version: "0.43.20260905", ten: "Cai-dat-Bot-Noi-Bo-win-20260906.cmd" }), "06/09/2026");
  assert.equal(ngayPhatHanh({ version: "0.29.20260903" }), "03/09/2026");
  assert.equal(ngayPhatHanh({ version: "0.43.20260905", ten: "khong-co-ngay.cmd" }), "05/09/2026");
  assert.equal(ngayPhatHanh(undefined), "—");
});
