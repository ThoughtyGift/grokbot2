/**
 * OBS trên box — bot có dùng được không, và làm sao bật nó.
 *
 * ── Vì sao cần một file riêng chỉ để trả lời "có OBS không" ─────────────────────────────────────
 *
 * OBS đã cài và quay được (`infra/box/README.md` có số đo). Nhưng "cài được" và "bot dùng được" là
 * hai chuyện: chừng nào lời nhắc không nhắc tới nó, năng lực ấy chỉ mình tôi gọi được bằng tay —
 * đúng khoảng cách mà bảng theo dõi phân biệt ở §2.
 *
 * Nói thẳng trong lời nhắc "máy bạn có OBS" thì rẻ, nhưng sai với mọi box chưa cài: bot sẽ hứa quay
 * màn hình rồi chạy một lệnh không tồn tại. Còn dò box mỗi lần dựng lời nhắc thì mỗi lượt chat cõng
 * thêm một vòng mạng — `cachedSkillsSection()` đã học bài đó rồi.
 *
 * Nên: dò MỘT lần ở nền lúc backend lên, nhớ kết quả, và lời nhắc chỉ đọc biến đã nhớ.
 */
import { boxCall, boxConfigured } from "./box-exec.js";

/** `null` = chưa dò xong. Lời nhắc coi `null` như "không có" — thà im còn hơn hứa nhầm. */
let coObs: boolean | null = null;

/** Lệnh idempotent trên box; xem `infra/box/obs-dam-bao.sh`. */
const LENH = "sh $HOME/bin/obs-dam-bao";

/**
 * Dò một lần, ở nền. Gọi lúc backend lên.
 *
 * Chỉ kiểm SỰ CÓ MẶT của script và của AppImage — không khởi động OBS. Bật OBS lúc backend lên là
 * chiếm ~300 MB RAM của box để chờ một việc có thể cả tuần không ai nhờ, mà RAM mới là thứ chặn sức
 * chứa box (14 bot, không phải 37 như đĩa gợi ý).
 */
export async function doObsTrenBox(): Promise<boolean> {
  if (!boxConfigured()) { coObs = false; return false; }
  try {
    const r = await boxCall<{ stdout?: string }>("exec", {
      command: 'test -x "$HOME/bin/obs-dam-bao" && test -x "$HOME/apps/obs.AppImage" && echo CO || echo KHONG',
      timeoutMs: 20_000,
    });
    coObs = String(r?.stdout ?? "").includes("CO");
  } catch {
    // Box không với tới được lúc khởi động là chuyện thường (VPS đang lên, hầm chưa nối). Coi như
    // không có: bot sẽ không hứa thứ nó chưa chắc làm được, và lần khởi động sau dò lại.
    coObs = false;
  }
  if (coObs) console.log("[grokbot2] box có OBS — bot dùng được scene/record");
  return coObs;
}

/** Lời nhắc đọc hàm này. `null` (chưa dò xong) đọc như "không có". */
export const obsCoSan = (): boolean => coObs === true;

/**
 * Đoạn lời nhắc về OBS. Rỗng khi box không có OBS.
 *
 * Dạy đúng ba thứ, và cả ba đều là chỗ đã trả giá khi tự làm bằng tay:
 *   · phải chạy `obs-dam-bao` TRƯỚC, vì OBS không sống thường trực;
 *   · điều khiển qua websocket bằng script có sẵn, không tự dựng kết nối;
 *   · file mp4 chỉ đọc được sau khi `StopRecord` đóng output — đọc sớm thì `ffprobe` báo
 *     "moov atom not found", tức file có mà ruột rỗng.
 */
export function obsProtocol(): string {
  if (!obsCoSan()) return "";
  const nl = String.fromCharCode(10);
  return nl + nl + [
    "OBS TRÊN MÁY CỦA BẠN: máy bạn có OBS Studio, dùng được để quay màn hình box, đổi scene, và",
    "phát trực tiếp. OBS KHÔNG chạy sẵn — nó tốn RAM nên chỉ bật khi cần.",
    "",
    `1. Bật (chạy bao nhiêu lần cũng được): TOOL_CALL: run_terminal_command_v2({"command":"${LENH}"})`,
    '   Trả về "SAN-SANG" (đang chạy rồi) hoặc "DA-BAT" (vừa bật). "THIEU"/"HONG" thì đọc thông báo',
    "   và nói lại cho người dùng — đừng thử lại vòng vo.",
    "",
    '2. Quay: TOOL_CALL: run_terminal_command_v2({"command":"cd $HOME/apps && node obs-ws.mjs quay 10"})',
    "   Số cuối là số giây. Nó tự thêm nguồn màn hình nếu scene chưa có, rồi in đường dẫn file.",
    "",
    "3. Clip rơi vào `quay/` NGAY TRONG gốc làm việc của bạn, nên xem lại và gửi kèm được luôn:",
    '   TOOL_CALL: watch_video({"path":"quay/<tên file>.mp4"}) — đường tương đối, không cần copy đi đâu.',
    "   Đợi lệnh quay kết thúc hẳn rồi mới đọc: mp4 chỉ hoàn tất khi OBS đóng output, đọc sớm sẽ ra",
    "   một file rỗng ruột (`moov atom not found`).",
    "",
    "Muốn cảnh phức tạp hơn (overlay, nhiều nguồn, phát trực tiếp) thì nói với người dùng là làm",
    "được nhưng cần dựng scene trước, đừng hứa suông rằng nó đã sẵn.",
  ].join(nl);
}
