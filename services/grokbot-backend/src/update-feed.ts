/**
 * Kênh cập nhật của app local — máy chủ trả lời "có bản mới không".
 *
 * Client (đã vá `update-feed`) hỏi đúng một đường, hình dạng lấy từ `buildUpdateRequestUrl` trong
 * `electron-main` 0.30:
 *
 *     GET /updates/api/update/{nền}/{tênKênh}/{phiênBảnĐangChạy}/{máy}/stable
 *
 * Trả lời chỉ có hai dạng — trích từ `fetchUpdate` + schema zod của client:
 *
 *     204 No Content                      → "không có gì mới" (đường đi 99% thời gian)
 *     { url, version, sha256hash? }       → Windows (`iupdate`): tải .exe rồi cài lúc thoát
 *     { url, name }                       → macOS (`squirrel`): tải .zip
 *
 * Sai schema là client ném `feed_malformed`; sai `sha256hash` là nó bỏ gói đã tải. Nên trả THIẾU
 * còn hơn trả bừa.
 *
 * ── Điều quan trọng nhất về file này ──────────────────────────────────────────────────────────
 *
 * Nó đọc **manifest**, không đọc kho code. Sửa code, xoá tính năng, commit hỏng rồi sửa lại — không
 * dòng nào ở đây đổi. Chỉ khi `phat-hanh.mjs` ghi manifest thì máy người dùng mới thấy banner. Đó
 * là toàn bộ điểm của thiết kế: `docs/plan/quy-trinh-phat-hanh-app-local.md`.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { dataDir } from "./store.js";

/** Ba kênh của client (`appNameForTrack`): stable→sand · nightly→sand-nightly · dogfood→sand-dogfood. */
const KENH: Record<string, string> = { sand: "stable", "sand-nightly": "nightly", "sand-dogfood": "dogfood" };

export interface BanPhatHanh {
  version: string;
  url: string;
  sha256hash?: string;
  /** macOS dùng `name` thay cho `version` trong phản hồi (schema squirrel). */
  name?: string;
  /*
   * Tên file của gói — CHỈ cho cửa launcher, không bao giờ gửi cho updater gốc (schema zod của nó
   * chỉ nhận `url`/`version`/`sha256hash`).
   *
   * Có nó vì launcher phải lưu file tải về với ĐÚNG đuôi rồi mới chạy được: hôm nay gói là `.cmd`
   * (Defender xoá `.exe` chưa ký), ngày có chứng chỉ nó thành `.exe`. Một đuôi ghim cứng trong
   * launcher sẽ hỏng đúng vào ngày mọi thứ khác vừa được sửa.
   */
  ten?: string;
  /**
   * Gói của macOS — khoá THÊM, vì `url`/`sha256hash`/`ten` ở mức trên là của Windows.
   *
   * Bản đầu của cửa launcher chỉ đổi đuôi URL sang `/download/mac` mà vẫn trả hash và tên file của
   * gói Windows. Launcher Mac sẽ tải đúng gói mac, so với hash sai, thấy lệch, rồi **lặng lẽ bỏ qua
   * cập nhật mãi mãi** — kiểu hỏng tệ nhất: một cơ chế an toàn (kiểm hash) biến thành cơ chế chặn,
   * và không ai thấy vì nhánh đó in một dòng rồi thoát 0. Đo 03/09, ngay lượt curl đầu sau phát hành.
   */
  mac?: { url: string; sha256hash?: string; ten?: string };
  /**
   * Bản CHỞ CẢ APP (`Bot-Noi-Bo-Setup-*.exe`) — chỉ trả cho launcher nào trình đúng token.
   *
   * Không có `url` ở đây: đường tải là `{url Windows}?k=<token>`, ghép lúc trả lời từ chính token
   * người hỏi vừa trình — để manifest trên đĩa không chứa token, và để đổi token không phải phát
   * hành lại.
   */
  full?: {
    /**
     * Đường tải gói chở-app KHÔNG kèm token (token ghép lúc trả lời). Có mặt vì `url` ở mức trên nay
     * trỏ `/download/windows-cfg` (bộ cấu hình, nghĩa cố định) — còn `/download/windows` thì phát gì
     * tuỳ `GROKBOT2_PUBLIC_FULL`. Hai đường phải được ghi riêng, nếu không đổi cờ là hash lệch file.
     */
    url?: string;
    sha256hash?: string;
    ten?: string;
  };
}

/** Đường tới manifest. Env cho phép trỏ chỗ khác khi chạy test hoặc khi VPS để nơi riêng. */
export const manifestPath = (): string =>
  process.env.GROKBOT2_RELEASE_MANIFEST ?? join(dataDir(), "phat-hanh.json");

/** Toàn bộ manifest, hoặc `{}` khi chưa phát hành lần nào. Hỏng cú pháp cũng coi như chưa có. */
export function docManifest(): Record<string, BanPhatHanh> {
  const p = manifestPath();
  if (!existsSync(p)) return {};
  try {
    const j = JSON.parse(readFileSync(p, "utf8")) as Record<string, BanPhatHanh>;
    return j && typeof j === "object" ? j : {};
  } catch {
    // Manifest hỏng = không phát hành gì, KHÔNG phải phát bừa bản gần nhất.
    console.warn(`[grokbot2] update-feed: manifest hỏng, coi như chưa phát hành: ${p}`);
    return {};
  }
}

/**
 * So hai chuỗi phiên bản kiểu `0.29.3`.
 *
 * Không dùng so sánh chuỗi: `"0.29.10" < "0.29.9"` theo thứ tự chữ, nên một bản vá thứ mười sẽ
 * không bao giờ được phát. Cắt phần hậu tố (`-beta.1`) rồi so từng số.
 */
export function moiHon(a: string, b: string): boolean {
  const so = (v: string) => v.split("-")[0].split(".").map((x) => Number.parseInt(x, 10) || 0);
  const [x, y] = [so(a), so(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return false;
}

/**
 * Số phiên bản ghi vào manifest = số launcher SẼ KHAI sau khi cài — đọc từ `package.json` của bundle, KHÔNG tính.
 *
 * Đo 06/09 trên chính máy dev sau khi cập nhật 0.29 → 0.43: manifest ghi `0.43.20260906` (nền `0.43` + ngày trong TÊN
 * FILE bộ cài), còn `package.json` trong bundle khai `0.43.20260905` (ngày `patch-client --apply` đóng dấu vào `C:\cai043`
 * hôm trước) ⇒ `moiHon("0.43.20260906","0.43.20260905")` = true ⇒ máy vừa cập nhật vẫn nhận 200 và tải lại 106 MB mỗi
 * 24 h, mãi mãi, không lỗi nào nổi lên. Hai nguồn cho một con số thì lệch nhau đúng lúc không ai nhìn. Nguồn duy nhất
 * đúng là cái file launcher đọc; manifest chép nó. Chưa đóng dấu ngày (vd `0.43.0` của hãng) thì từ chối: phát bản ấy
 * là launcher khai `0.43.0` < mọi manifest ⇒ cùng vòng lặp.
 */
export function phienBanTuBundle(pkgVersion: string, stampTenGoi: string): { version: string; luuY?: string } {
  const v = String(pkgVersion ?? "").trim();
  const m = /^(\d+)\.(\d+)\.(\d{8})$/.exec(v);
  if (!m) {
    throw new Error(`package.json của cây client khai "${v}" — chưa có dấu ngày <nền>.<YYYYMMDD>. Chạy patch-client --apply (GROKBOT2_RELEASE_STAMP=${stampTenGoi}) lên cây ấy rồi đóng gói lại; phát bản này là launcher tải lại mỗi 24 h.`);
  }
  return m[3] === stampTenGoi
    ? { version: v }
    : { version: v, luuY: `bundle khai ${v} nhưng tên gói mang ngày ${stampTenGoi} — manifest theo BUNDLE (số launcher khai); tên file chỉ là tên file.` };
}

export interface KetQua {
  status: 204 | 200 | 400;
  body?: BanPhatHanh;
}

/**
 * Cửa cho LAUNCHER của mình — `start-bot.cmd` hỏi trước khi mở app.
 *
 * ── Vì sao có cửa thứ hai, không dùng lại `traLoi` ─────────────────────────────────────────────
 *
 * Updater gốc của client **không cài được bản của mình**, và đó là chuyện đóng bằng mã chứ không
 * bằng cấu hình: trước khi chạy installer nó dò chữ ký Authenticode và đòi tên người ký nằm trong
 * `["Anysphere, Inc.","Anysphere"]` (trích `main.cjs` 0.30). Nên banner gốc chỉ dẫn tới một nút
 * Install luôn thất bại.
 *
 * Đường đi được là: launcher — thứ chạy TRƯỚC client, mỗi lần mở app, và do mình viết trọn — tự hỏi,
 * tự tải, tự chạy bộ cài. Nó không phải client, nên không có lý do gì bắt nó nói hình dạng URL của
 * hãng (`/api/update/{nền}/{tênKênh}/{ver}/{máy}/stable`) hay hai schema zod khác nhau.
 *
 * Tách hẳn cửa cũng để hai đường KHÔNG dính nhau: `traLoi` phục vụ updater gốc và phải giữ đúng
 * hợp đồng của nó; cửa này phục vụ mình và đổi được tự do.
 *
 * `ver` rỗng ⇒ trả bản mới nhất (dùng khi launcher không đọc được phiên bản đang cài — thà cài lại
 * đúng bản đang có còn hơn im lặng bỏ qua cập nhật).
 */
export function traLoiLauncher(ver: string, nen = "windows", k = ""): KetQua {
  const kenhLauncher = process.env.GROKBOT2_LAUNCHER_KENH ?? "stable";
  const ban = docManifest()[kenhLauncher];
  if (!ban?.version || !ban?.url) return { status: 204 };
  if (ver && !moiHon(ban.version, ver)) return { status: 204 };

  /*
   * Launcher của bản CHỞ CẢ APP trình token (`token.txt` được bộ cài đặt cạnh nó lúc dựng gói).
   * Đúng token ⇒ trả bản chở-app, vì cài bản 50 KB lên máy ấy là sai gói: bản 50 KB vá client ở
   * `%LOCALAPPDATA%\Programs\Grok Bot`, còn máy này có client nằm cạnh launcher.
   *
   * Sai token ⇒ **rơi về gói công khai**, cùng luật với cửa tải: một câu 403 xác nhận "có bản khác ở
   * đây" cho bất kỳ ai thử đoán. Có token nhưng manifest chưa có `full` ⇒ 204, không đội lốt bản 50 KB
   * — cùng bài học với hash Mac: cơ chế an toàn (kiểm hash) mà chạy trên gói sai thì thành cơ chế chặn.
   */
  const tokenDay = (process.env.GROKBOT2_FULL_DOWNLOAD_TOKEN ?? "").trim();
  if (k && tokenDay && k === tokenDay) {
    if (!ban.full?.ten) return { status: 204 };
    return {
      status: 200,
      body: {
        version: ban.version,
        url: `${ban.full.url ?? ban.url}?k=${encodeURIComponent(k)}`,
        ...(ban.full.sha256hash ? { sha256hash: ban.full.sha256hash } : {}),
        ten: ban.full.ten,
      },
    };
  }
  /*
   * Mỗi nền tảng lấy ĐÚNG gói của nó — url, hash và tên file phải đi cùng một bộ ba.
   *
   * Nền mac mà manifest chưa có khoá `mac` ⇒ **204**, không phải "trả gói Windows với đuôi mac". Thà
   * người dùng Mac không thấy cập nhật còn hơn thấy rồi hỏng ở bước kiểm hash — hỏng ở đó là hỏng
   * lặng, và nó lặp lại mỗi lần mở app.
   */
  if (nen === "mac") {
    if (!ban.mac?.url) return { status: 204 };
    return {
      status: 200,
      body: {
        version: ban.version,
        url: ban.mac.url,
        ...(ban.mac.sha256hash ? { sha256hash: ban.mac.sha256hash } : {}),
        ...(ban.mac.ten ? { ten: ban.mac.ten } : {}),
      },
    };
  }
  return {
    status: 200,
    body: {
      version: ban.version,
      // Launcher tải qua đúng cửa trang tải, nên nó nhận cùng gói mà người bấm Tải nhận được.
      url: ban.url,
      ...(ban.sha256hash ? { sha256hash: ban.sha256hash } : {}),
      ...(ban.ten ? { ten: ban.ten } : {}),
    },
  };
}

/**
 * Quyết định trả gì cho một lượt hỏi.
 *
 * Tách khỏi phần HTTP để test được mà không cần dựng server — và vì đây là chỗ DUY NHẤT quyết định
 * ai thấy banner, nó xứng đáng có test riêng.
 */
export function traLoi(duong: string): KetQua {
  // /updates/api/update/{nền}/{tênKênh}/{ver}/{máy}/stable
  const m = /^\/updates\/api\/update\/([^/]+)\/([^/]+)\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(duong);
  if (!m) return { status: 400 };
  const [, nen, tenKenh, verDangChay] = m;
  const kenh = KENH[tenKenh];
  if (!kenh) return { status: 400 };

  /*
   * ── Cửa này IM LẶNG theo mặc định, và đó là một quyết định, không phải một thiếu sót ──
   *
   * Updater gốc **không cài được** bản của mình: trước khi chạy installer nó dò chữ ký Authenticode
   * và đòi tên người ký nằm trong `["Anysphere, Inc.","Anysphere"]` (trích `main.cjs` 0.30). Nên trả
   * 200 ở đây chỉ dựng một banner dẫn tới cái nút Install luôn thất bại — tệ hơn không có banner.
   *
   * Đo 03/09: ngay sau khi phát hành kênh `stable` cho LAUNCHER, cửa này bắt đầu trả 200, vì hai cửa
   * đọc chung một manifest. Đó là cái bẫy: mở một đường làm đường kia tự mở theo.
   *
   * Giữ nguyên phần hợp đồng phía dưới thay vì xoá — ngày có chứng chỉ ký số + bản vá nới danh sách
   * trắng, bật `GROKBOT2_NATIVE_FEED=1` là nó chạy, không phải viết lại.
   */
  if (process.env.GROKBOT2_NATIVE_FEED !== "1") return { status: 204 };

  const ban = docManifest()[kenh];
  if (!ban?.version || !ban?.url) return { status: 204 };
  if (!moiHon(ban.version, verDangChay)) return { status: 204 };

  // macOS chờ `{url, name}`; Windows chờ `{url, version, sha256hash?}`. Trả đúng hình dạng của nền
  // đang hỏi, vì client kiểm bằng zod và một trường thừa/thiếu là `feed_malformed`.
  return nen.startsWith("darwin")
    ? { status: 200, body: { url: ban.url, name: ban.name ?? ban.version, version: ban.version } }
    : { status: 200, body: { url: ban.url, version: ban.version, ...(ban.sha256hash ? { sha256hash: ban.sha256hash } : {}) } };
}
