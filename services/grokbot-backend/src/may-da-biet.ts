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
        so.set(m.computerId, { computerId: m.computerId, label: m.label, seenAtMs: Number(m.seenAtMs) || 0, ...(m.standing ? { standing: m.standing } : {}) });
      }
    }
  } catch {
    // Chưa có file (lần chạy đầu) hoặc file hỏng — bắt đầu từ sổ rỗng, không phải lỗi.
  }
  return so.size;
}

/** Ghi nhận một máy vừa tự khai `hello`. */
export function nhoMay(m: { computerId: string; label: string; standing?: string }): void {
  so.set(m.computerId, { computerId: m.computerId, label: m.label, seenAtMs: Date.now(), ...(m.standing ? { standing: m.standing } : {}) });
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
  for (const m of dangNoi) ra.set(m.computerId, { computerId: m.computerId, label: m.label, seenAtMs: m.seenAtMs, ...(m.standing ? { standing: m.standing } : {}) });
  return [...ra.values()].sort((a, b) => b.seenAtMs - a.seenAtMs);
}

/** Quên hết — cho test. */
export function quenHet(): void { so.clear(); }
