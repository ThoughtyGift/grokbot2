/**
 * Ghi lại thao tác trên desktop của box — giai đoạn 2 của docs/plan/desktop-computer-use.md.
 *
 * Khác `teach.ts` ở chỗ căn bản, và khác theo hướng tệ hơn: trong trình duyệt một cú bấm để lại
 * `#article_title`, ngoài desktop nó chỉ để lại `(742, 318)`. Toạ độ trần thì vỡ ngay khi cửa sổ
 * dịch chỗ hay một thông báo nhảy ra — nên mỗi cú bấm được **cắt kèm một mẩu ảnh** quanh điểm bấm.
 * Mẩu ảnh đó mới là thứ tìm lại được ở lần chạy sau; toạ độ chỉ còn là gợi ý nơi bắt đầu tìm.
 *
 * Bắt sự kiện bằng XRecord (`Xlib.ext.record`) — cùng đường mà `xev`/`xdotool` dùng, và đã đo là
 * có sẵn trên box. XRecord thấy cả input do XTEST bơm vào, nghĩa là hành động của chính bot cũng
 * lọt vào bản ghi; điều đó không sao khi đang dạy việc, và lại là cách e2e tự lái được bản ghi.
 */
import { createHash } from "node:crypto";
import { boxCall, boxConfigured } from "./box-exec.js";
import { sq, boxRoot } from "./desktop.js";
import { callPool } from "@grokbot2/pool-client";
import { config, loadPoolKey } from "./config.js";
import { automationCreateRef } from "./chat/state.js";
import { screenInfo } from "./desktop.js";

/** Một bước đã ghi. `crop` là tên file mẩu ảnh trong thư mục phiên, chỉ có ở bước bấm. */
export interface DesktopStep {
  act: "click" | "type" | "key" | "scroll";
  t: number;
  x?: number;
  y?: number;
  button?: number;
  dy?: number;
  text?: string;
  key?: string;
  crop?: string;
  /** Mô tả bằng lời của mẩu ảnh, điền sau bằng model thị giác. Xem `describeCrops`. */
  looks?: string;
}

export interface DesktopRecordingState {
  state: "idle" | "recording";
  agentId: string | null;
  startedAtMs: number | null;
  maxDurationMs: number;
}

/** Mười phút, bằng đúng bản ghi trình duyệt — dài hơn thì không ai ngồi dạy hết. */
const MAX_MS = 600_000;
const MAX_STEPS = 300;

export const IDLE: DesktopRecordingState = { state: "idle", agentId: null, startedAtMs: null, maxDurationMs: MAX_MS };

/**
 * Bộ ghi chạy trên box.
 *
 * Một tiến trình nền, viết từng dòng JSON ra file ngay khi sự kiện xảy ra rồi flush. Viết ngay là
 * cố ý: dừng bản ghi = giết tiến trình, và một bộ đệm chưa flush lúc đó là mất trắng buổi dạy.
 *
 * Phím gõ được gom thành một bước `type` thay vì mỗi ký tự một bước. Ba mươi bước "gõ chữ n" thì
 * không ai đọc nổi routine, mà cũng chẳng nói lên điều gì.
 */
const RECORDER = String.raw`
import sys, os, json, time, threading

OUTDIR = sys.argv[1]
MAX_SEC = float(sys.argv[2]) if len(sys.argv) > 2 else 600.0
MAX_STEPS = int(sys.argv[3]) if len(sys.argv) > 3 else 300

from Xlib import display, X, XK
from Xlib.ext import record
from Xlib.protocol import rq
from PIL import Image

local = display.Display()      # de doc man hinh + tra keysym
rec = display.Display()        # XRecord doi mot ket noi rieng
root = local.screen().root
SW = local.screen().width_in_pixels
SH = local.screen().height_in_pixels

steps = open(os.path.join(OUTDIR, "steps.jsonl"), "a", buffering=1)
with open(os.path.join(OUTDIR, "meta.json"), "w") as f:
    json.dump({"screenW": SW, "screenH": SH, "startedAt": int(time.time() * 1000)}, f)

n = [0]
buf = []          # ky tu dang gom lai thanh mot buoc "type"
shift = [False]
t0 = time.time()

def ms():
    return int((time.time() - t0) * 1000)

def emit(d):
    if n[0] >= MAX_STEPS:
        return
    n[0] += 1
    d["t"] = ms()
    steps.write(json.dumps(d) + "\n")

def flush_text():
    if buf:
        emit({"act": "type", "text": "".join(buf)})
        del buf[:]

# Mau anh quanh diem bam. Day moi la thu tim lai duoc o lan chay sau — toa do tran thi khong.
CROP_W, CROP_H = 320, 200

def crop_at(x, y):
    left = max(0, min(SW - CROP_W, x - CROP_W // 2))
    top = max(0, min(SH - CROP_H, y - CROP_H // 2))
    try:
        raw = root.get_image(left, top, CROP_W, CROP_H, X.ZPixmap, 0xffffffff)
        img = Image.frombytes("RGB", (CROP_W, CROP_H), raw.data, "raw", "BGRX")
        name = "%03d.jpg" % n[0]
        img.save(os.path.join(OUTDIR, name), format="JPEG", quality=80)
        return name, left, top
    except Exception:
        return None, left, top

PRINTABLE_SKIP = set(["Shift_L", "Shift_R", "Control_L", "Control_R", "Alt_L", "Alt_R",
                      "Super_L", "Super_R", "Caps_Lock", "ISO_Level3_Shift"])

# Ten phim tra nguoc tu keysym. Khong dung keysym_to_string cho phim dieu khien: no tra ve chinh
# ky tu dieu khien (Return thanh mot ky tu do dai 1), nen bo ghi dau tien nuot phim Enter vao
# giua chuoi chu thay vi ghi no thanh mot buoc rieng.
KEYSYM_NAME = {}
for _k, _v in vars(XK).items():
    if _k.startswith("XK_") and isinstance(_v, int) and _v not in KEYSYM_NAME:
        KEYSYM_NAME[_v] = _k[3:]

def key_name(code):
    ks = local.keycode_to_keysym(code, 1 if shift[0] else 0)
    if ks == 0:
        ks = local.keycode_to_keysym(code, 0)
    ch = XK.keysym_to_string(ks)
    # Chi coi la "chu go duoc" khi no thuc su in ra duoc.
    if ch and len(ch) == 1 and ord(ch) >= 32 and ord(ch) != 127:
        return ch, ks
    return KEYSYM_NAME.get(ks), ks

def handler(reply):
    if reply.category != record.FromServer or reply.client_swapped or not len(reply.data) or reply.data[0] < 2:
        return
    data = reply.data
    while len(data):
        ev, data = rq.EventField(None).parse_binary_value(data, rec.display, None, None)
        if ev.type == X.ButtonPress:
            b = ev.detail
            if b in (4, 5):
                flush_text()
                emit({"act": "scroll", "x": ev.root_x, "y": ev.root_y, "dy": -3 if b == 4 else 3})
                continue
            flush_text()
            # Cat anh TRUOC khi ghi buoc, de mau anh la thu nguoi dung dang nhin luc bam.
            name, left, top = crop_at(ev.root_x, ev.root_y)
            emit({"act": "click", "x": ev.root_x, "y": ev.root_y, "button": b,
                  "crop": name, "cropLeft": left, "cropTop": top})
        elif ev.type == X.KeyPress:
            nm, ks = key_name(ev.detail)
            if nm in ("Shift_L", "Shift_R"):
                shift[0] = True
                continue
            if nm in PRINTABLE_SKIP:
                continue
            if nm == "space":
                buf.append(" ")
                continue
            if nm and len(nm) == 1:
                buf.append(nm)
                continue
            flush_text()
            emit({"act": "key", "key": nm or ("keysym-%d" % ks)})
        elif ev.type == X.KeyRelease:
            nm, _ = key_name(ev.detail)
            if nm in ("Shift_L", "Shift_R"):
                shift[0] = False

ctx = rec.record_create_context(0, [record.AllClients], [{
    "core_requests": (0, 0), "core_replies": (0, 0),
    "ext_requests": (0, 0, 0, 0), "ext_replies": (0, 0, 0, 0),
    "delivered_events": (0, 0), "device_events": (X.KeyPress, X.MotionNotify),
    "errors": (0, 0), "client_started": False, "client_died": False,
}])

def stopper():
    time.sleep(MAX_SEC)
    try:
        local.record_disable_context(ctx)
        local.flush()
    except Exception:
        pass

threading.Thread(target=stopper, daemon=True).start()
with open(os.path.join(OUTDIR, "pid"), "w") as f:
    f.write(str(os.getpid()))
try:
    rec.record_enable_context(ctx, handler)
finally:
    flush_text()
    steps.flush()
    try:
        rec.record_free_context(ctx)
    except Exception:
        pass
`;

const HASH = createHash("sha256").update(RECORDER).digest("hex").slice(0, 12);
const REMOTE = `/tmp/grokbot2/recorder-${HASH}.py`;
let deployed = false;

interface ExecResult { stdout?: string; stderr?: string; exitCode?: number }

async function ensureRecorder(): Promise<void> {
  if (deployed) return;
  const check = await boxCall<ExecResult>("exec", { command: `test -f ${REMOTE} && echo yes || echo no` });
  if (String(check.stdout ?? "").trim() !== "yes") {
    const b64 = Buffer.from(RECORDER, "utf8").toString("base64");
    const wrote = await boxCall<ExecResult>("exec", {
      command: `mkdir -p /tmp/grokbot2 && printf %s ${sq(b64)} | base64 -d > ${REMOTE} && echo ok`,
    });
    if (String(wrote.stdout ?? "").trim() !== "ok") {
      throw new Error(`không đẩy được bộ ghi lên box: ${String(wrote.stderr ?? "").slice(0, 200)}`);
    }
    console.log(`[grokbot2] [desktop] bộ ghi ${HASH} đã lên box`);
  }
  deployed = true;
}

/**
 * Một phiên ghi tại một thời điểm.
 *
 * Không phải giới hạn kỹ thuật mà là điều đúng: hai người cùng dạy trên MỘT màn hình thì bản ghi
 * nào cũng lẫn thao tác của người kia, và bản ghi lẫn thì tệ hơn không có.
 */
let current: { agentId: string; dir: string; startedAtMs: number } | null = null;

export const desktopRecordConfigured = (): boolean => boxConfigured();

export const desktopRecordingState = (): DesktopRecordingState =>
  current
    ? { state: "recording", agentId: current.agentId, startedAtMs: current.startedAtMs, maxDurationMs: MAX_MS }
    : IDLE;

export async function startDesktopRecording(agentId: string): Promise<DesktopRecordingState> {
  if (current) return desktopRecordingState();
  await ensureRecorder();
  const dir = `${await boxRoot()}/.grokbot2-teach/${Date.now()}`;
  // nohup + setsid: phiên ghi phải sống lâu hơn lệnh exec đã đẻ ra nó, nếu không nó chết ngay khi
  // shell thoát và bản ghi rỗng — mà rỗng thì không có lỗi nào để đọc.
  //
  // Dấu `;` trước `&`, KHÔNG phải `&&`. Với `A && B &` shell tách một subshell cho cả nhóm, và
  // subshell đó vẫn giữ ống stdout của daemon dù B đã tự chuyển hướng — nên daemon ngồi chờ tới
  // khi bản ghi kết thúc. Đo được: 60 giây mỗi lần bấm "bắt đầu ghi", đúng bằng thời hạn của
  // phiên. Với `;` chỉ mỗi lệnh nền được tách, và lệnh trả về sau ~250ms.
  await boxCall<ExecResult>("exec", {
    command: `mkdir -p ${sq(dir)}; nohup setsid python3 ${REMOTE} ${sq(dir)} ${MAX_MS / 1000} ${MAX_STEPS} > ${sq(`${dir}/log`)} 2>&1 < /dev/null & echo started`,
  });
  current = { agentId, dir, startedAtMs: Date.now() };
  return desktopRecordingState();
}

/** Dừng và đọc về những bước đã ghi. Trả về mảng rỗng nếu không ghi được gì. */
export async function stopDesktopRecording(): Promise<{ steps: DesktopStep[]; dir: string; agentId: string } | null> {
  const s = current;
  current = null;
  if (!s) return null;
  await boxCall<ExecResult>("exec", { command: `kill $(cat ${sq(`${s.dir}/pid`)}) 2>/dev/null; sleep 0.4; echo done` });
  const steps = await readSteps(s.dir);
  return { steps, dir: s.dir, agentId: s.agentId };
}

async function readSteps(dir: string): Promise<DesktopStep[]> {
  const file = `${dir}/steps.jsonl`;
  const size = await boxCall<ExecResult>("exec", { command: `stat -c %s ${sq(file)} 2>/dev/null || echo 0` });
  const bytes = Number(String(size.stdout ?? "0").trim()) || 0;
  if (bytes === 0) return [];
  const r = await boxCall<{ bytesBase64?: string }>("readBytes", { target_file: file, offset: 0, length: bytes });
  const text = Buffer.from(String(r.bytesBase64 ?? ""), "base64").toString("utf8");
  const out: DesktopStep[] = [];
  for (const line of text.split("\n")) {
    const l = line.trim();
    if (!l) continue;
    try { out.push(JSON.parse(l) as DesktopStep); } catch { /* dòng cụt vì bị giết giữa chừng */ }
  }
  return out;
}

/** Đọc một mẩu ảnh về dạng data URL, để đưa cho model thị giác mô tả. */
export async function readCrop(dir: string, name: string): Promise<string | null> {
  try {
    const r = await boxCall<{ bytesBase64?: string }>("readBytes", {
      target_file: `${dir}/${name}`, offset: 0, length: 2_000_000,
    });
    const b64 = String(r.bytesBase64 ?? "");
    return b64 ? `data:image/jpeg;base64,${b64}` : null;
  } catch { return null; }
}

/**
 * Đổi mỗi mẩu ảnh thành một câu mô tả, ngay lúc dạy xong.
 *
 * Đây là chỗ then chốt của cả giai đoạn 2, và lý do nó phải làm ở đây chứ không để lúc chạy lại:
 * pool chỉ mang được MỘT ảnh mỗi lượt. Một routine tám bước có tám mẩu ảnh, nên không có cách nào
 * vừa đưa "ảnh cái nút cần tìm" vừa đưa "ảnh màn hình bây giờ" cho model trong cùng một lượt.
 *
 * Đổi pixel thành lời một lần, tại đây, thì lúc chạy lại chỉ cần một tấm ảnh màn hình thật — và
 * lời mô tả sống sót qua cả những thứ toạ độ không sống sót nổi: cửa sổ dịch chỗ, đổi độ phân giải,
 * một thông báo nhảy ra chen ngang.
 *
 * Không tả được thì bỏ trống chứ không bịa: một mô tả sai còn tệ hơn không có mô tả, vì bước chạy
 * lại sẽ tự tin bấm nhầm chỗ.
 */
export async function describeCrops(
  dir: string,
  steps: DesktopStep[],
  pool: { url: string; key: string; model?: string },
  limit = 20,
): Promise<DesktopStep[]> {
  const out = steps.map((s) => ({ ...s }));
  let done = 0;
  for (const s of out) {
    if (!s.crop || done >= limit) continue;
    const img = await readCrop(dir, s.crop);
    if (!img) continue;
    done++;
    const r = await callPool(
      [{
        role: "user",
        content:
          "Đây là một mẩu ảnh cắt từ màn hình máy tính, và người dùng vừa bấm chuột vào ĐÚNG ĐIỂM GIỮA của mẩu ảnh. "
          + "Hãy tả phần tử ở điểm giữa đó trong MỘT câu ngắn, để người khác nhìn màn hình có thể tìm lại được nó: "
          + "loại phần tử (nút, ô nhập, tab, biểu tượng, dòng danh sách), chữ trên nó nếu đọc được, màu, và vị trí "
          + "tương đối. Nếu không nhìn rõ, trả lời đúng hai chữ: không rõ.",
      }],
      { url: pool.url, key: pool.key, model: pool.model, image: img, maxTokens: 200 },
    );
    const text = (r.text ?? "").trim().replace(/\s+/g, " ");
    if (r.ok && text && !/^không rõ\.?$/i.test(text)) s.looks = text.slice(0, 200);
  }
  return out;
}

/**
 * Bản ghi thành lời dặn cho bot chạy lại.
 *
 * Viết cho một tác nhân **nhìn màn hình rồi mới bấm**, không phải cho một bộ phát lại toạ độ. Toạ độ
 * cũ vẫn được nêu, nhưng nêu như một gợi ý nơi bắt đầu tìm — vì đó đúng là giá trị của nó. Cảnh báo
 * trong docs/plan/desktop-computer-use.md nói thẳng điều này: dạy trên desktop yếu hơn dạy trong
 * trình duyệt, và chỗ yếu nằm ở chính chỗ toạ độ được tin tưởng.
 */
export function desktopStepsToPrompt(steps: DesktopStep[], screen?: { width: number; height: number }): string {
  const lines: string[] = [];
  let n = 0;
  for (const s of steps) {
    if (s.act === "click") {
      const where = s.x != null && s.y != null ? ` — lúc dạy nó ở khoảng (${s.x}, ${s.y})` : "";
      const what = s.looks ? `"${s.looks}"` : "phần tử ở vị trí đó (không có mô tả — hãy nhìn kỹ màn hình trước khi bấm)";
      lines.push(`${++n}. bấm vào ${what}${where}`);
      continue;
    }
    if (s.act === "type" && s.text) { lines.push(`${++n}. gõ "${s.text}"`); continue; }
    if (s.act === "key" && s.key) { lines.push(`${++n}. bấm phím ${s.key}`); continue; }
    if (s.act === "scroll") { lines.push(`${++n}. cuộn ${(s.dy ?? 0) < 0 ? "lên" : "xuống"} tại (${s.x}, ${s.y})`); continue; }
  }
  if (!lines.length) return "";
  return [
    "Làm lại đúng các bước sau trên MÀN HÌNH MÁY TÍNH (dùng tool computer_use), theo thứ tự:",
    "",
    ...lines,
    "",
    ...(screen ? [`Lúc dạy, màn hình là ${screen.width}x${screen.height}.`] : []),
    "Trước MỖI bước: chụp màn hình, tìm trên ảnh đúng thứ được mô tả, rồi mới bấm vào chỗ nó đang nằm.",
    "Toạ độ ghi trong các bước chỉ là nơi nó nằm HÔM DẠY — cửa sổ dịch chỗ một chút là toạ độ đó sai,",
    "nên đừng bấm theo toạ độ nếu chỗ đó không phải thứ được mô tả.",
    "Nếu một bước không tìm thấy trên màn hình thì DỪNG và nói rõ bước nào, đừng đoán bước tiếp theo.",
    // Dòng tuỳ chọn bỏ bằng spread rỗng chứ không bằng `.filter(Boolean)`: lọc thì nuốt luôn các
    // dòng trống ngăn cách và cả routine dính thành một khối chữ.
  ].join("\n");
}

/**
 * Dừng buổi dạy và lưu thành routine — song song với `stopTeach` của bản ghi trình duyệt.
 *
 * Hai bộ ghi loại trừ nhau chứ không chạy cùng lúc, và đó là điều đúng: người dùng thao tác trong
 * Chrome của box qua VNC thì MỘT cú bấm sinh ra cả sự kiện X11 lẫn sự kiện DOM, nên bật cả hai sẽ
 * cho một routine ghi đôi mọi bước. Việc nằm trong trình duyệt thì `teach.ts` vẫn tốt hơn hẳn —
 * selector không vỡ khi cửa sổ dịch chỗ. Bản ghi desktop dành cho thứ Chrome không với tới.
 */
export async function stopDesktopTeach(save: boolean): Promise<
  DesktopRecordingState & { saved?: string; steps?: number }
> {
  const out = await stopDesktopRecording();
  if (!out) return IDLE;
  console.log(`[grokbot2] [desktop-teach] dừng: ${out.steps.length} bước, lưu=${save}`);
  if (!save) return IDLE;
  if (!out.steps.length) return { ...IDLE, steps: 0 };

  const key = loadPoolKey();
  const described = key
    ? await describeCrops(out.dir, out.steps, { url: config.poolUrl, key, model: config.model })
    : out.steps;
  const prompt = desktopStepsToPrompt(described, (await screenInfo()) ?? undefined);
  if (!prompt || !automationCreateRef) return { ...IDLE, steps: out.steps.length };

  const name = `Việc đã dạy trên máy — ${new Date().toISOString().slice(5, 16).replace("T", " ")}`;
  automationCreateRef(out.agentId, { name, prompt, trigger: "manual" });
  return { ...IDLE, saved: name, steps: out.steps.length };
}
