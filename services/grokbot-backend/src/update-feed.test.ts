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


/**
 * Chạy một phép kiểm hợp đồng của cửa GỐC.
 *
 * Cửa ấy im lặng theo mặc định từ 03/09 (updater gốc không cài được bản của mình — nó dò chữ ký và
 * đòi tên người ký của HÃNG). Nhưng hình dạng phản hồi vẫn phải đúng, vì ngày có chứng chỉ ta bật
 * lại bằng đúng cờ này. Nên ba bài dưới bật cờ tường minh thay vì dựa vào một mặc định đã đổi.
 */
const voiCuaGoc = (f: () => void): void => {
  const cu = process.env.GROKBOT2_NATIVE_FEED;
  process.env.GROKBOT2_NATIVE_FEED = "1";
  try { f(); } finally {
    if (cu != null) process.env.GROKBOT2_NATIVE_FEED = cu; else delete process.env.GROKBOT2_NATIVE_FEED;
  }
};

test("bản đang chạy CŨ HƠN → 200 kèm url + version + sha256", () => {
  voiCuaGoc(() => {
    datManifest({ stable: { version: "0.29.3", url: "https://x/y.exe", sha256hash: "abc123" } });
    const r = traLoi(WIN("0.29.0"));
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { url: "https://x/y.exe", version: "0.29.3", sha256hash: "abc123" });
  });
});

test("macOS nhận hình dạng của NÓ — có `name`, vì schema squirrel khác iupdate", () => {
  voiCuaGoc(() => {
    datManifest({ stable: { version: "0.29.3", url: "https://x/y.zip" } });
    const r = traLoi(MAC("0.29.0"));
    assert.equal(r.status, 200);
    assert.equal(r.body?.name, "0.29.3", "thiếu `name` là feed_malformed phía client");
  });
});

test("kênh riêng biệt: dogfood có bản mới KHÔNG làm stable thấy gì", () => {
  voiCuaGoc(() => {
    datManifest({ dogfood: { version: "0.30.0", url: "https://x/thu.exe" } });
    assert.equal(traLoi(WIN("0.29.0")).status, 204, "người dùng stable phải im lặng");
    assert.equal(traLoi("/updates/api/update/win32-x64/sand-dogfood/0.29.0/may-1/stable").status, 200);
  });
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

/*
 * ── Cửa của LAUNCHER ───────────────────────────────────────────────────────────────────────────
 *
 * Đường auto-update thật sự chạy được, vì updater gốc thì không: nó dò chữ ký Authenticode và đòi
 * tên người ký nằm trong `["Anysphere, Inc.","Anysphere"]`. Launcher của mình chạy TRƯỚC client, mỗi
 * lần mở app, nên nó là chỗ duy nhất mình vừa sở hữu trọn vừa chắc chắn được gọi.
 *
 * Khoá hai hướng sai, cùng hai hướng như `traLoi`: trả 200 khi không nên (mọi máy tự cài một bản
 * chưa nghiệm thu) và trả 204 khi đáng ra có bản mới (không ai bao giờ lên bản).
 */
const { traLoiLauncher } = await import("./update-feed.js");

test("launcher: chưa phát hành → 204", () => {
  process.env.GROKBOT2_RELEASE_MANIFEST = join(tmpdir(), "khong-ton-tai-gb2-launcher.json");
  assert.equal(traLoiLauncher("0.29.0").status, 204);
});

test("launcher: bản mới hơn → 200 kèm version + url + hash", () => {
  datManifest({ stable: { version: "0.29.20260904", url: "https://x/download/windows", sha256hash: "abc" } });
  const r = traLoiLauncher("0.29.20260903");
  assert.equal(r.status, 200);
  assert.equal(r.body?.version, "0.29.20260904");
  assert.equal(r.body?.sha256hash, "abc");
});

test("launcher: bằng hoặc cũ hơn → 204", () => {
  datManifest({ stable: { version: "0.29.20260903", url: "https://x/download/windows", sha256hash: "abc" } });
  assert.equal(traLoiLauncher("0.29.20260903").status, 204, "bằng thì đừng cài lại");
  assert.equal(traLoiLauncher("0.29.20260904").status, 204, "máy mới hơn manifest thì cũng đừng");
});

test("launcher: KHÔNG đọc được phiên bản đang cài thì vẫn trả bản mới nhất", () => {
  // Thà cài lại đúng bản đang có còn hơn im lặng bỏ qua cập nhật mãi mãi. Một client mà launcher
  // không đọc nổi `package.json` là client vừa bị thay bởi thứ gì đó — đúng lúc cần cài lại nhất.
  datManifest({ stable: { version: "0.29.20260903", url: "https://x/download/windows" } });
  assert.equal(traLoiLauncher("").status, 200);
});

test("launcher: nền mac nhận gói mac", () => {
  datManifest({
    stable: {
      version: "0.29.20260904", url: "https://x/download/windows", sha256hash: "abc",
      mac: { url: "https://x/download/mac", sha256hash: "abc-mac" },
    },
  });
  assert.match(traLoiLauncher("0.29.1", "mac").body?.url ?? "", /\/download\/mac$/);
  assert.match(traLoiLauncher("0.29.1", "windows").body?.url ?? "", /\/download\/windows$/);
});

test("launcher: kênh đọc từ GROKBOT2_LAUNCHER_KENH", () => {
  datManifest({ dogfood: { version: "0.29.20260905", url: "https://x/download/windows" } });
  assert.equal(traLoiLauncher("0.29.1").status, 204, "mặc định là stable, mà manifest chỉ có dogfood");
  const cu = process.env.GROKBOT2_LAUNCHER_KENH;
  process.env.GROKBOT2_LAUNCHER_KENH = "dogfood";
  try { assert.equal(traLoiLauncher("0.29.1").status, 200); }
  finally { if (cu != null) process.env.GROKBOT2_LAUNCHER_KENH = cu; else delete process.env.GROKBOT2_LAUNCHER_KENH; }
});

/*
 * ── Hai cửa, một manifest: chúng KHÔNG được kéo nhau ───────────────────────────────────────────
 *
 * Đo 03/09: phát hành kênh `stable` cho LAUNCHER làm cửa updater GỐC tự trả 200 theo, vì cả hai đọc
 * cùng một khoá manifest. Cửa gốc trả 200 nghĩa là banner hiện rồi Install thất bại ở phép dò chữ ký
 * — tệ hơn là không có banner. Mở một đường không được phép tự mở đường kia.
 */
test("cửa GỐC im lặng theo mặc định, kể cả khi manifest đã có bản mới", () => {
  datManifest({ stable: { version: "0.29.20260904", url: "https://x/download/windows", sha256hash: "a" } });
  assert.equal(traLoi(WIN("0.29.0")).status, 204, "updater gốc không cài được bản của mình — đừng mời nó thử");
  assert.equal(traLoiLauncher("0.29.0").status, 200, "cửa launcher thì phải trả — đó là đường chạy được");
});

test("cửa GỐC mở lại bằng GROKBOT2_NATIVE_FEED=1 — dành cho ngày có chứng chỉ", () => {
  datManifest({ stable: { version: "0.29.20260904", url: "https://x/download/windows", sha256hash: "a" } });
  const cu = process.env.GROKBOT2_NATIVE_FEED;
  process.env.GROKBOT2_NATIVE_FEED = "1";
  try { assert.equal(traLoi(WIN("0.29.0")).status, 200); }
  finally { if (cu != null) process.env.GROKBOT2_NATIVE_FEED = cu; else delete process.env.GROKBOT2_NATIVE_FEED; }
});

test("launcher Mac nhận ĐÚNG hash và tên file của gói mac", () => {
  datManifest({
    stable: {
      version: "0.29.20260904", url: "https://x/download/windows", sha256hash: "hash-win", ten: "win.cmd",
      mac: { url: "https://x/download/mac", sha256hash: "hash-mac", ten: "mac.command" },
    },
  });
  const w = traLoiLauncher("0.29.0", "windows").body;
  const m = traLoiLauncher("0.29.0", "mac").body;
  assert.equal(w?.sha256hash, "hash-win");
  assert.equal(m?.sha256hash, "hash-mac", "trả hash Windows cho Mac là làm launcher Mac bỏ qua cập nhật MÃI MÃI");
  assert.equal(m?.ten, "mac.command");
});

test("manifest chưa có khoá mac → Mac nhận 204, KHÔNG nhận gói Windows đội lốt", () => {
  datManifest({ stable: { version: "0.29.20260904", url: "https://x/download/windows", sha256hash: "hash-win" } });
  assert.equal(traLoiLauncher("0.29.0", "mac").status, 204);
  assert.equal(traLoiLauncher("0.29.0", "windows").status, 200);
});

/*
 * ── Launcher của bản CHỞ CẢ APP trình token ────────────────────────────────────────────────────
 *
 * Máy cài bản 105 MB có client nằm CẠNH launcher, không ở `%LOCALAPPDATA%\Programs\Grok Bot`. Cài
 * bản 50 KB lên máy ấy là sai gói: nó vá một client không tồn tại rồi báo lỗi. Nên launcher đọc
 * `token.txt` (bộ cài đặt cạnh app lúc dựng) và hỏi kèm `k=`; đúng token thì nhận khoá `full`.
 */
const voiToken = <T>(token: string | undefined, f: () => T): T => {
  const cu = process.env.GROKBOT2_FULL_DOWNLOAD_TOKEN;
  if (token == null) delete process.env.GROKBOT2_FULL_DOWNLOAD_TOKEN; else process.env.GROKBOT2_FULL_DOWNLOAD_TOKEN = token;
  try { return f(); } finally {
    if (cu != null) process.env.GROKBOT2_FULL_DOWNLOAD_TOKEN = cu; else delete process.env.GROKBOT2_FULL_DOWNLOAD_TOKEN;
  }
};
const MANIFEST_FULL = {
  stable: {
    version: "0.29.20260904", url: "https://x/download/windows", sha256hash: "hash-cmd", ten: "Cai-dat.cmd",
    full: { sha256hash: "hash-full", ten: "Bot-Noi-Bo-Setup-20260904.exe" },
  },
};

test("launcher + token ĐÚNG → gói chở-app, url mang ?k=, hash + tên của gói ấy", () => {
  datManifest(MANIFEST_FULL);
  const b = voiToken("bi-mat", () => traLoiLauncher("0.29.0", "windows", "bi-mat")).body;
  assert.equal(b?.ten, "Bot-Noi-Bo-Setup-20260904.exe");
  assert.equal(b?.sha256hash, "hash-full", "hash phải là của gói chở-app — lấy hash bản 50 KB là launcher xoá file rồi bỏ qua mãi mãi");
  assert.equal(b?.url, "https://x/download/windows?k=bi-mat", "đường tải ghép token lúc trả lời; manifest không chứa token");
});

test("launcher + token SAI → rơi về gói công khai, KHÔNG 403, không lộ là có bản khác", () => {
  datManifest(MANIFEST_FULL);
  const r = voiToken("bi-mat", () => traLoiLauncher("0.29.0", "windows", "doan-bua"));
  assert.equal(r.status, 200);
  assert.equal(r.body?.ten, "Cai-dat.cmd");
  assert.equal(r.body?.sha256hash, "hash-cmd");
});

test("token ĐÚNG nhưng manifest chưa có `full` → 204, không đội lốt bản 50 KB", () => {
  datManifest({ stable: { version: "0.29.20260904", url: "https://x/download/windows", sha256hash: "hash-cmd", ten: "Cai-dat.cmd" } });
  assert.equal(voiToken("bi-mat", () => traLoiLauncher("0.29.0", "windows", "bi-mat")).status, 204);
});

test("máy chủ chưa đặt token → mọi `k` đều bị coi như không có", () => {
  datManifest(MANIFEST_FULL);
  const r = voiToken(undefined, () => traLoiLauncher("0.29.0", "windows", "bi-mat"));
  assert.equal(r.body?.ten, "Cai-dat.cmd", "token rỗng ở máy chủ phải là 'đóng', không phải 'ai gửi gì cũng khớp'");
});

test("launcher chở-app đã ở bản mới → 204, dù trình đúng token", () => {
  datManifest(MANIFEST_FULL);
  assert.equal(voiToken("bi-mat", () => traLoiLauncher("0.29.20260904", "windows", "bi-mat")).status, 204);
});
