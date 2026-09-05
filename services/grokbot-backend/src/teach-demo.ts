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
 * File này là nửa hạ tầng của đường đó: quay mp4, và dựng sẵn skill để bot có cái mà chạy.
 *
 * ── Không thay hai bộ ghi cũ ────────────────────────────────────────────────────────────────────
 *
 * Ba cách trả lời ba tình huống khác nhau, nên cả ba cùng sống: việc nằm gọn trong một trang web
 * thì `teach.ts` cho bài học bền nhất (selector sống lâu hơn toạ độ); việc rải khắp desktop thì
 * `desktop-record.ts`; còn việc cần HIỂU chứ không chỉ lặp lại thì đường video này.
 */
import { createHash, randomUUID } from "node:crypto";
import { boxCall, boxConfigured } from "./box-exec.js";
import { displayOf } from "./displays.js";
import { create as taoSkill, forAgent as skillCuaBot, type Workflow } from "./workflows.js";

/** Tên skill — trùng id app gốc dùng, để bản ghi của ta đọc được cạnh transcript của họ. */
export const TEN_SKILL = "learn-from-demonstration";

/** Câu client gốc gửi cho bot khi bản ghi xong. Chép nguyên văn từ bundle. */
export const CAU_GHI_XONG = "The recording is finished. Learn the task from it.";

/** Một phiên quay đang chạy. Chỉ một phiên mỗi lúc — hai bộ ghi cùng chạy là ghi đúp mọi thứ. */
interface PhienQuay {
  agentId: string;
  thuMuc: string;
  videoPath: string;
  batDauMs: number;
  /** PID của ffmpeg trên box — để dừng ĐÚNG nó, không dò lại bằng tên. */
  pid: number;
}
let phien: PhienQuay | null = null;

/** Mười phút, bằng đúng hạn của hai bộ ghi kia — dài hơn thì không ai ngồi dạy hết. */
const TOI_DA_MS = 600_000;

const sh = async (command: string, timeoutMs = 30_000): Promise<{ stdout: string; exitCode: number }> => {
  const r = await boxCall<{ stdout?: string; exitCode?: number }>("exec", { command, timeoutMs });
  return { stdout: String(r?.stdout ?? ""), exitCode: Number(r?.exitCode ?? 0) };
};

/**
 * Bắt đầu quay màn hình box.
 *
 * `x11grab` đọc thẳng từ `DISPLAY=:77` — cùng màn hình mà pane VNC của client đang chiếu, nên thứ
 * quay được đúng bằng thứ người dùng nhìn thấy khi họ demo.
 *
 * `-preset ultrafast` là cố ý: box không có GPU (đo được — VAAPI mở `/dev/dri/renderD128` thất bại,
 * không có `libnvidia-encode`), nên mọi giây encode đều ăn CPU của chính con bot đang làm việc.
 * Chất lượng chỉ cần đủ để một model đọc được chữ trên màn hình.
 */
export async function batDauQuayDemo(agentId: string): Promise<{ ok: boolean; lyDo?: string }> {
  if (!boxConfigured()) return { ok: false, lyDo: "chưa nối box" };
  if (phien) return { ok: false, lyDo: `đang quay cho ${phien.agentId} rồi` };

  const id = `teach-${Date.now().toString(36)}`;
  const thuMuc = `$HOME/workspace/teach/${id}`;
  const videoPath = `${thuMuc}/demo.mp4`;
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
   */
  /*
   * `-video_size` LẤY TỪ MÀN HÌNH, không để ffmpeg tự đoán.
   *
   * Bỏ nó ra thì x11grab mặc định 640x480 và quay đúng một góc trên-trái. Đo bằng lượt thật 01/09:
   * bot xem video xong báo lại "121 giây, 640x480, bitrate 16 kb/s, cả 6 khung hình y hệt nhau" —
   * trong khi màn hình box là 1920x1080 và người làm mẫu thao tác ở giữa màn hình. Video có, dung
   * lượng có, và không chứa buổi demo.
   *
   * Đọc `xdpyinfo` mỗi lần thay vì đóng cứng 1920x1080: box khác có thể dựng Xvfb kích thước khác,
   * và một con số đóng cứng sai thì lại ra đúng loại video rỗng ruột này.
   */
  /*
   * `setsid -f ffmpeg … > ffmpeg.log 2>&1 < /dev/null` — KHÔNG `&`, không subshell.
   *
   * Bản trước: `A && B && setsid ffmpeg … > log 2>&1 &`. Lệnh "bật quay" trả về sau đúng `timeoutMs` (40 s) và ffmpeg
   * bị hạ theo — nên bốn lượt đo đầu 06/09 video nào cũng dài đúng 40 s và tin bàn giao tới 38 s sau Stop; `demo_start`
   * của bot (01/09) cũng đã chịu 40 s ấy mà không ai đo. Đo từng dạng qua router với `timeoutMs` 12 s: `A && ffmpeg &`
   * 12,2 s · `( exec setsid ffmpeg x11grab ) > log 2>&1 &` 12,2 s · cùng dạng với `sleep` 12,2 s nhưng với ffmpeg
   * lavfi 1,2 s (không lý giải được, và không cần) · **`setsid -f ffmpeg … > log 2>&1 < /dev/null` 1,2 s**. `execFile`
   * của daemon chờ mọi kẻ giữ ống stdout thoát; `-f` để `setsid` tự fork rồi trả shell về ngay, và tiến trình con
   * chỉ còn ba fd đã chuyển hướng. Một con số tròn trùng hằng `40_000` là dấu tay của timeout — đọc nó trước.
   *
   * `pgrep -u "$(id -un)" -n -f "[x]11grab"`: (1) `[x]` để không khớp chính dòng lệnh shell này (bẫy `pgrep -af` tự
   * đếm mình, §7); (2) `-u` vì box dùng chung — một lượt đo bắt được x11grab của user KHÁC và `kill` trả EPERM;
   * (3) `-n` lấy cái mới nhất, là cái vừa bật.
   */
  const lenh = `mkdir -p ${thuMuc} && cd ${thuMuc} && `
    + `SZ=$(DISPLAY=${display} xdpyinfo 2>/dev/null | awk '/dimensions:/{print $2}'); SZ=\${SZ:-1920x1080}; `
    + `DISPLAY=${display} setsid -f ffmpeg -nostdin -y -f x11grab -framerate 10 -video_size $SZ -i ${display} `
    + `-c:v libx264 -preset ultrafast -pix_fmt yuv420p demo.mp4 > ffmpeg.log 2>&1 < /dev/null; `
    + `sleep 2; pgrep -u "$(id -un)" -n -f "[x]11grab"`;
  const r = await sh(lenh, 40_000);
  const pid = Number(r.stdout.trim());
  if (!pid) return { ok: false, lyDo: "ffmpeg không lên — xem ffmpeg.log trong thư mục phiên" };

  phien = { agentId, thuMuc, videoPath, batDauMs: Date.now(), pid };
  console.log(`[grokbot2] [teach-video] bắt đầu quay cho ${agentId} (${display}) → ${videoPath}`);
  return { ok: true };
}

/**
 * Dừng quay và trả đường dẫn video, tính theo GỐC LÀM VIỆC.
 *
 * Gửi `SIGINT`, không `SIGKILL`: ffmpeg cần tín hiệu đó để ghi nốt `moov atom` và đóng mp4. Giết
 * thô thì file vẫn có, dung lượng vẫn có, mà `ffprobe` báo "moov atom not found" — đúng cái bẫy đã
 * trả giá với OBS. Rồi chờ kích thước ổn định, vì `kill` trả về ngay còn ffmpeg thì chưa xong.
 */
export async function dungQuayDemo(): Promise<{ videoPath: string; giay: number } | null> {
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
  // Đường TƯƠNG ĐỐI gốc làm việc: `watch_video` chặn đường ngoài gốc, và bot đã một lần phải tự
  // copy file lòng vòng vì chuyện đó.
  /*
   * Trả đường dẫn ĐÃ BỎ `$HOME` — chuỗi đó chưa được shell nở khi nó nằm trong biến của Node.
   *
   * Đo 01/09: bot nhận đường dẫn còn nguyên `$HOME/workspace/teach/…`, `watch_video` không mở được,
   * và nó phải tự đi dò ("Thư mục không nằm ở $HOME, mình tìm lại đường dẫn thật"). Nó tìm ra, nhưng
   * đó là một vòng lãng phí cho một chuỗi lẽ ra phải sạch ngay từ đây.
   */
  const tuongDoi = p.videoPath.replace(/^\$HOME\/workspace\//, "");
  console.log(`[grokbot2] [teach-video] dừng: ${tuongDoi}, ${giay}s`);
  return { videoPath: tuongDoi, giay };
}

export const dangQuayDemo = (): boolean => phien !== null;
export const hanQuayDemoMs = TOI_DA_MS;

/**
 * Bài giao cho bot khi bản ghi xong.
 *
 * Viết theo skill `learn-from-demonstration` của app gốc, nhưng CẮT hết phần cơ chế của họ: hàng
 * đợi `teach-sessions/queues`, `flock`, lease 12 giờ, `ffmpegPid` — đó là hạ tầng của host bên họ,
 * và bên mình host đã đưa thẳng đường dẫn video cho bot rồi. Bê nguyên vào chỉ dạy model gọi những
 * lệnh không tồn tại ở đây.
 *
 * Giữ lại phần THẬT SỰ là bài học, và mỗi mục dưới đây đều chống một cách hỏng đã biết:
 *   · xem hai khung hình trước → bản ghi trắng thì biết ngay, khỏi tốn một lượt đọc cả video;
 *   · phân biệt INPUT với hằng số → không có nó thì skill chỉ chạy lại đúng một lần duy nhất ấy;
 *   · bám URL và nhãn thay vì toạ độ → toạ độ là thứ làm hai bộ ghi cũ giòn;
 *   · không chép mật khẩu/OTP vào skill → bản ghi màn hình thấy mọi thứ trên đó.
 */
export const NOI_DUNG_SKILL = [
  "# Học từ một buổi demo",
  "",
  "Người dùng vừa quay màn hình để chỉ bạn làm một việc. Biến buổi demo đó thành một skill dùng lại được.",
  "",
  "## 1. Xem thử trước khi xem hết",
  "",
  "Cắt hai khung hình rồi NHÌN chúng:",
  "",
  '`TOOL_CALL: run_terminal_command_v2({"command":"ffmpeg -y -ss <20% thời lượng> -i <video> -frames:v 1 /tmp/a.png"})`',
  "",
  "Nếu chúng chỉ là màn hình trống hoặc sai cửa sổ thì bản ghi hỏng: nói thẳng với người dùng và mời quay lại,",
  "đừng đọc hết video rồi mới phát hiện.",
  "",
  "## 2. Xem cả video",
  "",
  '`TOOL_CALL: watch_video({"path":"<đường dẫn tương đối>"})` — hỏi nó: bắt đầu ở trang nào, những',
  "thao tác nào theo thứ tự (bấm gì, gõ gì, đi tới đâu), kết thúc ở đâu. Chép chính xác chuỗi đã gõ,",
  "TRỪ mật khẩu, mã OTP, số thẻ — với chúng chỉ ghi 'người dùng nhập thông tin đăng nhập'.",
  "",
  "## 3. Tách INPUT khỏi phần cố định",
  "",
  "Cái gì sẽ đổi ở lần chạy sau (từ khoá tìm, tên người nhận, ngày) là INPUT; cái gì luôn giống",
  "(địa chỉ trang, tên nút) là phần cố định. Không tách thì skill chỉ lặp lại đúng một lần demo ấy.",
  "",
  "## 4. Ghi thành skill",
  "",
  '`TOOL_CALL: create_workflow({"name":"<tên ngắn, mệnh lệnh>","description":"<một dòng: khi nào dùng>","instructions":"<các bước>"})`',
  "",
  "(Đây KHÁC `create_skill`: `create_skill` ghi một tệp SOP lên đĩa máy bạn và tệp đó nằm trong mọi",
  "lượt chat sau đó. `create_workflow` tạo thứ người dùng gõ `/` để gọi — đúng chỗ một việc đã dạy",
  "cần nằm.)",
  "",
  "Viết các bước theo MỤC TIÊU, không theo toạ độ: bám địa chỉ trang và nhãn nút, vì cửa sổ dịch chỗ",
  "thì toạ độ hỏng còn nhãn thì không. Bước nào có hậu quả (đặt hàng, gửi tin, thanh toán) thì ghi rõ",
  "là phải hỏi người dùng trước. Đừng nhúng mật khẩu — viết 'giả định đã đăng nhập sẵn'.",
  "",
  "## 5. Báo lại",
  "",
  "Tóm tắt các bước đã học thành danh sách ngắn, nói rõ cái nào là INPUT, và nhắc người dùng gõ `/`",
  "để gọi lại.",
  "",
  "Dẫn skill vừa tạo bằng ĐÚNG cú pháp `[Tên skill](sand-workflow:<id>)` — `create_workflow` trả về",
  "`<id>` cho bạn. Ứng dụng biến link đó thành thẻ bấm mở skill; viết sai cú pháp thì chỉ là chữ.",
  "",
  "Nếu bài giao kèm 'nhật ký thao tác trình duyệt', dùng nó để khớp từng bước với video (nó ghi đúng",
  "URL và nhãn nút đã bấm) — video cho biết Ý ĐỊNH, nhật ký cho biết CHÍNH XÁC đã bấm gì.",
  "",
  "Rồi MỜI chạy thử, với chính giá trị họ vừa dùng trong demo — một câu, không widget:",
  '"Muốn chạy thử với `nến thơm` không?" App gốc kết đúng như vậy.',
  "",
  "Mời thôi, đừng tự chạy: bài học vừa viết ra chưa ai kiểm, và một skill sai chạy ngay lần đầu thì",
  "hỏng việc trước khi người dùng kịp đọc nó.",
].join(String.fromCharCode(10));

/**
 * Đảm bảo bot có skill này. Trả về skill — tạo nếu chưa có.
 *
 * Mỗi bot một bản riêng vì kho skill chia theo bot; trùng tên thì dùng lại bản cũ thay vì đẻ thêm,
 * nếu không menu `/` sẽ đầy những dòng giống hệt nhau sau vài buổi dạy.
 */
export function dungSkillHocTuDemo(agentId: string): Workflow {
  const co = skillCuaBot({ agentId }).find((w) => w.name === TEN_SKILL);
  if (co) return co;
  const ds = taoSkill({
    agentId,
    name: TEN_SKILL,
    description: "Biến một buổi quay màn hình thành skill dùng lại được",
    instructions: NOI_DUNG_SKILL,
  });
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
 * `luotHocTuBanGhi` (khoá `ask_question`) cũng bằng đúng phép so ấy. Nên đường dẫn video và nhật ký
 * thao tác đi qua `modelNote` — nối vào lượt model, không vào bản ghi.
 *
 * `teachQueueScope` của hãng là sha256 (0 lần trong bundle ⇒ host tự sinh); ta băm `agentId` +
 * đường video — đủ để hai buổi dạy khác nhau không trùng nonce.
 */
export function banGiaoBaiHoc(agentId: string, videoPath: string, giay: number, nhatKyCdp?: string): {
  content: string; clientNonce: string; modelNote: string; richText: string;
} {
  const skill = dungSkillHocTuDemo(agentId);
  const scope = createHash("sha256").update(`${agentId}:${videoPath}`).digest("hex");
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
  // Dạng của hãng: `teach-20260905T040542Z-<uuid>.json` — ISO bỏ `-` `:` và phần lẻ giây.
  const tep = `teach-${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")}-${randomUUID()}.json`;
  const ghiChu = [
    // Nói rõ gốc của đường dẫn: lượt đo 06/09 bot `cd "$HOME"` rồi `ls teach/…` và trượt một vòng trước khi tự tìm ra.
    `Video: \`${videoPath}\` (${giay} giây, trên máy tính của bạn — đường dẫn tương đối THƯ MỤC LÀM VIỆC, tức nơi run_terminal_command_v2 đứng sẵn; đừng cd đi đâu).`,
    "",
    `Làm theo skill "${TEN_SKILL}" dưới đây:`,
    "",
    skill.instructions,
    ...(nhatKyCdp?.trim()
      ? ["", "## Nhật ký thao tác trình duyệt (bộ ghi tự bắt, cùng buổi demo)", "", nhatKyCdp.trim()]
      : []),
  ].join(String.fromCharCode(10));
  return { content: CAU_GHI_XONG, clientNonce: `teach-recording:${scope}:${tep}`, modelNote: ghiChu, richText };
}

/**
 * Bản ghi vừa xong: dựng sẵn skill học-từ-demo rồi trả về TIN sẽ gửi cho bot.
 *
 * Trả chuỗi thay vì tự gửi, để chỗ gọi quyết định gửi lúc nào — `sendPrompt` nằm trong `turn.ts`,
 * mà file này đã bị `turn.ts` phụ thuộc gián tiếp qua `workflows.ts`; gọi ngược lên là một vòng.
 *
 * Câu mở đầu chép nguyên văn app gốc, rồi `@learn-from-demonstration` là cách bên mình gọi skill
 * (client gốc đính một chip; ta không dựng được chip từ backend, nhưng `@tên` đi vào đúng đường
 * `skillDuocGoi` và cho cùng kết quả).
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
