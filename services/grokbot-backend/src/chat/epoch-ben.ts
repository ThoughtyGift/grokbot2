/**
 * Epoch + mốc thứ tự của replica — BỀN qua khởi động lại.
 *
 * ── Vì sao ──────────────────────────────────────────────────────────────────────────────────────
 *
 * `EPOCH = String(Date.now())` đọc lúc nạp module, nên **mỗi lần backend nạp lại là một epoch mới**
 * và mọi replica đang neo ở epoch cũ thành mồ côi. Đo 08/09/2026 trên `New Bot` (`agent-1078`): lát
 * client neo epoch **15:28:09** trong khi backend ở **18:16:12**; bot trả lời trọn HAI lượt (tới
 * `e18401` lúc 23:07:03) mà pane đứng ở `e18306` lúc 14:34, hai tin người dùng treo thành hàng
 * `nonce:` — không banner, không "Failed to send", chỉ im.
 *
 * Client **không tự vượt** epoch: phát hai khung `ordered` vào nó thì lát không nhúc nhích, và
 * coverage nói rõ nó đã THÔI hỏi — **283** lượt tải đuôi kể từ 18:16 nhưng **0** lượt trong 25 s có
 * khung tới, `treo 0` (không lời gọi nào kẹt phía backend). Chú thích cũ ở `conversation/index.ts`
 * ghi *"đổi khi backend khởi động lại → client thấy epoch lạ → tự tải đuôi neo lại"*: vế đầu đúng,
 * vế sau KHÔNG xảy ra. Cùng lớp với chú thích `sse.ts` mà §5 mục 19 đã trả giá — một câu đúng về
 * CƠ CHẾ, sai về HỆ QUẢ.
 *
 * ── Vì sao phải làm CẢ HAI nửa, không được làm một ──────────────────────────────────────────────
 *
 * Giữ epoch cố định mà để `sequence` tụt thì **hỏng nặng hơn** trạng thái hiện tại. `seqFor` seed từ
 * `transcripts.get(agentId).length`, còn `sequence` tăng mỗi **SỰ KIỆN** (mỗi khung `updated` của
 * một lượt streaming là một số) — nên sau khởi động lại nó tụt về `length`, thấp hơn số đã phát.
 * Client 0.43 chỉ áp `sequence === acceptedSequence + 1`, và `ingestSnapshot` bỏ thẳng khi
 * `throughSequence < acceptedSequence`. Cùng một epoch mà số tụt = **sai thứ tự IM LẶNG**, đúng thứ
 * epoch sinh ra để chặn. Nên epoch bền phải đi kèm một mốc **không bao giờ tụt**.
 *
 * ── Giữ mốc mà không ghi đĩa mỗi token ──────────────────────────────────────────────────────────
 *
 * Đặt chỗ theo LÔ: trên đĩa giữ `datCho[khoá]` = số đã ĐẶT CHỖ, luôn ≥ mọi số đã phát. Lúc nạp, bộ
 * đếm bắt đầu từ chính số ấy; khi bộ đếm vượt nó thì ghi lại `số + KHOI`. Một lần ghi cho mỗi `KHOI`
 * sự kiện, và nếu tiến trình chết bất ngờ thì số phát ra sau khi nạp lại vẫn **cao hơn** mọi số đã
 * phát — mất chỗ chứ không lặp chỗ.
 *
 * Giá phải trả, và vì sao nó vô hại: chuỗi có LỖ sau mỗi lần khởi động lại. Client không đòi chuỗi
 * liền — nó đòi TĂNG DẦN từ mốc nó neo, và `installBaseline` đặt lại `acceptedSequence` theo
 * `throughSequence` của trang đuôi. (Bản ghi vốn đã khuyết chuỗi vì id entry là bộ đếm toàn cục —
 * `agent-1085` 45 entry / 21 lỗ vẽ đủ, bảng theo dõi §5 mục 19.)
 *
 * Epoch và mốc nằm CÙNG một tệp có chủ ý: xoá hay khôi phục kho là cả hai đi cùng nhau, nên không
 * bao giờ có cảnh "epoch cũ + mốc mới" — đúng cảnh đẻ ra sai thứ tự.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { dataDir } from "../store.js";

/** Một lần ghi đĩa cho mỗi KHOI sự kiện. Lỗ chuỗi sau khởi động lại tối đa bằng con số này. */
export const KHOI = 1000;

type So = { epoch: string; datCho: Record<string, number> };

/** Đọc `dataDir()` — MỘT nguồn sự thật; không tự dựng `join(HERE,"..",".data")` (bảng theo dõi §7). */
const duong = (): string => process.env.GROKBOT2_REPLICA_EPOCH_FILE ?? join(dataDir(), "replica-epoch.json");

let so: So | null = null;

function doc(): So {
  if (so) return so;
  try {
    const d = JSON.parse(readFileSync(duong(), "utf8")) as Partial<So>;
    if (typeof d?.epoch === "string" && d.epoch.length > 0) {
      so = { epoch: d.epoch, datCho: { ...(d.datCho ?? {}) } };
      return so;
    }
  } catch { /* chưa có tệp, hoặc tệp hỏng — đúc mới bên dưới */ }
  // Tệp hỏng thì đúc epoch MỚI thay vì cố đọc: mốc đã mất nên giữ epoch cũ là đúng cảnh sai thứ tự.
  so = { epoch: String(Date.now()), datCho: {} };
  ghi();
  return so;
}

function ghi(): void {
  if (!so) return;
  try {
    const p = duong();
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify(so));
  } catch { /* ghi không được thì vẫn chạy: mất tính BỀN, không mất lượt của ai */ }
}

/** Epoch của mọi replica — cùng một chuỗi qua các lần khởi động lại. */
export const epochBen = (): string => doc().epoch;

/** Sàn khởi đầu cho một bộ đếm: số đã đặt chỗ, luôn ≥ mọi số đã phát trước đó. */
export const mocSeq = (khoa: string): number => doc().datCho[khoa] ?? 0;

/** Ghi nhận một số vừa phát; đặt chỗ thêm một lô khi nó vượt mốc. Số nhỏ hơn mốc KHÔNG kéo mốc xuống. */
export function datCho(khoa: string, seq: number): void {
  const s = doc();
  if (seq <= (s.datCho[khoa] ?? 0)) return;
  s.datCho[khoa] = seq + KHOI;
  ghi();
}

/** Chỉ cho bài đo: quên bản đã nạp để mô phỏng một lần khởi động lại. */
export function _quenChoTest(): void { so = null; }
