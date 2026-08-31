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
import { boxCall, boxConfigured } from "./box-exec.js";
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
   * `-nostdin` là thứ đã cứu một lần: ffmpeg chạy nền mà còn đọc stdin sẽ nuốt phím của tiến trình
   * khác và tự dừng giữa chừng. `setsid` để nó sống qua lệnh exec này.
   */
  const lenh = `mkdir -p ${thuMuc} && cd ${thuMuc} && DISPLAY=:77 setsid ffmpeg -nostdin -y `
    + `-f x11grab -framerate 10 -i :77 -c:v libx264 -preset ultrafast -pix_fmt yuv420p `
    + `demo.mp4 > ffmpeg.log 2>&1 < /dev/null & sleep 2; pgrep -f "x11grab" | head -1`;
  const r = await sh(lenh, 40_000);
  if (!r.stdout.trim()) return { ok: false, lyDo: "ffmpeg không lên — xem ffmpeg.log trong thư mục phiên" };

  phien = { agentId, thuMuc, videoPath, batDauMs: Date.now() };
  console.log(`[grokbot2] [teach-video] bắt đầu quay cho ${agentId} → ${videoPath}`);
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

  await sh(`pkill -INT -f x11grab || true`, 20_000);
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
  const tuongDoi = p.videoPath.replace("$HOME/workspace/", "");
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
  "để gọi lại. Đừng tự chạy nó khi chưa ai nhờ.",
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
  return `Đã lưu skill "${name}"${w ? "" : ""} — người dùng gõ \`/\` là gọi lại được.`;
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
