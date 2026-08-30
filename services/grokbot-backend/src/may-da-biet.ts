/**
 * Sổ những máy ĐÃ TỪNG nối — cho bảng Settings → Computer, và chỉ cho nó.
 *
 * ── Vì sao cần một sổ thứ hai ───────────────────────────────────────────────────────────────────
 *
 * `channels.ts` giữ `mayDangNoi`: máy nào ĐANG giữ luồng SSE ngay lúc này. Đó đúng là thứ định
 * tuyến cần — gửi việc cho một máy đã rút dây thì việc rơi vào hư không. Nhưng bảng Computer hỏi
 * một câu khác: *Grok Bot làm việc được trên những máy nào?* App gốc trả lời câu đó bằng danh sách
 * máy đã ĐĂNG KÝ, kể cả máy đang tắt — nên hai câu hỏi cần hai sổ.
 *
 * Đo được ngày 30/08, và đây là lý do file này ra đời: bảng gọi `getSandMachines` **một lần** lúc
 * app khởi động rồi không thử lại (renderer `eyn`: `r.load()` chỉ chạy khi cờ đổi hoặc `bindAuth`).
 * Daemon thì nối SAU khi cửa sổ dựng xong vài giây. Nên trình tự thật là:
 *
 *     app mở  →  bảng hỏi  →  backend trả []  →  bảng ghi nhớ "không có máy nào"  →  daemon nối
 *
 * và bảng trống suốt phiên, dù máy chạy lệnh ngon lành. Lần thử đầu tiên của tôi CHẠY ĐƯỢC chỉ vì
 * lúc ấy còn một máy giả nối sẵn từ trước — đúng kiểu bằng chứng may rủi mà repo này đã học cách
 * không tin.
 *
 * Nhớ qua khởi động lại thì trình tự thành: bảng hỏi → backend trả máy của phiên trước → bảng có
 * dữ liệu ngay, và `seenAtMs` cập nhật khi daemon nối vào vài giây sau.
 *
 * ── Cái này KHÔNG dùng để định tuyến ────────────────────────────────────────────────────────────
 *
 * `queueRequest`/`findMachine` vẫn chỉ đọc `mayDangNoi`. Một máy trong sổ này mà không có trong sổ
 * kia là máy đang TẮT: bảng nên vẽ nó (người dùng biết mình có máy đó), còn gửi việc cho nó thì
 * phải hỏng ra hỏng, không được treo.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Một máy từng nối. Cố tình HẸP hơn `UserMachine`: chỉ thứ bảng cần vẽ. */
export interface MayDaBiet {
  computerId: string;
  label: string;
  standing?: string;
  /**
   * Tên do NGƯỜI DÙNG đặt trong bảng, nếu có.
   *
   * Tách khỏi `label` (tên máy tự khai trong `hello`) chứ không ghi đè lên nó: daemon nối lại là
   * gửi `hello` mới, và nếu hai thứ dùng chung một ô thì tên người dùng vừa đặt sẽ tự quay về
   * `DESKTOP-7D2FJG8` sau vài giây mà không ai hiểu vì sao.
   */
  tenNguoiDat?: string;
  /** Lần cuối máy này còn sống. Nạp từ đĩa thì đây là giờ của phiên trước. */
  seenAtMs: number;
}

const HERE = dirname(fileURLToPath(import.meta.url));
const FILE = join(HERE, "..", ".data", "may-da-biet.json");

const so = new Map<string, MayDaBiet>();

/** Bao nhiêu máy thì thôi nhớ. Người dùng đổi tên máy hay cài lại Windows sinh id mới; không cắt
 *  thì sổ phình ra và bảng đầy máy ma. Mới thấy trước, cắt đuôi. */
const TOI_DA = 20;

const luu = (): void => {
  try {
    mkdirSync(dirname(FILE), { recursive: true });
    const ds = [...so.values()].sort((a, b) => b.seenAtMs - a.seenAtMs).slice(0, TOI_DA);
    writeFileSync(FILE, JSON.stringify(ds, null, 2), "utf8");
  } catch {
    // Đĩa đầy hay quyền ghi — bảng mất trí nhớ qua lần khởi động sau, không đáng làm hỏng lượt nào.
  }
};

/** Nạp sổ từ đĩa. Gọi một lần lúc backend lên. */
export function napMayDaBiet(): number {
  try {
    const ds = JSON.parse(readFileSync(FILE, "utf8")) as MayDaBiet[];
    for (const m of Array.isArray(ds) ? ds : []) {
      if (typeof m?.computerId === "string" && typeof m?.label === "string") {
        so.set(m.computerId, { computerId: m.computerId, label: m.label, seenAtMs: Number(m.seenAtMs) || 0, ...(m.standing ? { standing: m.standing } : {}), ...(m.tenNguoiDat ? { tenNguoiDat: m.tenNguoiDat } : {}) });
      }
    }
  } catch {
    // Chưa có file (lần chạy đầu) hoặc file hỏng — bắt đầu từ sổ rỗng, không phải lỗi.
  }
  return so.size;
}

/** Ghi nhận một máy vừa tự khai `hello`. */
export function nhoMay(m: { computerId: string; label: string; standing?: string }): void {
  // Giữ lại tên người dùng đã đặt: `hello` mang tên máy tự khai, không phải quyết định của người.
  const cu = so.get(m.computerId);
  so.set(m.computerId, {
    computerId: m.computerId,
    label: m.label,
    seenAtMs: Date.now(),
    ...(m.standing ? { standing: m.standing } : {}),
    ...(cu?.tenNguoiDat ? { tenNguoiDat: cu.tenNguoiDat } : {}),
  });
  luu();
}

/**
 * Danh sách cho bảng: máy đang nối trước, rồi tới máy từng nối.
 *
 * Nhận `dangNoi` từ `channels.ts` thay vì tự import — tránh vòng import, và giữ đúng ranh giới:
 * file này biết "đã từng", `channels.ts` biết "đang".
 */
export function mayChoBang(dangNoi: { computerId: string; label: string; standing?: string; seenAtMs: number }[]): MayDaBiet[] {
  const ra = new Map<string, MayDaBiet>();
  for (const m of so.values()) ra.set(m.computerId, m);
  // Máy đang nối luôn thắng bản ghi cũ: tên có thể đã đổi, và `seenAtMs` của nó là bây giờ.
  for (const m of dangNoi) {
    const cu = so.get(m.computerId);
    ra.set(m.computerId, {
      computerId: m.computerId,
      label: m.label,
      seenAtMs: m.seenAtMs,
      // `standing` của daemon là sự thật về máy nên nó thắng — nhưng chỉ khi daemon CÓ khai. Không
      // khai mà vẫn ghi đè thì mức quyền người dùng vừa đặt biến mất ngay lần daemon nối lại, và
      // bảng quay về trống chỗ đó không lời giải thích.
      ...(m.standing ?? cu?.standing ? { standing: m.standing ?? cu?.standing } : {}),
      ...(cu?.tenNguoiDat ? { tenNguoiDat: cu.tenNguoiDat } : {}),
    });
  }
  return [...ra.values()].sort((a, b) => b.seenAtMs - a.seenAtMs);
}

/**
 * Người dùng đặt lại tên cho một máy (nút Save trong bảng).
 *
 * Tên do người đặt PHẢI thắng tên máy tự khai trong `hello` — nếu không thì lần daemon nối lại kế
 * tiếp sẽ ghi đè, và người dùng thấy tên mình vừa đặt tự quay về `DESKTOP-7D2FJG8` sau vài giây.
 * Nên `tenNguoiDat` là một trường riêng, và `mayChoBang` ưu tiên nó.
 *
 * Trả về `null` nếu không biết máy nào mang id đó — người gọi phải nói ra thay vì im lặng thành công.
 */
export function datTen(computerId: string, ten: string): MayDaBiet | null {
  const m = so.get(computerId);
  const t = ten.trim();
  if (!m || !t) return null;
  const moi: MayDaBiet = { ...m, tenNguoiDat: t };
  so.set(computerId, moi);
  luu();
  return moi;
}

/**
 * Người dùng đổi mức quyền của một máy.
 *
 * Ghi vào sổ để bảng vẽ đúng ngay lập tức. Đây KHÔNG phải chỗ thi hành: daemon giữ mức quyền của
 * chính nó và tự quyết định từ chối hay không — ta chỉ ghi lại thứ người dùng đã chọn, và client
 * đồng bộ tiếp xuống máy qua `setLocalToolPermission` của nó.
 */
export function datQuyen(computerId: string, quyen: string): MayDaBiet | null {
  const m = so.get(computerId);
  const q = quyen.trim();
  if (!m || !q) return null;
  const moi: MayDaBiet = { ...m, standing: q };
  so.set(computerId, moi);
  luu();
  return moi;
}

/** Quên hết — cho test. */
export function quenHet(): void { so.clear(); }
