/**
 * Dạy việc bằng VIDEO — cách app gốc làm, và nó khác hẳn hai bộ ghi đang có.
 *
 * ── Ba cách dạy việc, và vì sao thêm cách thứ ba ────────────────────────────────────────────────
 *
 * `teach.ts` bắt sự kiện DOM trong Chrome của box; `desktop-record.ts` bắt sự kiện X11 trên màn
 * hình box. Cả hai chính xác hơn video ở chỗ chúng biết ĐÚNG selector đã bấm và chuỗi đã gõ — video
 * thì phải suy ra. Nhưng cả hai đều cứng: bài học là một chuỗi thao tác, nên cửa sổ dịch chỗ hay
 * trang đổi bố cục là hỏng, và không ai đọc lại được nó để sửa.
 *
 * App gốc đi đường khác. Moi từ bundle 0.29:
 *
 *     "The recording is finished. Learn the task from it."   ← tin client gửi cho BOT khi ghi xong
 *     "Learn from demonstration"                             ← nhãn chip đính kèm tin đó
 *     "learn-from-demonstration"                             ← id skill, kèm workflowId
 *     case "skill": return t.workflowId
 *
 * Nên host của họ KHÔNG tự dựng routine. Nó quay màn hình, rồi đưa cho bot một tin kèm chip skill,
 * và chính con bot chạy skill ấy để tự học: xem video, đối chiếu lịch sử trình duyệt, rồi viết ra
 * một workflow mới. Bài học thành VĂN BẢN bot đọc được — sửa được, người dùng đọc được, và nó bắt
 * được ý định ("tìm nến thơm trên Alibaba") chứ không chỉ chuỗi thao tác.
 *
 * ── Hình dạng trên đĩa của hãng, và ta chép theo (06/09/2026) ───────────────────────────────────
 *
 * Người dùng dán nguyên văn skill `learn-from-demonstration` của app gốc (nhãn *Managed by Cursor*). Nó
 * không phải một "form" mà là QUY TRÌNH VẬN HÀNH: host ghi mỗi buổi quay thành một phiên
 * `teach-sessions/teach-<ISO>-<uuid>/{demo.mp4, session.json}` và một phiếu trong hàng đợi
 * `teach-sessions/queues/<scope>/pending/<phiên>.json`; tin bàn giao chỉ tiêm `Teach recording queue
 * scope`, còn bot tự `flock` nhận phiếu, đọc `videoPath`/`ffmpegPid` từ `session.json`, chờ ffmpeg đóng
 * file, ffprobe, cắt khung, xem video, đối chiếu lịch sử trình duyệt, viết skill, rồi xoá video và
 * hoàn tất phiếu. Bản trước của ta đưa thẳng đường dẫn video vào tin và bỏ hàng đợi — chạy được, nhưng
 * lệch quy trình: hai buổi dạy liền nhau không xếp hàng, bot đọc đường dẫn từ tin (hãng cấm), và bảng
 * skill của client hiện "Private skill" thay vì "Managed by Cursor". File này nay chép đúng hình ấy.
 *
 * ── Không thay hai bộ ghi cũ ────────────────────────────────────────────────────────────────────
 *
 * Ba cách trả lời ba tình huống khác nhau, nên cả ba cùng sống: việc nằm gọn trong một trang web
 * thì `teach.ts` cho bài học bền nhất (selector sống lâu hơn toạ độ); việc rải khắp desktop thì
 * `desktop-record.ts`; còn việc cần HIỂU chứ không chỉ lặp lại thì đường video này. Nhật ký CDP của
 * `teach.ts` đi kèm mỗi phiên video (`actions.md`) — nó là "lịch sử Chrome" mà hãng đối chiếu, và tốt
 * hơn vì có selector + URL thật.
 */
import { createHash, randomUUID } from "node:crypto";
import { boxCall, boxConfigured } from "./box-exec.js";
import { displayOf } from "./displays.js";
import { create as taoSkill, forAgent as skillCuaBot, update as suaSkill, type Workflow } from "./workflows.js";

/** Tên skill — trùng id app gốc dùng, để bản ghi của ta đọc được cạnh transcript của họ. */
export const TEN_SKILL = "learn-from-demonstration";

/** Mô tả — dịch câu của hãng: "Turn a screen-recorded demonstration on your computer into a reusable skill. Use when a teach recording finishes." */
export const MO_TA_SKILL = "Biến một bản quay màn hình trên máy tính của bạn thành skill dùng lại được. Dùng khi một buổi dạy việc vừa quay xong.";

/** Câu client gốc gửi cho bot khi bản ghi xong. Chép nguyên văn từ bundle. */
export const CAU_GHI_XONG = "The recording is finished. Learn the task from it.";

/** Thư mục gốc của mọi phiên dạy, tương đối GỐC LÀM VIỆC của box — cùng tên với hãng (`/workspace/teach-sessions`). */
export const THU_MUC_PHIEN = "teach-sessions";

/**
 * `teachQueueScope` — khoá hàng đợi. Hãng dùng sha256 (0 lần trong bundle ⇒ host tự sinh). Băm theo BOT,
 * không theo video: hàng đợi là của một con bot, hai buổi dạy liền nhau phải xếp vào cùng một hàng để
 * bot nhận lần lượt — đúng nghĩa "claim the oldest unprocessed recording for this agent".
 */
export const scopeCua = (agentId: string): string => createHash("sha256").update(agentId).digest("hex");

/** Tên phiên, dạng của hãng: `teach-20260905T040542Z-<uuid>` — ISO bỏ `-` `:` và phần lẻ giây. */
const tenPhienMoi = (): string => `teach-${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")}-${randomUUID()}`;

/** Một phiên quay đang chạy. Chỉ một phiên mỗi lúc — hai bộ ghi cùng chạy là ghi đúp mọi thứ. */
interface PhienQuay {
  agentId: string;
  /** `teach-<ISO>-<uuid>` — cũng là tên phiếu trong hàng đợi và phần cuối của `clientNonce`. */
  sessionId: string;
  /** Tuyệt đối trên box, vd `/home/gb2u003/workspace/teach-sessions/teach-…` — `session.json` của hãng ghi tuyệt đối. */
  sessionDir: string;
  videoPath: string;
  display: string;
  batDauMs: number;
  /** PID của ffmpeg trên box — để dừng ĐÚNG nó, không dò lại bằng tên. */
  pid: number;
}
let phien: PhienQuay | null = null;

/** Phiên đã quay xong — thứ `stopTeach` cần để xếp hàng và bàn giao. */
export interface PhienXong {
  agentId: string;
  sessionId: string;
  sessionDir: string;
  videoPath: string;
  giay: number;
}

/** Mười phút, bằng đúng hạn của hai bộ ghi kia — dài hơn thì không ai ngồi dạy hết. */
const TOI_DA_MS = 600_000;

const sh = async (command: string, timeoutMs = 30_000): Promise<{ stdout: string; exitCode: number }> => {
  const r = await boxCall<{ stdout?: string; exitCode?: number }>("exec", { command, timeoutMs });
  return { stdout: String(r?.stdout ?? ""), exitCode: Number(r?.exitCode ?? 0) };
};

/** Ghi một file văn bản lên box qua base64 — nội dung có thể chứa nháy, `$`, backtick; đừng nhét thẳng vào shell. */
const ghiFile = (duongDan: string, noiDung: string): string =>
  `printf '%s' '${Buffer.from(noiDung, "utf8").toString("base64")}' | base64 -d > "${duongDan}"`;

/** `session.json` — đúng các khoá kịch bản của hãng đọc (`sessionDir`, `videoPath`, `ffmpegPid`), cộng mốc giờ. */
function sessionJson(p: PhienQuay, them: Record<string, unknown> = {}): string {
  return JSON.stringify({
    sessionDir: p.sessionDir,
    videoPath: p.videoPath,
    ffmpegPid: p.pid,
    startedAt: new Date(p.batDauMs).toISOString(),
    agentId: p.agentId,
    display: p.display,
    queueScope: scopeCua(p.agentId),
    ...them,
  }, null, 2);
}

/**
 * Bắt đầu quay màn hình box.
 *
 * `x11grab` đọc thẳng từ display của bot — cùng màn hình mà pane VNC của client đang chiếu, nên thứ
 * quay được đúng bằng thứ người dùng nhìn thấy khi họ demo.
 *
 * `-preset ultrafast` là cố ý: box không có GPU (đo được — VAAPI mở `/dev/dri/renderD128` thất bại,
 * không có `libnvidia-encode`), nên mọi giây encode đều ăn CPU của chính con bot đang làm việc.
 * Chất lượng chỉ cần đủ để một model đọc được chữ trên màn hình.
 */
export async function batDauQuayDemo(agentId: string): Promise<{ ok: boolean; lyDo?: string }> {
  if (!boxConfigured()) return { ok: false, lyDo: "chưa nối box" };
  if (phien) return { ok: false, lyDo: `đang quay cho ${phien.agentId} rồi` };

  // Gốc làm việc THẬT của daemon (`/home/<user>/workspace`) — `session.json` của hãng ghi đường tuyệt đối,
  // và `$HOME` trong chuỗi Node không được shell nở (bẫy đã trả 01/09).
  const goc = (await sh("pwd")).stdout.trim().replace(/\/+$/, "");
  if (!goc.startsWith("/")) return { ok: false, lyDo: "không đọc được gốc làm việc trên box" };
  const sessionId = tenPhienMoi();
  const sessionDir = `${goc}/${THU_MUC_PHIEN}/${sessionId}`;
  const videoPath = `${sessionDir}/demo.mp4`;
  /*
   * Quay ĐÚNG màn hình mà pane của client đang chiếu.
   *
   * Bật `GROKBOT2_PER_BOT_DISPLAY=on` (VPS) thì mỗi bot có một Xvfb riêng (`:521`…) và pane VNC chiếu
   * display đó; bản đầu đóng cứng `:77` nên trên VPS video sẽ là màn hình CHUNG — người dùng demo ở
   * một nơi, video quay một nơi khác, và bước "xem thử hai khung hình" sẽ báo bản ghi trắng. Máy dev
   * không bật cờ ấy nên `displayOf` trả null và `:77` vẫn đúng.
   */
  const display = displayOf(agentId)?.display ?? process.env.GROKBOT2_BOX_DISPLAY ?? ":77";
  /*
   * `-nostdin` là thứ đã cứu một lần: ffmpeg chạy nền mà còn đọc stdin sẽ nuốt phím của tiến trình
   * khác và tự dừng giữa chừng. `setsid` để nó sống qua lệnh exec này.
   *
   * `-video_size` LẤY TỪ MÀN HÌNH, không để ffmpeg tự đoán: bỏ ra thì x11grab mặc định 640x480 và quay
   * đúng một góc trên-trái (đo 01/09: "121 giây, 640x480, cả 6 khung y hệt nhau" trên màn 1920x1080).
   * Đọc `xdpyinfo` mỗi lần thay vì đóng cứng, vì box khác có thể dựng Xvfb cỡ khác.
   *
   * `setsid -f ffmpeg … > ffmpeg.log 2>&1 < /dev/null` — KHÔNG `&`, không subshell. Bản trước
   * `A && B && setsid ffmpeg … &` làm lệnh "bật quay" trả về đúng lúc hết `timeoutMs` (40 s) và ffmpeg
   * bị hạ theo — bốn lượt đo đầu 06/09 video nào cũng dài đúng 40 s (bảng theo dõi §7 "subshell ôm ống").
   *
   * `pgrep -u "$(id -un)" -n -f "[x]11grab"`: `[x]` để không khớp chính dòng lệnh này; `-u` vì box dùng
   * chung (một lượt bắt được x11grab của user KHÁC và `kill` trả EPERM); `-n` lấy cái mới nhất.
   */
  const lenh = `mkdir -p "${sessionDir}" && cd "${sessionDir}" && `
    + `SZ=$(DISPLAY=${display} xdpyinfo 2>/dev/null | awk '/dimensions:/{print $2}'); SZ=\${SZ:-1920x1080}; `
    + `DISPLAY=${display} setsid -f ffmpeg -nostdin -y -f x11grab -framerate 10 -video_size $SZ -i ${display} `
    + `-c:v libx264 -preset ultrafast -pix_fmt yuv420p demo.mp4 > ffmpeg.log 2>&1 < /dev/null; `
    + `sleep 2; pgrep -u "$(id -un)" -n -f "[x]11grab"`;
  const r = await sh(lenh, 40_000);
  const pid = Number(r.stdout.trim());
  if (!pid) return { ok: false, lyDo: "ffmpeg không lên — xem ffmpeg.log trong thư mục phiên" };

  phien = { agentId, sessionId, sessionDir, videoPath, display, batDauMs: Date.now(), pid };
  // `session.json` ghi NGAY khi ffmpeg lên: kịch bản của hãng đọc `ffmpegPid` từ đây để chờ nó đóng file.
  await sh(ghiFile(`${sessionDir}/session.json`, sessionJson(phien)));
  console.log(`[grokbot2] [teach-video] bắt đầu quay cho ${agentId} (${display}) → ${videoPath}`);
  return { ok: true };
}

/**
 * Dừng quay và trả phiên đã xong (đường dẫn tuyệt đối trên box).
 *
 * Gửi `SIGINT`, không `SIGKILL`: ffmpeg cần tín hiệu đó để ghi nốt `moov atom` và đóng mp4. Giết
 * thô thì file vẫn có, dung lượng vẫn có, mà `ffprobe` báo "moov atom not found" — đúng cái bẫy đã
 * trả giá với OBS. Rồi chờ kích thước ổn định, vì `kill` trả về ngay còn ffmpeg thì chưa xong.
 * Skill của hãng nói "Host already sent SIGINT. Do not stop ffmpeg yourself" — host là ĐÂY.
 */
export async function dungQuayDemo(): Promise<PhienXong | null> {
  if (!phien) return null;
  const p = phien;
  phien = null;

  // Theo PID đã ghi lúc bật; dự phòng bằng regex có ngoặc vuông (xem chú thích ở `batDauQuayDemo`).
  await sh(`kill -INT ${p.pid} 2>/dev/null || pkill -INT -u "$(id -un)" -f "[x]11grab" || true`, 20_000);
  // Chờ file đóng: kích thước ổn định hai lần liên tiếp, tối đa ~20 giây.
  await sh(
    `for i in $(seq 1 40); do a=$(stat -c%s "${p.videoPath}" 2>/dev/null || echo 0); sleep 0.5; `
    + `b=$(stat -c%s "${p.videoPath}" 2>/dev/null || echo 0); [ "$a" = "$b" ] && [ "$a" != "0" ] && break; done`,
    40_000,
  );
  const r = await sh(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${p.videoPath}" 2>/dev/null || echo 0`);
  const giay = Number(r.stdout.trim()) || Math.round((Date.now() - p.batDauMs) / 1000);
  await sh(ghiFile(`${p.sessionDir}/session.json`, sessionJson(p, { endedAt: new Date().toISOString(), durationSec: giay })));
  console.log(`[grokbot2] [teach-video] dừng: ${p.videoPath}, ${giay}s`);
  return { agentId: p.agentId, sessionId: p.sessionId, sessionDir: p.sessionDir, videoPath: p.videoPath, giay };
}

export const dangQuayDemo = (): boolean => phien !== null;
export const hanQuayDemoMs = TOI_DA_MS;

/**
 * Xếp phiên vào hàng đợi của bot — bước host làm TRƯỚC khi bàn giao, để bot có phiếu mà nhận.
 *
 * Phiếu là `queues/<scope>/pending/<sessionId>.json` = `{"sessionDir": …}` (kịch bản của hãng đọc đúng
 * khoá ấy rồi mới mở `session.json`). Nhật ký CDP kèm theo ghi vào `actions.md` trong thư mục phiên —
 * đó là "lịch sử Chrome" mà bước 3 của hãng đối chiếu, và bot đọc nó từ đĩa, không từ tin nhắn.
 */
export async function xepHangBaiHoc(p: PhienXong, nhatKyCdp?: string): Promise<void> {
  const scope = scopeCua(p.agentId);
  const goc = p.sessionDir.slice(0, p.sessionDir.indexOf(`/${THU_MUC_PHIEN}/`));
  const hang = `${goc}/${THU_MUC_PHIEN}/queues/${scope}`;
  const lenh = [
    `mkdir -p "${hang}/pending" "${hang}/claimed"`,
    ...(nhatKyCdp?.trim() ? [ghiFile(`${p.sessionDir}/actions.md`, `# Nhật ký thao tác trình duyệt (bộ ghi tự bắt, cùng buổi demo)\n\n${nhatKyCdp.trim()}\n`)] : []),
    ghiFile(`${hang}/pending/${p.sessionId}.json`, JSON.stringify({ sessionDir: p.sessionDir }, null, 2)),
  ].join(" && ");
  await sh(lenh);
}

/**
 * Bài học — chép quy trình `learn-from-demonstration` của app gốc (nhãn *Managed by Cursor*) sang tool của ta.
 *
 * Mỗi mục là một bước của họ (0 → 6 + mục thông tin nhạy cảm), đổi đúng ba thứ: (1) `Shell`/`Task`/`update_state`
 * của họ → `run_terminal_command_v2`/`watch_video`/`create_workflow`/`view_image` của ta; (2) gốc `/workspace` → gốc
 * làm việc của bot (`$PWD`); (3) "lịch sử Chrome" → `actions.md` do bộ ghi CDP của ta để lại trong thư mục phiên.
 * Phần hàng đợi (`flock`, lease 12 giờ, nhận phiếu cũ nhất, khôi phục phiếu hết hạn) giữ NGUYÊN — bản trước cắt
 * nó đi vì "hạ tầng của họ", nhưng thiếu nó thì hai buổi dạy liền nhau không xếp hàng và bot đọc đường dẫn từ
 * tin nhắn, điều hãng cấm thẳng.
 */
export const NOI_DUNG_SKILL = [
  "# Học từ một buổi demo",
  "",
  "Bạn nhận một bản quay màn hình người dùng đang làm mẫu một việc trên MÁY TÍNH CỦA BẠN. File mp4 có thể vẫn",
  "đang được ghi nốt lúc lượt này bắt đầu. Hãy biến buổi demo đó thành một skill dùng lại được. Làm việc công khai:",
  "gửi một câu ngắn báo bạn đang xem bản demo, rồi kể lại những mốc đáng kể trong lúc làm.",
  "",
  "## 0. Chờ bản ghi đóng file xong",
  "",
  "Host đã gửi SIGINT cho ffmpeg. Đừng tự dừng nó — không SIGINT, không SIGKILL.",
  "",
  "Host tiêm một `Teach recording queue scope` vào lượt gọi skill này. Dùng nó để nhận (claim) NGUYÊN TỬ bản ghi cũ",
  "nhất chưa xử lý của bot này. Đọc `session.json` của phiên vừa nhận, rồi lấy `videoPath` và `ffmpegPid` từ đó.",
  "Không lấy đường dẫn hay PID từ tin nhắn của người dùng.",
  "",
  "Chạy MỘT lệnh `run_terminal_command_v2` duy nhất cho cả khối dưới (không tách ra, không ngủ chờ bằng nhiều lượt).",
  "Không gọi `wait` lên pid — ffmpeg không phải tiến trình con của bạn:",
  "",
  "```",
  'scope="<Teach recording queue scope trong bài giao>"',
  'queue_dir="$PWD/teach-sessions/queues/$scope"',
  'pending_dir="$queue_dir/pending"',
  'claimed_dir="$queue_dir/claimed"',
  "lease_minutes=720",
  "legacy_claim_minutes=1440",
  'mkdir -p "$pending_dir" "$claimed_dir"',
  'exec 9>"$queue_dir/.claim.lock"',
  "flock 9",
  'for claimed in "$claimed_dir"/*.json; do',
  '  [ -e "$claimed" ] || break',
  '  lease="$claimed.lease"',
  '  stale_claim=""',
  '  if [ -e "$lease" ] && [ -n "$(find "$lease" -mmin +"$lease_minutes" -print -quit)" ]; then',
  '    stale_claim="$claimed"',
  '  elif [ ! -e "$lease" ] && [ -n "$(find "$claimed" -mmin +"$legacy_claim_minutes" -print -quit)" ]; then',
  '    stale_claim="$claimed"',
  "  fi",
  '  if [ -n "$stale_claim" ]; then',
  '    mv "$stale_claim" "$pending_dir/$(basename "$stale_claim")"',
  '    rm -f "$lease"',
  "  fi",
  "done",
  'claim=""',
  'for pending in "$pending_dir"/*.json; do',
  '  [ -e "$pending" ] || break',
  '  candidate="$claimed_dir/$(basename "$pending")"',
  '  if mv "$pending" "$candidate" 2>/dev/null; then',
  '    claim="$candidate"',
  "    break",
  "  fi",
  "done",
  'if [ -n "$claim" ]; then',
  '  touch "$claim.lease"',
  "fi",
  "flock -u 9",
  '[ -n "$claim" ] || { echo "no recording is queued"; exit 1; }',
  'claim_lease="$claim.lease"',
  "restore_claim() {",
  '  exec 9>"$queue_dir/.claim.lock"',
  "  flock 9",
  '  if [ -e "$claim" ]; then',
  '    mv "$claim" "$pending_dir/$(basename "$claim")"',
  '    rm -f "$claim_lease"',
  "  fi",
  "  flock -u 9",
  "}",
  'session_dir=$(jq -er --arg goc "$PWD/teach-sessions/teach-" \'.sessionDir | select(type == "string") | select(startswith($goc))\' "$claim") || { restore_claim; exit 1; }',
  'session_json="$session_dir/session.json"',
  'video=$(jq -er --arg prefix "$session_dir/" \'.videoPath | select(type == "string") | select(startswith($prefix)) | select(length > 0)\' "$session_json") || { restore_claim; exit 1; }',
  'pid=$(jq -er \'.ffmpegPid | select(type == "number" or type == "string")\' "$session_json") || { restore_claim; exit 1; }',
  "for _ in $(seq 1 150); do",
  '  if [ -n "$pid" ] && [ "$pid" != "null" ] && kill -0 "$pid" 2>/dev/null && tr \'\\0\' \' \' < /proc/"$pid"/cmdline 2>/dev/null | grep -qF "$video"; then',
  "    sleep 0.2",
  "    continue",
  "  fi",
  "  break",
  "done",
  'echo "claim=$claim"; echo "session_dir=$session_dir"; echo "video=$video"',
  'ffprobe -v error -show_entries format=duration -of csv=p=0 "$video"',
  "```",
  "",
  "Giữ lại đường dẫn phiếu đã nhận, file lease của nó, thư mục phiên, đường video và thời lượng cho các bước sau.",
  "Lease kéo dài 12 giờ; việc khôi phục chỉ chuyển những phiếu có lease đã hết hạn, và chỉ coi một phiếu KHÔNG có",
  "lease (giao thức cũ) là bỏ rơi sau 24 giờ. Thà chờ thử lại sau còn hơn giành một phiếu có thể đang sống. Không có",
  "bản ghi nào trong hàng đợi thì dừng, không nhắn gì cho người dùng. Không đọc được metadata của phiên thì nói với",
  "người dùng là bản ghi không có sẵn rồi dừng — lệnh trên đã trả phiếu về hàng đợi để thử lại sau. ffmpeg đã thoát,",
  "hay dòng lệnh của nó không còn chứa demo.mp4 này, thì đi tiếp ngay tới ffprobe. ffprobe lỗi, thời lượng thiếu,",
  "không phải số, hay dưới 0,5 giây thì bản ghi không dùng được: nói với người dùng, bỏ bước xem video, nhưng vẫn",
  "xoá video và hoàn tất phiếu ở bước 6. Ngược lại dùng thời lượng đó để chọn mốc cắt khung ở bước 1.",
  "",
  "Trước khi xem video, sau khi xem xong, và trước bất kỳ lệnh shell nào sau 30 phút làm việc, gia hạn lease của",
  "chính bạn dưới cùng ổ khoá:",
  "",
  "```",
  'exec 9>"$queue_dir/.claim.lock"',
  "flock 9",
  '[ -e "$claim" ] && touch "$claim_lease"',
  "flock -u 9",
  "```",
  "",
  "Không bao giờ chuyển hay khôi phục một phiếu chưa hết lease, kể cả khi còn bản ghi khác đang chờ.",
  "",
  "## 1. Xem thử bản ghi (rẻ, trước khi xem cả video)",
  "",
  "Cắt hai khung hình rồi NHÌN chúng trước khi bỏ công xem cả video. Ghi vào thư mục phiên (tool xem ảnh chỉ mở",
  "được file TRONG gốc làm việc — `/tmp` thì không):",
  "",
  "```",
  'ffmpeg -y -v error -ss <20% thời lượng> -i "$video" -frames:v 1 "$session_dir/frame_a.png"',
  'ffmpeg -y -v error -ss <70% thời lượng> -i "$video" -frames:v 1 "$session_dir/frame_b.png"',
  "```",
  "",
  'Rồi `TOOL_CALL: view_image({"path":"<session_dir>/frame_a.png"})` và khung b. Nếu chúng chỉ là màn hình trống hay',
  "sai cửa sổ thì bản ghi hỏng: KHÔNG xem video nữa. Dựng lại được gì thì dựng từ nhật ký trình duyệt (bước 3), nói",
  "với người dùng là bản ghi ra trắng, mời quay lại. Vẫn xoá video ở bước 6.",
  "",
  "## 2. Xem video",
  "",
  '`TOOL_CALL: watch_video({"path":"<đường video>"})` — tool tự cắt khung trên máy bạn nên không có trần dung lượng;',
  'clip dài thì gọi lại theo ĐOẠN với `"tu"`/`"den"` (giây) cho từng đoạn 20–30 giây, nhiều khung trong một tấm thì',
  "chữ nhỏ đi không đọc được. Yêu cầu một bản tường thuật có cấu trúc:",
  "",
  "1. Trạng thái ban đầu (đang mở trang hay ứng dụng nào)",
  "2. Mọi thao tác đáng kể theo thứ tự thời gian (bấm, gõ, điều hướng, đổi URL, menu, cuộn, nút)",
  "3. Trạng thái kết thúc",
  "4. Mốc thời gian gần đúng",
  "5. Chuỗi đã gõ CHÍNH XÁC (từ khoá tìm, giá trị form) — KHÔNG BAO GIỜ chép mật khẩu, mã một lần, hay thông tin",
  "   đăng nhập khác; chỉ ghi rằng người dùng đã nhập thông tin đăng nhập",
  "",
  "Chỉ rõ URL, tiêu đề trang, tên thực thể, và phần tử giao diện đã bấm. Bước nào chưa rõ thì xem lại đoạn ấy.",
  "",
  "## 3. Đối chiếu với bằng chứng từ trình duyệt",
  "",
  "Điểm ảnh của video bỏ lỡ chuỗi chính xác. Bộ ghi của host đã bắt sẵn mọi thao tác trong Chrome của máy bạn cùng",
  "buổi demo — URL đã tới, nút đã bấm (selector + chữ trên nút), ô đã điền (giá trị nhạy cảm đã che ngay lúc ghi) — và",
  'để trong `"$session_dir/actions.md"`. Đọc file đó (`read_file_v2`). Không có file thì không có nhật ký, đừng bịa.',
  "Chỉ đọc: KHÔNG lái Chrome trong lúc dựng lại bài học — không mở trang, không bấm, không chạy script trong trang, không",
  "đọc cookie. Đường này chỉ dùng để dựng lại buổi dạy — không bao giờ dùng lại khi CHẠY skill đã học. Video và nhật",
  "ký khác nhau thì tin nhật ký về URL và tin video về thao tác trong trang.",
  "",
  "## 4. Quyết định skill dùng lại được là gì",
  "",
  "Xác định mục tiêu của quy trình, các bước của nó, và giá trị nào trong demo là INPUT (từ khoá tìm, người nhận,",
  "ngày) so với chi tiết cố định. Bản ghi và ngữ cảnh đã đủ rõ cho một quy trình dùng lại được thì cứ làm — kể cả khi",
  "người dùng không nói rõ là muốn một skill. Nếu chỗ mơ hồ làm ĐỔI HẲN skill (không rõ mục tiêu, không tách được",
  "input khỏi hằng số) thì hỏi người dùng vài câu ngắn bằng văn xuôi rồi dừng chờ trả lời.",
  "",
  "## 5. Viết skill (mặc định là tạo)",
  "",
  "Đừng dừng ở một bản tóm tắt, một kế hoạch chạy lại, hay một lời mời tạo skill. Viết skill bằng:",
  "",
  '`TOOL_CALL: create_workflow({"name":"<tên ngắn, mệnh lệnh>","description":"<một dòng: khi nào dùng>","instructions":"<công thức>"})`',
  "",
  "(Đây KHÁC `create_skill`: `create_skill` ghi một tệp SOP lên đĩa máy bạn và tệp đó nằm trong mọi lượt chat sau đó.",
  "`create_workflow` tạo thứ người dùng gõ `/` để gọi — đúng chỗ một việc đã dạy cần nằm.)",
  "",
  '- name: ngắn và mệnh lệnh ("Đặt hàng tạp hoá trên Amazon")',
  "- description: một dòng nói khi nào áp dụng",
  "- instructions: công thức CHUNG, dùng lại được, theo mục tiêu người dùng (Chrome đã đăng nhập, URL đích, cần báo lại",
  '  gì, xác nhận trước khi thêm vào giỏ/đặt hàng). Tham số hoá input ("tìm {item}"). Ưu tiên đích ổn định (URL, nút và',
  "  ô có nhãn) hơn toạ độ. Ưu tiên connector hay tool MCP hơn thao tác giao diện khi có cái phủ được bước ấy; chỉ dùng",
  "  trình duyệt cho bước không gì khác làm được. Đánh dấu bước có hậu quả (đặt hàng, gửi tin, thanh toán) là phải-hỏi-",
  '  người-dùng-trước. Không bao giờ nhúng thông tin đăng nhập — trạng thái đăng nhập nằm trong hồ sơ trình duyệt, nên',
  '  bước cần đăng nhập viết "giả định đã đăng nhập X". Không mã hoá cơ chế của hệ thống: không cổng CDP, không đoạn',
  '  websocket hay playwright, không "gọi computerUse". Việc thực thi và uỷ thác là của lời nhắc cha.',
  "",
  "## 6. Dọn dẹp và báo lại",
  "",
  "- Khi mọi việc cho bản ghi đã nhận xong, chạy:",
  "",
  "```",
  'rm -f "$video" "$session_dir"/demo_part_*.mp4 "$session_dir"/frame_*.png',
  'exec 9>"$queue_dir/.claim.lock"',
  "flock 9",
  'rm -f "$claim" "$claim_lease"',
  "flock -u 9",
  "```",
  "",
  "Không bao giờ xoá video hay phiếu hàng đợi mà bạn không nhận. Nếu dừng trước khi dọn, để nguyên phiếu đã nhận và",
  "lease; một lượt dạy sau chỉ thử lại nó khi lease hết hạn.",
  "- Gửi bản tóm tắt: các bước đã học thành danh sách đánh số ngắn, giá trị nào là input, giả định quan trọng, và",
  "  link tới skill viết ĐÚNG cú pháp `[Tên skill](sand-workflow:<skill-id>)` — `create_workflow` trả về `<skill-id>`",
  "  cho bạn; ứng dụng biến link đó thành thẻ bấm mở skill, viết sai cú pháp thì chỉ là chữ.",
  "- Mời chạy thử với chính giá trị họ vừa dùng trong demo bằng `ask_question` — một câu hỏi ngắn, hai lựa chọn:",
  "  \"Chạy thử với `nến thơm`\" và \"Để sau\" (widget này chỉ mở được SAU khi `create_workflow` đã chạy; trước đó mọi câu",
  "  hỏi đều bị chặn). KHÔNG BAO GIỜ tự chạy skill vừa học khi chưa được bảo. Chỉ gợi ý đặt lịch (một routine @-gọi",
  "  skill) khi việc trông có tính lặp lại.",
  "",
  "## Thông tin nhạy cảm",
  "",
  "Bản ghi có thể chứa bất cứ thứ gì đã hiện trên màn hình. Coi mật khẩu, mã một lần, khoá API, số tài khoản tài chính",
  "và chi tiết cá nhân riêng tư là nhạy cảm: dùng chỗ giữ chỗ trong bản tóm tắt và trong thân skill. Nếu buổi demo chủ",
  "yếu là nhập thông tin đăng nhập, nói vậy và không tạo skill.",
].join(String.fromCharCode(10));

/**
 * Đảm bảo bot có skill này, ĐÚNG bản hiện hành. Trả về skill — tạo nếu chưa có, sửa nếu bản cũ lệch.
 *
 * Mỗi bot một bản riêng vì kho skill chia theo bot; trùng tên thì dùng lại bản cũ thay vì đẻ thêm (menu `/`
 * sẽ đầy những dòng giống hệt nhau sau vài buổi dạy). `source:"managed"` để client 0.43 vẽ *Managed by Cursor*
 * và không xếp vào menu `/` — đúng như skill này ở app gốc; bản cũ đã lưu `"workflow"` thì nâng lên tại chỗ,
 * và bài học đổi nội dung thì mọi bot đang có skill cũ nhận bản mới ở buổi dạy kế.
 */
export function dungSkillHocTuDemo(agentId: string): Workflow {
  const co = skillCuaBot({ agentId }).find((w) => w.name === TEN_SKILL);
  if (co) {
    if (co.instructions === NOI_DUNG_SKILL && co.description === MO_TA_SKILL && co.source === "managed") return co;
    const ds = suaSkill({ workflowId: co.id, agentId, instructions: NOI_DUNG_SKILL, description: MO_TA_SKILL, source: "managed" });
    return ds.find((w) => w.id === co.id) ?? co;
  }
  const ds = taoSkill({ agentId, name: TEN_SKILL, description: MO_TA_SKILL, instructions: NOI_DUNG_SKILL, source: "managed" });
  return ds.find((w) => w.name === TEN_SKILL) ?? ds[0];
}

/**
 * `create_workflow` — bot tự ghi một skill vào kho.
 *
 * App gốc cho bot làm việc này qua `update_state` với `target:"workflow"`. Bên mình dựng thành một
 * tool riêng vì `update_state` của ta không có nhánh workflow, và thêm một nhánh vào đó chỉ để làm
 * một việc thì khó đọc hơn là một tool gọi đúng tên việc.
 *
 * Nhận cả `instructions` lẫn `content`: `create_skill` (skill trên ĐĨA) dùng `content`, và model sẽ
 * lẫn hai tool này — chúng cùng nghĩa với nó. Nhận cả hai thì lẫn cũng không mất buổi dạy; từ chối
 * vì sai tên trường thì mất.
 */
export function taoWorkflowTuBot(arg: unknown, agentId: string): string {
  const a = (typeof arg === "string" ? {} : (arg ?? {})) as Record<string, unknown>;
  const name = String(a.name ?? "").trim();
  const instructions = String(a.instructions ?? a.content ?? a.body ?? "").trim();
  if (!name || !instructions) {
    return 'create_workflow cần {"name":"tên ngắn","description":"khi nào dùng","instructions":"các bước"}';
  }
  const cu = skillCuaBot({ agentId }).find((w) => w.name === name);
  const ds = cu
    ? undefined
    : taoSkill({ agentId, name, description: String(a.description ?? "").trim(), instructions });
  if (cu) {
    // Trùng tên thì SỬA bản cũ, không đẻ bản thứ hai: menu `/` là danh sách người phải đọc bằng mắt.
    return `Đã có skill "${name}" — dùng update_workflow nếu muốn đổi nội dung, hoặc đặt tên khác.`;
  }
  const w = ds?.find((x) => x.name === name);
  /*
   * Trả cả id lẫn cú pháp link. Renderer 0.43 đọc `sand-workflow:<slug>` → `{kind:"skill",
   * workflowId:<slug>}` → `focusSkillId`, tức slug PHẢI là chính `id` của skill; id của ta
   * (`wf-<base36>-<n>`) khớp regex `/^[a-z0-9]+(?:-[a-z0-9]+)*$/` của họ. Không đưa id ở đây thì bot
   * không có cách nào dẫn skill thành thẻ bấm — hãng kết mọi buổi dạy bằng đúng một thẻ như thế.
   */
  return `Đã lưu skill "${name}" (id: ${w?.id ?? "?"}) — người dùng gõ \`/\` là gọi lại được.`
    + (w ? ` Dẫn nó trong câu trả lời bằng: [${name}](sand-workflow:${w.id})` : "");
}

/**
 * Bàn giao bản ghi cho bot theo ĐÚNG hình dạng tin của hãng, cộng phần chỉ model đọc.
 *
 * `content` là câu hằng — renderer 0.43 vẽ kiểu `teach-recording` khi
 * `clientNonce.startsWith("teach-recording:") && content === CAU_GHI_XONG`, và `turn.ts` bật cờ
 * `luotHocTuBanGhi` (khoá `ask_question`) cũng bằng đúng phép so ấy. Nên phần "tiêm" đi qua `modelNote`
 * — nối vào lượt model, không vào bản ghi — và nó chỉ mang hai thứ như hãng: `Teach recording queue
 * scope` và bài học. KHÔNG có đường dẫn video: bot tự nhận phiếu rồi đọc `session.json` (bước 0).
 *
 * `clientNonce` = `teach-recording:<scope>:<sessionId>.json` — phần cuối chính là tên phiếu trong hàng đợi.
 */
export function banGiaoBaiHoc(p: PhienXong): {
  content: string; clientNonce: string; modelNote: string; richText: string;
} {
  const skill = dungSkillHocTuDemo(p.agentId);
  const scope = scopeCua(p.agentId);
  /*
   * Chip skill dưới câu — chép hình của hãng: doc ProseMirror một paragraph, một node `workflowReference`
   * (renderer: `case"workflowReference"` → pill icon `cube` + label; bấm → `focusSkillId: attrs.id`). Hãng đặt
   * `id:"learn-from-demonstration"` vì skill của họ có id là slug; bên ta id là `wf-…` nên đặt ĐÚNG id của skill
   * học-từ-demo để bấm chip mở đúng skill — label vẫn là chữ hãng dùng. Pill tự đổi label sang `name` của skill
   * nếu tìm thấy id trong kho.
   */
  const richText = JSON.stringify({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "workflowReference", attrs: { id: skill.id, label: "Learn from demonstration", teachQueueScope: scope } }] }],
  });
  const ghiChu = [
    `Teach recording queue scope: ${scope}`,
    `(Hàng đợi nằm dưới thư mục làm việc: \`${THU_MUC_PHIEN}/queues/${scope}\`. run_terminal_command_v2 đứng sẵn ở gốc làm việc — đừng cd đi đâu; mọi đường dẫn tuyệt đối trong session.json đều nằm dưới gốc ấy.)`,
    "",
    `Làm theo skill "${TEN_SKILL}" dưới đây:`,
    "",
    skill.instructions,
  ].join(String.fromCharCode(10));
  return { content: CAU_GHI_XONG, clientNonce: `teach-recording:${scope}:${p.sessionId}.json`, modelNote: ghiChu, richText };
}

/**
 * Bản ghi vừa xong: dựng sẵn skill học-từ-demo rồi trả về TIN sẽ gửi cho bot (đường cũ, khi không có chip).
 *
 * Câu mở đầu chép nguyên văn app gốc, rồi `@learn-from-demonstration` là cách bên mình gọi skill
 * (client gốc đính một chip; `@tên` đi vào đúng đường `skillDuocGoi` và cho cùng kết quả).
 */
export function tinGiaoBaiHoc(agentId: string, videoPath: string, giay: number): string {
  dungSkillHocTuDemo(agentId);
  return [
    CAU_GHI_XONG,
    "",
    `@${TEN_SKILL}`,
    "",
    `Video: \`${videoPath}\` (${giay} giây, trên máy tính của bạn).`,
  ].join(String.fromCharCode(10));
}
