/**
 * Bước 4 của [cinapi-merge.md](../../../docs/plan/cinapi-merge.md) — **khối QUYẾT ĐỊNH**, thuần.
 *
 * Nó trả lời đúng một câu: *"gói và mức dùng của cinapi thì vẽ thành cái gì trong app?"* Không mạng,
 * không đồng hồ (giờ tiêm vào), không đĩa — nên bài đo chạy được **TRƯỚC khi nối dây**, đúng luật đã
 * trả giá ở `epoch-ben` (§7: *"một bài đo cho module thuần thì chạy được trước khi nối dây — hãy chạy
 * nó ở đó"*). Chỗ LẤY dữ liệu (cửa nào của cinapi, bằng giấy tờ gì) là chuyện khác và nằm chỗ khác.
 *
 * ── Quyết định của chủ dự án: "cửa nào chặn trước thì vẽ cửa đó" ──────────────
 *
 * Một gói cinapi có tới BA hạn mức chồng lên nhau — túi tháng (`credits_remaining`), cửa sổ N giờ
 * (`window_*`), và tuần (`week_*`) — trong khi app chỉ có MỘT thanh đo. Vẽ túi tháng thì người đang
 * bị chặn bởi cửa sổ 5 giờ nhìn thấy một thanh còn đầy và không hiểu vì sao bot im. Nên thanh ấy vẽ
 * **cửa đang bó nhất**, kèm mốc đặt lại của CHÍNH cửa ấy (`GetCurrentPeriodUsage` có sẵn hai trường
 * `billing_cycle_start/end`, và `display_message` để nói nó là cửa nào).
 *
 * **So bằng PHẦN ĐÃ DÙNG, không bằng số còn lại** — vì các cửa không cùng đơn vị: cửa của cinapi
 * tính bằng *tín dụng*, còn trần cục bộ của grokbot2 tính bằng *token ước lượng*. Một tỉ lệ thì so
 * được; hai con số khác đơn vị thì không. Và client vốn chỉ vẽ **phần trăm**
 * (`GetSandUsageStatus.usage_percent` = `used/limit*100`), nên tỉ lệ đúng là thứ nó cần.
 *
 * Vì sao trần cục bộ cũng được coi là một cửa: đo 10/09 — `config.poolUrl` trỏ thẳng
 * `admin.halcion.vn/v1/claude`, **không đi qua cinapi**, nên đồng hồ của cinapi hôm nay KHÔNG đếm
 * lượt Grok Bot. Vẽ mỗi số cinapi là vẽ một thanh không nhúc nhích khi người dùng dùng app này.
 * Ngày mã đi qua cinapi thì cửa cục bộ tự thua trong phép so, không phải sửa gì ở đây.
 *
 * ── `payment_required` là một câu nặng, chỉ nói khi đúng ──────────────────────
 *
 * Hết cửa sổ 5 giờ là một cuộc **CHỜ**, không phải một lần **MUA**: vài giờ nữa nó tự mở. Trả
 * `payment_required` lúc ấy là đẩy người dùng tới trang thanh toán cho một thứ tiền không chữa được.
 * Nên chỉ hai ca: **túi gói rỗng**, hoặc **thuê bao không còn hiệu lực**.
 */

/** Một hạn mức. `tran <= 0` nghĩa là cửa này KHÔNG bật cho gói đó — nó bị loại khỏi phép so. */
export interface Cua {
  /** Tên để nói với người dùng, ví dụ `"cửa sổ 5 giờ"`. Đi thẳng vào `display_message`. */
  ten: string;
  dung: number;
  tran: number;
  /** Mốc mở/đóng của chính cửa này. `null` khi cinapi không nói — người gọi tự lấp. */
  batDauMs: number | null;
  ketThucMs: number | null;
}

export interface ThueBao {
  planKey: string;
  planTen: string;
  trangThai: string;
  batDauMs: number | null;
  ketThucMs: number | null;
  /** `credits_remaining` — cái túi. `null` = cinapi không nói, KHÁC với `0` = đã cạn. */
  tuiConLai: number | null;
  cua: Cua[];
}

export interface UsageOCam {
  used: number;
  limit: number;
  cycleStartMs: number;
  cycleEndMs: number;
  message: string;
}

export interface OCam {
  access: "granted" | "payment_required";
  /** `null` ⇒ `GetCurrentPeriodUsage` trả `enabled:false` và app không vẽ thanh nào. */
  usage: UsageOCam | null;
  plan: string | undefined;
}

/** Số từ JSON — cinapi có chỗ trả chuỗi (int64 của Go qua JSON), nên nhận cả hai. */
function so(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Mốc thời gian → ms.
 *
 * Nhận ba dạng vì **chưa đo được thân thật** (cửa `/me/subscription` là cookie-only, xem kế hoạch):
 * Go hay marshal `time.Time` thành chuỗi RFC3339, nhưng cũng có chỗ trả epoch. Ngưỡng `1e11` tách
 * giây khỏi mili: epoch giây hiện nay ~1,8e9, epoch mili ~1,8e12 — không dải nào chạm ngưỡng.
 */
export function moc(v: unknown): number | null {
  if (typeof v === "string" && v.trim() !== "") {
    const t = Date.parse(v);
    if (Number.isFinite(t)) return t;
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    return n >= 1e11 ? n : n * 1000;
  }
  const n = so(v);
  if (n == null) return null;
  return n >= 1e11 ? n : n * 1000;
}

const chuoi = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/**
 * Dựng một cửa từ cặp `<x>_used` / `<x>_remaining`, lấy trần từ `dung + conLai` nếu có.
 *
 * Ưu tiên `dung + conLai` hơn `plan.<x>_credits`: cặp ấy là số SỐNG (đã trừ mọi lần đặt lại, mọi ưu
 * đãi), còn số trong `plan` là số danh nghĩa. Chỉ rơi về `plan` khi cinapi không nói `remaining`.
 */
function cuaTuCap(ten: string, dung: unknown, conLai: unknown, tranGoi: unknown, ket: unknown): Cua | null {
  const d = so(dung);
  if (d == null) return null;
  const r = so(conLai);
  const tran = r != null ? d + r : so(tranGoi);
  // `tran <= 0` là "gói không bật hạn mức này". Trả `null` chứ không dựng một cửa `0/0`: `phanDung`
  // đã loại nó khỏi phép so rồi, nhưng một hàng ma trong danh sách là thứ chỗ khác sẽ đọc và vẽ.
  if (tran == null || tran <= 0) return null;
  return { ten, dung: Math.max(0, d), tran, batDauMs: null, ketThucMs: moc(ket) };
}

/**
 * Đọc thân `/me/subscription`. Cùng phép tha thứ như `docDanhTinh`: nhận envelope `{code,msg,data}`
 * của `pkg/response` lẫn thân trần, nhưng **không đoán** — thiếu `plan_key` thì trả `null` chứ không
 * dựng một thuê bao rỗng, vì một thuê bao rỗng đọc lên như một gói `free` có thật.
 */
export function docThueBao(than: string): ThueBao | null {
  let j: unknown;
  try {
    j = JSON.parse(than);
  } catch {
    return null;
  }
  const g = j as Record<string, unknown> | null;
  if (!g || typeof g !== "object") return null;

  /*
   * Thân THẬT, đo 10/09 trên sản xuất ngay sau khi cửa dịch vụ lên:
   *
   *     {code, msg, data: {subscription: {plan_key, status, period_*, window_*, week_*, plan:{…}}}}
   *
   * Tức nó lồng SÂU HƠN một tầng so với `/me` (`data.user`), và bản đầu của bộ đọc này — viết theo
   * trí nhớ về `mySubscriptionDTO` — tìm `plan_key` ngay dưới `data` nên **trả `null` im lặng**:
   * không thanh đo, không lỗi, không dòng log nào nói vì sao. Thử cả ba tầng theo thứ tự cụ thể →
   * chung, và lấy tầng nào CÓ `plan_key`; không tầng nào có thì trả `null` chứ không đoán tiếp.
   */
  let d: Record<string, unknown> | null = null;
  for (const ung of [
    ((g["data"] as Record<string, unknown> | undefined)?.["subscription"]),
    g["data"],
    g["subscription"],
    g,
  ]) {
    const o = ung as Record<string, unknown> | null | undefined;
    if (o && typeof o === "object" && chuoi(o["plan_key"])) { d = o; break; }
  }
  if (!d) return null;

  const planKey = chuoi(d["plan_key"]);

  const goi = (d["plan"] ?? {}) as Record<string, unknown>;
  const cua: Cua[] = [];

  // Túi tháng: cinapi cho `credits_remaining`, còn "đã dùng" thì suy từ trần của gói.
  const tui = so(d["credits_remaining"]);
  const thang = so(goi["monthly_credits"]);
  if (tui != null && thang != null && thang > 0) {
    cua.push({
      ten: "gói tháng",
      dung: Math.max(0, thang - tui),
      tran: thang,
      batDauMs: moc(d["period_start"]),
      ketThucMs: moc(d["period_end"]),
    });
  }

  const gio = so(goi["window_hours"]);
  const cs = cuaTuCap(
    gio != null && gio > 0 ? `cửa sổ ${gio} giờ` : "cửa sổ",
    d["window_used"], d["window_remaining"], goi["window_credits"], d["window_cycle_end"],
  );
  if (cs) cua.push(cs);

  const tuan = cuaTuCap("tuần", d["week_used"], d["week_remaining"], goi["week_credits"], d["week_cycle_end"]);
  if (tuan) cua.push(tuan);

  return {
    planKey,
    planTen: chuoi(goi["name"]) || planKey,
    trangThai: chuoi(d["status"]),
    batDauMs: moc(d["period_start"]),
    ketThucMs: moc(d["period_end"]),
    tuiConLai: tui,
    cua,
  };
}

/** Phần đã dùng của một cửa, 0…1+. Cửa không bật (`tran <= 0`) trả `-1` để nó luôn thua phép so. */
export const phanDung = (c: Cua): number => (c.tran > 0 ? c.dung / c.tran : -1);

/**
 * Cửa nào chặn trước.
 *
 * Hoà thì cửa ĐỨNG TRƯỚC thắng — người gọi xếp theo thứ tự nó muốn ưu tiên, và một phép hoà ngẫu
 * nhiên giữa hai lượt đo sẽ làm thanh đo nhảy tên mà số không đổi.
 */
export function cuaChanTruoc(cua: readonly Cua[]): Cua | null {
  let tot: Cua | null = null;
  for (const c of cua) {
    if (phanDung(c) < 0) continue;
    if (!tot || phanDung(c) > phanDung(tot)) tot = c;
  }
  return tot;
}

/**
 * Thuê bao còn hiệu lực không.
 *
 * **Hỏng theo hướng CHO QUA**: chỉ chặn ở những giá trị đã biết chắc là hết hiệu lực; một chuỗi lạ
 * (cinapi đổi enum, hoa/thường khác, ngôn ngữ khác) thì CHO QUA. Chặn một người đang trả tiền vì một
 * enum mình chưa đọc là cái sai nặng hơn hẳn cho một người hết hạn đi thêm một lượt — và ta chưa đo
 * được tập giá trị thật của `status` (cửa cookie-only). Khi đo được thì siết lại ở đúng đây.
 */
const HET_HIEU_LUC = new Set(["canceled", "cancelled", "expired", "unpaid", "inactive", "none", "incomplete_expired"]);
export const conHieuLuc = (trangThai: string): boolean => !HET_HIEU_LUC.has(trangThai.trim().toLowerCase());

function gio(ms: number): string {
  const d = new Date(ms);
  const hai = (n: number) => String(n).padStart(2, "0");
  return `${hai(d.getHours())}:${hai(d.getMinutes())} ${hai(d.getDate())}/${hai(d.getMonth() + 1)}`;
}

export interface TuyChonOCam {
  /** Trần của CHÍNH grokbot2 (token ước lượng) — cũng là một cửa, xem chú thích đầu tệp. */
  cucBo?: Cua | null;
  now?: number;
}

/**
 * Bốn ổ cắm của `index.ts` — từ thuê bao cinapi cộng cửa cục bộ.
 *
 * `tb == null` (chưa hỏi được cinapi, hoặc người này không có thuê bao) thì **không bịa**: chỉ còn
 * cửa cục bộ, và `plan` để `undefined` cho builder trả đúng stub lịch sử.
 */
export function oCamTuThueBao(tb: ThueBao | null, tuyChon: TuyChonOCam = {}): OCam {
  const now = tuyChon.now ?? Date.now();
  const cua: Cua[] = [...(tb?.cua ?? [])];
  if (tuyChon.cucBo) cua.push(tuyChon.cucBo);

  const chan = cuaChanTruoc(cua);
  const tuiRong = tb != null && tb.tuiConLai != null && tb.tuiConLai <= 0;
  const ngungHieuLuc = tb != null && !conHieuLuc(tb.trangThai);

  const usage: UsageOCam | null = chan
    ? {
        used: chan.dung,
        limit: chan.tran,
        cycleStartMs: chan.batDauMs ?? now,
        cycleEndMs: chan.ketThucMs ?? now,
        message:
          `${Math.round(chan.dung).toLocaleString("vi-VN")} / ${Math.round(chan.tran).toLocaleString("vi-VN")}` +
          ` · ${chan.ten}` +
          (chan.ketThucMs != null && chan.ketThucMs > now ? ` · đặt lại ${gio(chan.ketThucMs)}` : ""),
      }
    : null;

  return {
    // Hết cửa sổ là CHỜ, không phải MUA — xem chú thích đầu tệp.
    access: tuiRong || ngungHieuLuc ? "payment_required" : "granted",
    usage,
    plan: tb?.planTen || undefined,
  };
}
