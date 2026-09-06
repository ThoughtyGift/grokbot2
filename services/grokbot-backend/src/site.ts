/**
 * Trang tải — cửa đầu tiên người dùng gặp, và là mảnh 2 trong docs/plan/ship-to-users.md.
 *
 * Hãng đi: website → tải app → đăng nhập → cloud cấp box. Mình đi đúng hình dạng đó nhưng chỉ tới
 * bước hai: trang này phát **bộ cài**, còn app thì người dùng đã có sẵn trên máy (xem README trong
 * gói). Đó là khác biệt thật, và trang nói thẳng ra thay vì che.
 *
 * **Công khai, không qua `checkAuth`** — một trang tải mà đòi token thì không ai tải được. An toàn
 * hôm nay đến từ chỗ khác: BFF nghe `127.0.0.1` (index.ts), nên chưa ai ngoài máy này gọi tới. Khi
 * mở ra ngoài (chặng B3) thì đây là một trong hai route cố ý để mở, cùng `/v1/login`.
 *
 * Không nhận đường dẫn từ người gọi: hai route cố định, đọc hai file cố định. Không có chỗ nào cho
 * `../` chui vào.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { createReadStream, readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
// Phiên bản in trên trang đọc từ manifest phát hành — cùng nguồn với feed và launcher.
import { docManifest } from "./update-feed.js";
// `/bot/<shareId>` — trang đích của link chia sẻ mẫu bot, cùng cửa công khai này (site-bot.ts).
import { handleBotSite } from "./site-bot.js";

const here = dirname(fileURLToPath(import.meta.url));
const svcRoot = join(here, "..");
const repoRoot = join(svcRoot, "..", "..");

const LANDING = join(repoRoot, "apps", "grokbot-site", "index.html");
/**
 * Thư mục chứa gói cài. HÀM chứ không hằng số: đọc lúc GỌI nên bài test trỏ được nó sang thư mục
 * tạm, và máy chủ đổi được chỗ mà không phải dựng lại. Cùng nếp với `manifestPath()` và biến
 * `GROKBOT2_WEB_DIST` của `web-app.ts`.
 */
const distDir = (): string => process.env.GROKBOT2_DIST_DIR ?? join(svcRoot, ".data", "dist");

/**
 * Tên gói phải khớp với scripts/build-setup.mjs — một hằng, không phải hai chỗ đoán nhau.
 *
 * Mỗi hệ **một file duy nhất**, không phải zip: bản zip đầu tiên giải nén ra 6 mục lộn xộn và
 * trông không giống bộ cài nào. Đuôi khác nhau nên cũng không tải nhầm được cho nhau.
 */
export const SETUP_KINDS = {
  // Thứ tự có nghĩa: `.exe` trước vì đó là thứ trông giống một bộ cài thật (icon riêng, gỡ được từ
  // Apps & features). Máy dựng không có Inno Setup thì rơi xuống `.cmd` — vẫn cài được y hệt.
  windows: [
    /*
     * Bản CHỞ CẢ APP — **CHỈ đường riêng `?k=<token>`, không bao giờ công khai.**
     *
     * Nó tiện nhất: không cần client cài trước, không cần Node. Và chính vì thế nó là bản dễ bị phát
     * nhầm nhất. `docs/legal.md` viết thẳng: **"Do not redistribute a modified client"** — gói này
     * chở client đã vá của nhà phát hành, nên nó dành cho MÁY CỦA CHỦ TRANG, không cho nút Tải.
     *
     * Vì sao phải là một CỜ chứ không phải "nó cũ hơn nên không thắng": ranh giới pháp lý không được
     * dựa vào ngày tháng của file. Bài test 03/09 nói ra đúng điều đó — hai file cùng mtime thì loại
     * đứng trước thắng, và loại đứng trước là gói này. Tức chỉ cần một lần dựng lại là nút công khai
     * phát 118 MB, không ai cố ý và không lỗi nào nổi lên.
     *
     * `newestSetup` bỏ qua nó vô điều kiện; cửa `?k=` đọc trực tiếp bằng `newestMatching`.
     */
    { prefix: "Bot-Noi-Bo-Setup", ext: ".exe", chiRieng: true },
    { prefix: "Cai-dat-Bot-Noi-Bo-win", ext: ".cmd" },
    /*
     * Bản 2 MB `.exe` — **KHÔNG phát công khai**, và đây là lý do đo được.
     *
     * 03/09, người dùng bấm Tải trên `cinai.app/agent`: Chrome hiện "Virus detected" và **xoá file**.
     * Đo bằng chính Defender trên máy này (`MpCmdRun -Scan`), không đoán:
     *
     *     Trojan:Win32/Wacatac.B!ml   ThreatID 2147735505   SeverityID 5
     *
     * Hậu tố `!ml` = phán đoán của mô hình học máy, tức dương tính giả kinh điển với một installer
     * VỪA DỰNG, CHƯA KÝ SỐ, chưa có tiếng. Cùng lượt quét, bản `.cmd` 44 KB cho "no threats".
     *
     * Nên tạm dừng phát `.exe`: một bộ cài bị xoá trước khi chạy thì không phải bộ cài. `.cmd` cài
     * y hệt — mất cái icon riêng và mục trong Apps & features, đổi lấy việc nó tải về được.
     *
     * Mở lại khi có chứng chỉ ký số (đó mới là cách chữa thật), hoặc tạm bằng
     * `GROKBOT2_PHAT_EXE_CHUA_KY=1` nếu cần thử.
     */
    { prefix: "Cai-dat-Bot-Noi-Bo-2", ext: ".exe", avXoa: true },
  ],
  mac: [{ prefix: "Cai-dat-Bot-Noi-Bo-mac", ext: ".command" }],
} as const;
export type SetupKind = keyof typeof SETUP_KINDS;

/**
 * Đọc lại trang khi file đổi, không phải mỗi request.
 *
 * Sửa CSS rồi F5 mà không thấy gì đổi là kiểu bực mình vô nghĩa; còn đọc lại 20 KB mỗi lần thì
 * lãng phí. `mtimeMs` giải quyết cả hai.
 */
let cached: { dau: string; html: string } | null = null;

/**
 * Kích cỡ gói, in ra từ chính FILE ĐANG ĐƯỢC PHÁT.
 *
 * Trước đây trang ghi cứng "bộ cài 28 KB" ở hai chỗ và "27 KB" cho Mac. Đo 03/09 bằng chính trình
 * duyệt: gói Windows đang phát là **2.0 MB** — trang nói sai gần trăm lần, và nó sai một cách không
 * ai phát hiện được vì con số nằm trong HTML còn file thì đổi theo mỗi lần phát hành.
 *
 * Một con số về file thì phải ĐO file, không được gõ tay. Lấy lúc dựng trang, cùng nhịp với
 * `newestSetup` mà `/download/*` dùng — nên hai chỗ không thể lệch nhau.
 */
const coChu = (b: number): string => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`);

/**
 * Ngày phát hành ghi trên trang — lấy từ TÊN GÓI trong manifest (`Cai-dat-…-20260906.cmd`), rơi về đuôi version.
 *
 * Trước 06/09 hai thứ trùng nhau nên lấy đuôi version là đủ. Từ khi manifest chép số của bundle (`phienBanTuBundle`),
 * đuôi version là ngày `patch-client` ĐÓNG DẤU vào cây client (05/09), còn ngày dựng/phát hành là ngày trong tên gói
 * (06/09) — trang tải hiện "phát hành 05/09/2026" cho bản phát 06/09, đo bằng Chrome thật. Không có tên gói thì đuôi
 * version vẫn là số đúng nhất còn lại.
 */
export function ngayPhatHanh(ban: { version?: string; ten?: string } | undefined): string {
  const tuTen = /(\d{4})(\d{2})(\d{2})\.[a-z]+$/i.exec(String(ban?.ten ?? ""));
  const tuVer = /\.(\d{4})(\d{2})(\d{2})$/.exec(String(ban?.version ?? ""));
  const m = tuTen ?? tuVer;
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "—";
}

/**
 * Tên tệp NGƯỜI DÙNG thấy trong lịch sử tải — cố ý KHÁC tên trên đĩa.
 *
 * Tên trên đĩa (`Bot-Noi-Bo-Setup-<ngày>.exe`) là ĐỊNH DANH TRONG NHÀ, và ba chỗ cùng đọc nó:
 * `newestMatching`/`SETUP_KINDS` tìm gói bằng tiền tố ấy, cờ `chiRieng` chặn gói chở-app khỏi nút
 * công khai cũng bằng nó, và `ngayPhatHanh()` lấy NGÀY PHÁT HÀNH từ đuôi `-<YYYYMMDD>` của nó.
 *
 * Nên tên đẹp KHÔNG được leo ngược vào tên đĩa hay vào `ten` của manifest. Đo 07/09 trước khi sửa:
 * `Cinai x Grok Bot 0.43.20260905.cmd` làm regex của `ngayPhatHanh` bắt vào ĐUÔI VERSION, trang tải
 * quay lại ghi *"phát hành 05/09/2026"* cho bản phát 06/09 — đúng lỗi vừa chữa hôm 06/09 (`73689e7`),
 * và nó sai im lặng vì không có gì đỏ. Tên đẹp sống ở đúng một biên giới: `content-disposition`.
 *
 * Số phiên bản lấy từ MANIFEST — cùng nguồn với trang, feed và launcher, nên tên tệp không thể nói
 * một số khác với dòng "Phiên bản …" ngay bên trên nút. Chưa phát hành lần nào thì giữ tên đĩa thay
 * vì bịa một số.
 */
export function tenTaiVe(tenDia: string, version?: string): string {
  const v = String(version ?? "").trim();
  if (!v) return tenDia;
  const duoi = /\.[A-Za-z0-9]+$/.exec(tenDia)?.[0] ?? "";
  // `"` đóng sớm `filename="…"`, xuống dòng chẻ đôi header: version đến từ file manifest nên là DỮ
  // LIỆU, không phải hằng số của ta.
  return `Cinai x Grok Bot ${v}${duoi}`.replace(/["\r\n]/g, "");
}

/** Số phiên bản đang phát, cho `tenTaiVe` — cùng kênh với trang tải. */
const phienBanPhat = (): string | undefined =>
  docManifest()[process.env.GROKBOT2_LAUNCHER_KENH ?? "stable"]?.version;

function landingHtml(): string | null {
  try {
    const { mtimeMs } = statSync(LANDING);
    const co = (hang: SetupKind): string => {
      const g = newestSetup(distDir(), hang);
      return g ? coChu(g.size) : "—";
    };
    // Cache theo mtime của HTML **và** của gói: phát hành bản mới mà trang giữ con số cũ thì đúng
    // cái lỗi này quay lại, chỉ chậm hơn một nhịp.
    /*
     * `{{CO_FULL}}` — bản CHỞ CẢ APP, chỉ hiện trên đường `?k=<token>`.
     *
     * Nó là một FILE KHÁC (`Bot-Noi-Bo-Setup*.exe`), nên phải đo riêng. Con số này từng được gõ tay
     * là "118 MB" trong một đoạn `<script>` ghi đè lại chính dòng vừa được thay ở trên — tức kể cả
     * sau khi sửa hai chỗ kia, đường `?k=` vẫn hiện một con số cố định. Bài test bắt được nó, tôi
     * thì không: đọc HTML bằng mắt bỏ sót đúng chỗ JS chạy sau.
     */
    const full = newestMatching(distDir(), "Bot-Noi-Bo-Setup", ".exe");
    /*
     * Phiên bản ghi trên trang lấy từ MANIFEST — cùng nguồn với feed và launcher, nên trang, banner
     * và file tải về không thể nói ba số khác nhau. Chưa phát hành lần nào thì nói thẳng "chưa phát
     * hành", không bịa một số.
     *
     * `NGAY_BAN` suy từ đuôi `YYYYMMDD` của phiên bản (`0.29.20260903` → 03/09/2026): ngày phát hành
     * *là* phần cuối số phiên bản, theo đúng cách `phat-hanh.mjs` đặt số — không có trường ngày riêng
     * để mà lệch.
     */
    const ban = docManifest()[process.env.GROKBOT2_LAUNCHER_KENH ?? "stable"];
    const phienBan = ban?.version ?? "chưa phát hành";
    const ngayBan = ngayPhatHanh(ban);   // ngày trong TÊN GÓI trước, đuôi version sau — xem chú thích hàm
    /*
     * `GROKBOT2_PUBLIC_FULL=1` ⇒ nút công khai phát bản chở-app, nên con số "bộ cài … MB" ở hero phải
     * là của gói ẤY, và trang phải bật nhánh chữ "không cần chuẩn bị gì trước" ngay cả khi không có
     * `?k=`. Cờ đi xuống HTML qua `data-full` để đúng một đoạn JS quyết định cho cả hai đường vào —
     * không nhân đôi câu chữ ở hai nơi rồi lệch nhau (đã trả giá với "28 KB").
     */
    const congKhaiFull = process.env.GROKBOT2_PUBLIC_FULL === "1" && full != null;
    const coWin = congKhaiFull && full ? coChu(full.size) : co("windows");
    const dau = `${mtimeMs}:${coWin}:${co("mac")}:${full?.size ?? 0}:${phienBan}:${congKhaiFull ? 1 : 0}`;
    if (!cached || cached.dau !== dau) {
      const raw = readFileSync(LANDING, "utf8");
      cached = {
        dau,
        html: raw
          .replaceAll("{{CO_WIN}}", coWin)
          .replaceAll("{{CO_MAC}}", co("mac"))
          .replaceAll("{{CO_FULL}}", full ? coChu(full.size) : "bản đầy đủ")
          .replaceAll("{{PHIEN_BAN}}", phienBan)
          .replaceAll("{{NGAY_BAN}}", ngayBan)
          .replaceAll("{{CONG_KHAI_FULL}}", congKhaiFull ? "1" : "0"),
      };
    }
    return cached.html;
  } catch {
    return null;
  }
}

/**
 * Gói mới nhất trong `.data/dist`, hoặc null khi chưa ai chạy build-setup.
 *
 * **Độ MỚI thắng trước, loại chỉ để phá hoà.** Bản trước duyệt theo thứ tự loại và trả về ngay khi
 * loại đầu tiên có file — nên một gói CŨ thuộc loại "sang" (bản chở-cả-app) luôn thắng một gói MỚI
 * thuộc loại thường. Đo 03/09: trang tải phát `Bot-Noi-Bo-Setup-20260827.exe` trong khi bản
 * `Cai-dat-Bot-Noi-Bo-20260902.exe` đã nằm cạnh đó — người tải nhận gói thiếu sáu ngày tính năng,
 * trong đó có cả bản vá chặn app tự cập nhật.
 *
 * Đổi lại: một gói cũ hơn không bao giờ được phát chỉ vì nó tiện hơn. Tiện mà cũ thì vẫn là sai
 * phiên bản, và sai phiên bản là thứ người dùng không tự phát hiện được.
 */
export function newestSetup(dir = distDir(), kind: SetupKind = "windows"): { name: string; path: string; size: number } | null {
  const uu = SETUP_KINDS[kind];
  // Loại bị antivirus xoá thì KHÔNG phát, dù nó mới hơn — xem chú thích `avXoa` trong SETUP_KINDS.
  const choExe = process.env.GROKBOT2_PHAT_EXE_CHUA_KY === "1";
  let best: { name: string; path: string; size: number; mtimeMs: number; hang: number } | null = null;
  for (const [hang, muc] of uu.entries()) {
    const { prefix, ext } = muc;
    // Bản chỉ-đường-riêng KHÔNG bao giờ ra cửa công khai — không cờ nào mở, xem `chiRieng`.
    if ("chiRieng" in muc && muc.chiRieng) continue;
    if ("avXoa" in muc && muc.avXoa && !choExe) continue;
    const hit = newestMatching(dir, prefix, ext);
    if (!hit) continue;
    const mtimeMs = statSync(hit.path).mtimeMs;
    // Mới hơn thì thắng; bằng tuổi thì loại đứng trước trong danh sách thắng.
    if (!best || mtimeMs > best.mtimeMs || (mtimeMs === best.mtimeMs && hang < best.hang)) {
      best = { ...hit, mtimeMs, hang };
    }
  }
  return best ? { name: best.name, path: best.path, size: best.size } : null;
}

function newestMatching(dir: string, prefix: string, ext: string): { name: string; path: string; size: number } | null {
  let best: { name: string; path: string; size: number; mtimeMs: number } | null = null;
  let names: string[];
  try { names = readdirSync(dir); } catch { return null; }
  for (const name of names) {
    if (!name.startsWith(prefix) || !name.endsWith(ext)) continue;
    const path = join(dir, name);
    try {
      const st = statSync(path);
      // Hoà mtime là chuyện thật, không phải giả định: hai bản dựng liền nhau rơi vào cùng một
      // mili-giây, và khi đó thứ tự `readdir` quyết định — tức là ngẫu nhiên. Tên có ngày ở trong
      // nên so tên là mốc phụ ổn định.
      const newer = !best
        || st.mtimeMs > best.mtimeMs
        || (st.mtimeMs === best.mtimeMs && name > best.name);
      if (newer) best = { name, path, size: st.size, mtimeMs: st.mtimeMs };
    } catch { /* biến mất giữa chừng — bỏ qua */ }
  }
  return best ? { name: best.name, path: best.path, size: best.size } : null;
}

/**
 * Trả `true` khi đã trả lời xong, `false` để router đi tiếp.
 *
 * Khi chưa có gói: **503 kèm cách dựng**, không phải 404 trống. Người gặp lỗi này gần như chắc chắn
 * là người đang phát triển, và câu trả lời họ cần là một dòng lệnh.
 */
export async function handleSite(url: string, req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const path = url.split("?")[0];

  if (path.startsWith("/bot/") && handleBotSite(url, req, res)) return true;

  if (path === "/" || path === "/index.html") {
    const html = landingHtml();
    if (!html) return false;   // chưa có file thì để router trả 404 như cũ
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" });
    res.end(req.method === "HEAD" ? undefined : html);
    return true;
  }

  if (path === "/download" || path === "/download/") {
    res.writeHead(302, { location: "/download/windows" });
    res.end();
    return true;
  }

  /*
   * ── `/download/windows-cfg` — bộ CẤU HÌNH 50 KB, luôn luôn ───────────────────────────────────
   *
   * Cửa có nghĩa CỐ ĐỊNH, vì `/download/windows` thì không: nó phát gì tuỳ `GROKBOT2_PUBLIC_FULL`.
   * Manifest của launcher công khai (`stable.url`) phải trỏ vào đây — trỏ vào `/download/windows`
   * rồi ngày mai bật cờ là hash trong manifest không khớp file tải về, và launcher bản 50 KB lặng lẽ
   * bỏ qua cập nhật mãi mãi (đúng bẫy hash Mac, lần thứ ba).
   */
  if (path === "/download/windows-cfg") {
    const cfg = newestMatching(distDir(), "Cai-dat-Bot-Noi-Bo-win", ".cmd");
    if (!cfg) { res.writeHead(503, { "content-type": "text/plain; charset=utf-8" }); res.end("Chưa có gói cấu hình.\n"); return true; }
    res.writeHead(200, {
      "content-type": "application/octet-stream",
      "content-length": String(cfg.size),
      "content-disposition": `attachment; filename="${tenTaiVe(cfg.name, phienBanPhat())}"`,
    });
    if (req.method === "HEAD") { res.end(); return true; }
    createReadStream(cfg.path).pipe(res);
    return true;
  }

  const kind: SetupKind | null =
    path === "/download/windows" ? "windows" : path === "/download/mac" ? "mac" : null;
  if (kind) {
    /*
     * ── `?k=<token>` — đường tải BẢN CHỞ CẢ APP ────────────────────────────────────────────────
     *
     * Trang đã hứa đường này từ lâu ("hỏi chủ trang để lấy đường tải riêng"), JS của trang còn đổi
     * chữ thành "bản chở cả ứng dụng (118 MB)" khi thấy `?k=`. Nhưng **máy chủ chưa bao giờ đọc
     * `k`** — nên ai có token vẫn nhận gói 50 KB trong khi trang nói là 118 MB. Đo 03/09: `site.ts`
     * không có một dòng nào chạm tới tham số đó.
     *
     * Vì sao phải có token chứ không mở công khai: gói ấy chở client ĐÃ VÁ của nhà phát hành, và
     * `docs/legal.md` viết thẳng "Do not redistribute a modified client". Cửa này là để chủ trang
     * cài lên MÁY CỦA CHÍNH MÌNH — đúng phạm vi cá nhân/nghiên cứu mà tài liệu ấy đặt ra.
     *
     * Token sai hay thiếu ⇒ **rơi về gói công khai**, không phải 403: đường này là bí mật, và một
     * câu 403 xác nhận "có tồn tại một bản khác ở đây" cho bất kỳ ai thử đoán.
     */
    const k = new URL(url, "http://x").searchParams.get("k") ?? "";
    const tokenDay = (process.env.GROKBOT2_FULL_DOWNLOAD_TOKEN ?? "").trim();
    /*
     * ── `GROKBOT2_PUBLIC_FULL=1` — nút CÔNG KHAI phát bản chở-cả-app ────────────────────────────
     *
     * Quyết định của chủ dự án, 03/09, sau hai lần tôi nêu ranh giới của `docs/legal.md`: mục tiêu
     * là dev lại FE, trong lúc đó dùng FE của client, và **một đường tải** — người bấm nút ở
     * `cinai.app/agent/` phải nhận được app chạy ngay, không phải một bộ cấu hình 52 KB đòi máy đã
     * có client + Node. Ghi trong `legal.md` cùng ngày. Là CỜ chứ không phải mặc định của mã: máy dev
     * và mọi bản cài khác giữ hành vi cũ; chỉ máy chủ nào chủ dự án đặt cờ mới phát bản ấy công khai.
     *
     * Không cờ + không token ⇒ vẫn gói 50 KB (`newestSetup`, vốn bỏ gói này bằng `chiRieng`).
     */
    const congKhaiFull = process.env.GROKBOT2_PUBLIC_FULL === "1";
    if (kind === "windows" && ((tokenDay !== "" && k === tokenDay) || congKhaiFull)) {
      const full = newestMatching(distDir(), "Bot-Noi-Bo-Setup", ".exe");
      if (full) {
        res.writeHead(200, {
          "content-type": "application/octet-stream",
          "content-length": String(full.size),
          "content-disposition": `attachment; filename="${tenTaiVe(full.name, phienBanPhat())}"`,
        });
        if (req.method === "HEAD") { res.end(); return true; }
        createReadStream(full.path).pipe(res);
        return true;
      }
      console.warn("[grokbot2] site: token tải-đầy-đủ đúng nhưng KHÔNG có gói Bot-Noi-Bo-Setup*.exe trong dist");
    }

    const pkg = newestSetup(distDir(), kind);
    if (!pkg) {
      res.writeHead(503, { "content-type": "text/plain; charset=utf-8" });
      res.end(
        "Chưa có gói cài đặt.\n\nDựng bằng:\n  node services/grokbot-backend/scripts/build-setup.mjs\n",
      );
      return true;
    }
    res.writeHead(200, {
      // Không phải zip nữa: một script cài. `octet-stream` để trình duyệt tải về thay vì mở ra đọc.
      "content-type": "application/octet-stream",
      "content-length": String(pkg.size),
      "content-disposition": `attachment; filename="${tenTaiVe(pkg.name, phienBanPhat())}"`,
    });
    if (req.method === "HEAD") { res.end(); return true; }
    createReadStream(pkg.path).pipe(res);
    return true;
  }

  return false;
}
