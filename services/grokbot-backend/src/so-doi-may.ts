/**
 * **Sổ kiểm kê đội máy** — ngoài kia đang có những bản client nào.
 *
 * Vì sao có file này (đo 09/09, và nó là một bài học chứ không phải một tiện ích): để trả lời
 * *"bao giờ đặt `GROKBOT2_CHECKOUT_URL`"* — tức *"bản vá đã tới máy người dùng chưa"* — tôi phải
 * dựng lại đội máy bằng tay từ **log nginx**, vì `update-feed` không ghi lại `ver` nó được hỏi một
 * dòng nào. Ba chỗ hỏng của đường ấy:
 *
 *   1. log **xoay** — `access.log.14.gz` đã là 26/08, nên lịch sử tự mục đi;
 *   2. log **lẫn phép dò của chính mình** — 17/17 lượt trong `access.log` hôm đó là `curl`/`node`
 *      của tôi, đúng bẫy *"coverage đếm cả lượt của bài đo"* (bảng theo dõi §7);
 *   3. nó nằm ở tầng khác hẳn với thứ quyết định (`phat-hanh.json`), nên không ai nối được hai đầu.
 *
 * Sổ này chữa cả ba: nó sống cạnh manifest trong `dataDir()`, nó **giữ nhãn** `laLauncher` để phép
 * dò không bao giờ đội lốt máy thật, và nó mang `tu` để một con số luôn có cửa sổ — *"một bộ đo báo
 * 0 sai phải kèm trên bao nhiêu"*.
 *
 * ── KHÔNG BAO GIỜ GHI GÌ ─────────────────────────────────────────────────────────────────────
 * Không token (`?k=`), không URL, không IP. Cách bảo đảm không phải một lời dặn mà là **hình dạng
 * hàm**: `Luot` không có trường nào cho chúng, nên rò là chuyện không viết ra được. Có unit ghim
 * đúng bộ khoá của một hàng, để ai thêm `ip` sau này thì bài đo đỏ trước khi bản ấy đi đâu.
 *
 * ── VÌ SAO GIỮ CẢ HÀNG KHÔNG-PHẢI-LAUNCHER ───────────────────────────────────────────────────
 * Bỏ chúng đi thì gọn hơn, nhưng lúc ấy *"0 lượt launcher"* không phân biệt được với *"bộ ghi
 * hỏng"*. Giữ lại và dán nhãn là cùng một phép của `saw` trong `coverage` (thứ đã tách được
 * `user-ticket` khỏi `matching-bearer`): **loại giấy tờ phân biệt được người, số lượt trần thì
 * không.**
 *
 * Hàm nào cũng thuần trừ hai hàm chạm đĩa ở cuối — để bài đo chạy được TRƯỚC khi nối dây.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "./store.js";

/** Một lượt hỏi feed. KHÔNG có chỗ cho token/URL/IP — xem đầu file. */
export interface Luot {
  /** `User-Agent` thô của người hỏi. Chuẩn hoá bên trong, không cần người gọi dọn. */
  ua: string;
  /** `ver` launcher khai. Chuỗi này do CLIENT điều khiển nên nó được siết trước khi thành khoá. */
  ver: string;
  nen: string;
  /** Mã trả về: 200 = được mời cập nhật, 204 = đã ở bản mới nhất. */
  ma: number;
  khi: number;
}

export interface HangDoiMay {
  ua: string;
  /** `true` khi `User-Agent` mang `PowerShell/<số>` — khối tự cập nhật là `Invoke-WebRequest`. */
  laLauncher: boolean;
  ver: string;
  nen: string;
  n: number;
  dau: number;
  cuoi: number;
  ma: number;
}

export interface SoDoiMay {
  /** Sổ bắt đầu ghi từ khi nào. Một con số đếm không có cửa sổ là một con số vô nghĩa. */
  tu: number;
  hang: Record<string, HangDoiMay>;
}

/** Trần số hàng. Sổ này phải có trần vì `ver`/`ua` do người gọi ngoài điều khiển. */
export const TRAN_HANG = 200;

const KHONG_KHAI = "(không khai)";

/**
 * Chuẩn hoá `User-Agent` thành một khoá NGẮN và ổn định.
 *
 * Launcher thật đi bằng `Mozilla/5.0 (Windows NT; …) WindowsPowerShell/5.1.19041.6456`, và phần
 * đáng giữ là đúng cái đuôi `PowerShell/<số>`: số ấy là mức bản vá Windows, nên nó phân biệt được
 * máy này với máy kia (đo 09/09: bốn số khác nhau, `26100.9168` là Win11 24H2). Nó KHÔNG phải một
 * mã máy — Windows cập nhật thì số đổi — nên đừng đọc nó thành danh tính; nó chỉ là dấu vết đủ
 * tốt để đếm "bao nhiêu máy khác nhau" ở cỡ chục.
 *
 * Còn lại thì lấy token đầu (`curl/8.18.0`, `node`, `Mozilla/5.0`) — trình duyệt gộp về một hàng là
 * đúng ý: trình duyệt không phải launcher.
 */
export function chuanUa(raw: string): { ua: string; laLauncher: boolean } {
  const s = (raw ?? "").trim();
  if (!s) return { ua: KHONG_KHAI, laLauncher: false };
  const ps = s.match(/PowerShell\/[0-9][0-9.]*/i);
  if (ps) return { ua: ps[0], laLauncher: true };
  const dau = s.split(/\s+/)[0].replace(/[^A-Za-z0-9._/+-]/g, "").slice(0, 40);
  return { ua: dau || "(lạ)", laLauncher: false };
}

/** Siết một chuỗi do client điều khiển trước khi nó thành khoá JSON. */
function sietChuoi(v: string, tran: number): string {
  const s = (v ?? "").trim().replace(/[^A-Za-z0-9._+-]/g, "").slice(0, tran);
  return s || KHONG_KHAI;
}

export const khoaHang = (h: Pick<HangDoiMay, "ua" | "nen" | "ver">): string => `${h.ua}|${h.nen}|${h.ver}`;

/**
 * Gộp một lượt vào sổ. **Thuần** — trả về sổ MỚI, không sửa sổ cũ.
 *
 * Thứ tự loại khi tràn trần là một quyết định, không phải chi tiết: hàng **không-launcher** bị loại
 * TRƯỚC (cũ nhất trước), vì hàng launcher là toàn bộ lý do sổ này tồn tại. Loại theo `cuoi` thuần
 * thì một lượt `curl` của bài đo có thể đẩy một máy thật ra khỏi sổ.
 */
export function gop(so: SoDoiMay, l: Luot, tran = TRAN_HANG): SoDoiMay {
  const { ua, laLauncher } = chuanUa(l.ua);
  const ver = sietChuoi(l.ver, 40);
  const nen = sietChuoi(l.nen, 16);
  const khi = Number.isFinite(l.khi) ? l.khi : Date.now();
  const ma = Number.isFinite(l.ma) ? l.ma : 0;

  const k = khoaHang({ ua, nen, ver });
  const cu = so.hang[k];
  const hang: Record<string, HangDoiMay> = {
    ...so.hang,
    [k]: cu
      ? { ...cu, n: cu.n + 1, cuoi: Math.max(cu.cuoi, khi), dau: Math.min(cu.dau, khi), ma }
      : { ua, laLauncher, ver, nen, n: 1, dau: khi, cuoi: khi, ma },
  };

  const soDu = Object.keys(hang).length - tran;
  if (soDu <= 0) return { ...so, hang };

  const xepDeLoai = Object.entries(hang)
    .filter(([kk]) => kk !== k) // hàng vừa ghi không bị loại ngay trong cùng lượt
    .sort((a, b) => Number(a[1].laLauncher) - Number(b[1].laLauncher) || a[1].cuoi - b[1].cuoi)
    .slice(0, soDu)
    .map(([kk]) => kk);
  const conLai = Object.fromEntries(Object.entries(hang).filter(([kk]) => !xepDeLoai.includes(kk)));
  return { ...so, hang: conLai };
}

export interface TinhDoiMay {
  /** Số máy (theo dấu vết `ua`) mà lượt hỏi GẦN NHẤT khai đúng bản đang phát. */
  daToi: number;
  /** Tổng số máy thật từng hỏi feed. */
  tong: number;
  /** Bản mà mỗi máy khai ở lượt gần nhất, mới nhất trước — để đọc được ai còn ở đâu. */
  may: Array<{ ua: string; ver: string; cuoi: number; ma: number }>;
  /** Số hàng KHÔNG phải launcher (phép dò, trình duyệt) — giữ để "0 máy thật" khác "sổ hỏng". */
  khongPhaiLauncher: number;
}

/**
 * Cổng để đặt `GROKBOT2_CHECKOUT_URL`, tính thẳng từ sổ.
 *
 * "Một máy đã tới" nghĩa là lượt hỏi GẦN NHẤT của nó khai đúng `banDangPhat` — không phải "từng
 * khai", vì một máy có thể tải bản mới rồi bị cài đè về bản cũ. Lấy theo `cuoi` lớn nhất của mỗi
 * `ua`.
 */
export function tinhDoiMay(so: SoDoiMay, banDangPhat: string): TinhDoiMay {
  const moiNhat = new Map<string, HangDoiMay>();
  let khongPhaiLauncher = 0;
  for (const h of Object.values(so.hang)) {
    if (!h.laLauncher) { khongPhaiLauncher++; continue; }
    const co = moiNhat.get(h.ua);
    if (!co || h.cuoi > co.cuoi) moiNhat.set(h.ua, h);
  }
  const may = [...moiNhat.values()]
    .sort((a, b) => b.cuoi - a.cuoi)
    .map((h) => ({ ua: h.ua, ver: h.ver, cuoi: h.cuoi, ma: h.ma }));
  return {
    daToi: banDangPhat ? may.filter((m) => m.ver === banDangPhat).length : 0,
    tong: may.length,
    may,
    khongPhaiLauncher,
  };
}

// ── hai hàm chạm đĩa ───────────────────────────────────────────────────────────────────────────

/** Cùng quy ước với `manifestPath()`: env trước, rồi `dataDir()` — một nguồn sự thật cho thư mục. */
export const soDoiMayPath = (): string =>
  process.env.GROKBOT2_SO_DOI_MAY_FILE ?? join(dataDir(), "so-doi-may.json");

/** Sổ trên đĩa. Vắng hay hỏng đều là sổ trắng — KHÔNG ném, cửa feed không được chết vì sổ. */
export function docSo(tep: string, gio = Date.now()): SoDoiMay {
  if (!existsSync(tep)) return { tu: gio, hang: {} };
  try {
    const j = JSON.parse(readFileSync(tep, "utf8")) as SoDoiMay;
    if (!j || typeof j !== "object" || typeof j.hang !== "object" || !j.hang) throw new Error("hình dạng lạ");
    return { tu: Number.isFinite(j.tu) ? j.tu : gio, hang: j.hang };
  } catch {
    console.warn(`[grokbot2] sổ đội máy hỏng, coi như trắng: ${tep}`);
    return { tu: gio, hang: {} };
  }
}

/**
 * Ghi một lượt. **Không bao giờ ném** — một cái sổ không được là lý do launcher của người dùng
 * không nhận được câu trả lời. Trả về sổ đã ghi để người gọi đo được, hoặc `null` khi ghi trượt.
 */
export function ghiLuot(tep: string, l: Luot): SoDoiMay | null {
  try {
    const so = gop(docSo(tep, l.khi), l);
    writeFileSync(tep, JSON.stringify(so, null, 2));
    return so;
  } catch (e) {
    console.warn(`[grokbot2] không ghi được sổ đội máy: ${e instanceof Error ? e.message : e}`);
    return null;
  }
}
