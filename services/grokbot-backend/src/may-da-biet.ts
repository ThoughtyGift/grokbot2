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
import { dataDir } from "./store.js";

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
  /**
   * CHỦ của máy — `authId` của người mà daemon đã trình vé khi nó gửi `hello`.
   *
   * Trường này thiếu suốt cho tới 07/09, và đó là một lỗ THẬT chứ không phải chỗ chưa gọn: sổ là
   * một `Map` toàn cục cộng một file JSON duy nhất, nên bảng Settings → Computer của người B vẽ
   * máy Windows của người A, và `findMachine("Admin-PC")` của bot người B tìm thấy nó. Đo 07/09
   * bằng `/gw/__coverage`: kênh `local-exec` tới với `saw:"user-ticket"` (n=1 luồng + 135 lượt trả
   * lời) — tức danh tính CÓ ở đúng lúc `hello` tới, ta chỉ đang bỏ nó đi.
   *
   * `host-settings.ts` ngay cạnh đã làm đúng chuyện này từ trước (`byOwner[ownerId]`, kèm chú thích
   * "hai tài khoản cùng dùng một backend sẽ ghi đè bố cục của nhau"). Sổ máy là thứ bị bỏ lại.
   */
  owner: string;
}

/**
 * Đường dẫn sổ — đọc LÚC GỌI, và **không tự dựng `../.data`**.
 *
 * File này từng ghim `join(HERE, "..", ".data", "may-da-biet.json")` như một hằng số ở mức module,
 * và cái giá đo được ngày 07/09: `may-da-biet.test.ts` gọi `nhoMay({computerId:"cu"})` nên một lượt
 * chạy bộ test ghi thẳng một máy tên **"Máy cũ"** vào sổ THẬT, rồi bảng Settings → Computer của
 * người dùng vẽ ra một máy không tồn tại. Cùng họ với bẫy §7 "bộ test xoá kho thật" nhưng ngược
 * chiều — đây là GHI, nên không có gì trông như hỏng.
 *
 * Nó cũng là lần thứ tư của đúng một chuyện: chú thích `dataDir()` trong `store.ts` đã chép rằng
 * `attachments.ts` và `observe.ts` từng tự dựng `../.data` của riêng chúng. Nên chỗ đúng không phải
 * là thêm một biến môi trường thứ năm mà là **dùng lại một nguồn sự thật** — `dataDir()` đã biết
 * `GROKBOT2_STATE_FILE` lẫn `NODE_TEST_CONTEXT`, tức bài test chạy trần cũng không tới được `.data`.
 *
 * `GROKBOT2_MAY_DA_BIET_FILE` là nửa thứ hai của cái bẫy (đúng nếp `GROKBOT2_WORKFLOWS_FILE`): bài
 * nào TẠO dữ liệu thì tự trỏ nó vào `mkdtemp` của riêng mình, vô điều kiện — vì `dataDir()` dưới
 * `NODE_TEST_CONTEXT` là MỘT thư mục dùng chung cho cả bộ, mà `node --test` chạy các file song song.
 */
const duongSo = (): string =>
  process.env.GROKBOT2_MAY_DA_BIET_FILE ?? join(dataDir(), "may-da-biet.json");

const so = new Map<string, MayDaBiet>();

/** Bao nhiêu máy thì thôi nhớ. Người dùng đổi tên máy hay cài lại Windows sinh id mới; không cắt
 *  thì sổ phình ra và bảng đầy máy ma. Mới thấy trước, cắt đuôi. */
const TOI_DA = 20;

const luu = (): void => {
  try {
    const f = duongSo();
    mkdirSync(dirname(f), { recursive: true });
    const ds = [...so.values()].sort((a, b) => b.seenAtMs - a.seenAtMs).slice(0, TOI_DA);
    writeFileSync(f, JSON.stringify(ds, null, 2), "utf8");
  } catch {
    // Đĩa đầy hay quyền ghi — bảng mất trí nhớ qua lần khởi động sau, không đáng làm hỏng lượt nào.
  }
};

/** Nạp sổ từ đĩa. Gọi một lần lúc backend lên. */
export function napMayDaBiet(): number {
  try {
    const ds = JSON.parse(readFileSync(duongSo(), "utf8")) as MayDaBiet[];
    for (const m of Array.isArray(ds) ? ds : []) {
      /*
       * Hàng KHÔNG có `owner` bị BỎ, không phải gán cho danh tính mặc định.
       *
       * Sổ ghi trước 07/09 không mang chủ, nên "của ai" là thứ không đọc được nữa — và đoán chính
       * là cái lỗ đang vá: gán hết cho `DEFAULT_USER` thì trên VPS máy của người khác thành máy
       * của người mặc định, tức leak y như cũ, chỉ khoác một cái tên. Bỏ đi thì bảng trống đúng
       * vài giây: daemon nào còn sống sẽ gửi `hello` mới kèm vé của chủ nó và tự điền lại.
       */
      if (typeof m?.computerId === "string" && typeof m?.label === "string" && typeof m?.owner === "string" && m.owner) {
        so.set(m.computerId, { computerId: m.computerId, label: m.label, owner: m.owner, seenAtMs: Number(m.seenAtMs) || 0, ...(m.standing ? { standing: m.standing } : {}), ...(m.tenNguoiDat ? { tenNguoiDat: m.tenNguoiDat } : {}) });
      }
    }
  } catch {
    // Chưa có file (lần chạy đầu) hoặc file hỏng — bắt đầu từ sổ rỗng, không phải lỗi.
  }
  return so.size;
}

/** Ghi nhận một máy vừa tự khai `hello`. `owner` là chủ của vé mà daemon trình lúc nối. */
export function nhoMay(m: { computerId: string; label: string; standing?: string; owner: string }): void {
  // Giữ lại tên người dùng đã đặt: `hello` mang tên máy tự khai, không phải quyết định của người.
  // Chỉ giữ khi CÙNG chủ — cùng một `computerId` đổi chủ nghĩa là máy đã sang tay người khác, và
  // mang tên người trước sang là nói dối cả hai.
  const truoc = so.get(m.computerId);
  const cu = truoc?.owner === m.owner ? truoc : undefined;
  so.set(m.computerId, {
    computerId: m.computerId,
    label: m.label,
    owner: m.owner,
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
 *
 * `owner` là BẮT BUỘC, không phải tuỳ chọn có mặc định "tất cả": một tham số bỏ quên phải là lỗi
 * biên dịch, không phải một lần rò rỉ im lặng.
 */
export function mayChoBang(dangNoi: { computerId: string; label: string; standing?: string; seenAtMs: number; owner: string }[], owner: string): MayDaBiet[] {
  const ra = new Map<string, MayDaBiet>();
  for (const m of so.values()) if (m.owner === owner) ra.set(m.computerId, m);
  // Máy đang nối luôn thắng bản ghi cũ: tên có thể đã đổi, và `seenAtMs` của nó là bây giờ.
  for (const m of dangNoi) {
    if (m.owner !== owner) continue;
    const cu = so.get(m.computerId);
    ra.set(m.computerId, {
      computerId: m.computerId,
      label: m.label,
      owner,
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
 * Máy của người KHÁC cũng trả `null`: từ chối phải trông giống "không có máy đó", vì một câu lỗi
 * khác đi là xác nhận với người hỏi rằng id ấy tồn tại ở đâu đó (cùng luật với cửa `?k=` của trang
 * tải, §7 — token sai thì rơi về gói công khai chứ không trả 403).
 */
export function datTen(computerId: string, ten: string, owner: string): MayDaBiet | null {
  const m = so.get(computerId);
  const t = ten.trim();
  if (!m || m.owner !== owner || !t) return null;
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
export function datQuyen(computerId: string, quyen: string, owner: string): MayDaBiet | null {
  const m = so.get(computerId);
  const q = quyen.trim();
  if (!m || m.owner !== owner || !q) return null;
  const moi: MayDaBiet = { ...m, standing: q };
  so.set(computerId, moi);
  luu();
  return moi;
}

/** Quên hết — cho test. */
export function quenHet(): void { so.clear(); }
