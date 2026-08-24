/**
 * Điều khiển desktop của box — giai đoạn 1 của docs/plan/desktop-computer-use.md.
 *
 * Bản gốc phơi một `ComputerUseParams.actions`: oneof 11 nhánh (mouse_move, click, mouse_down,
 * mouse_up, drag, scroll, type, key, wait, screenshot, cursor_position), toàn bộ theo TOẠ ĐỘ, kèm
 * kích thước và DPI màn hình để model tự tính. Không có nhánh nào kiểu "tìm nút Save" — nên vòng
 * lặp bắt buộc là chụp → chọn toạ độ → hành động → chụp lại xác nhận.
 *
 * Vì sao Python trên box chứ không phải xdotool: box không có sudo, và `apt-get install xdotool`
 * cần root. `python-xlib` dùng đúng cơ chế XTEST mà xdotool dùng, cài được bằng `pip --user`.
 * Đo trước khi viết: DISPLAY=:77 có sẵn, python3 3.8 + Pillow 7.0 có sẵn, xlib 0.33 vừa cài.
 *
 * Script được đẩy lên box một lần rồi gọi lại theo tên — kèm băm nội dung, nên sửa file này là
 * lần chạy sau tự đẩy bản mới. Nhúng cả script vào mỗi lệnh cũng chạy, nhưng đó là vài KB gửi qua
 * internet cho mỗi cú click.
 */
import { createHash } from "node:crypto";
import { boxCall, boxConfigured } from "./box-exec.js";

/** Đường dẫn trên box. Tên có băm nên hai phiên bản không giẫm lên nhau. */
const REMOTE_DIR = "/tmp/grokbot2";

export interface DesktopAction {
  action: "mouse_move" | "click" | "mouse_down" | "mouse_up" | "drag" | "scroll"
    | "type" | "key" | "screenshot" | "cursor_position" | "screen_info";
  x?: number;
  y?: number;
  toX?: number;
  toY?: number;
  button?: number;
  dy?: number;
  text?: string;
  key?: string;
  /** Nơi driver ghi ảnh — phải nằm trong gốc daemon phục vụ, xem `shotPath`. */
  shotPath?: string;
}

export interface DesktopResult {
  ok: boolean;
  error?: string;
  /** JPEG base64, chỉ có với `screenshot` — đọc về từ box bằng `readBytes`. */
  imageBase64?: string;
  /** Đường dẫn ảnh trên box, bước trung gian của `screenshot`. */
  path?: string;
  bytes?: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  dpi?: number;
  note?: string;
}

/**
 * Bộ điều khiển chạy trên box.
 *
 * Nhận một JSON action trên argv, trả một JSON kết quả trên stdout. Không giữ trạng thái giữa các
 * lần gọi — mỗi hành động là một tiến trình. Chậm hơn một daemon thường trú, nhưng không có tiến
 * trình nào để rò rỉ, và một cú click chậm 200ms thì không ai thấy.
 */
const DRIVER = String.raw`
import sys, os, json, base64, io, time

def out(d):
    sys.stdout.write(json.dumps(d))
    sys.exit(0)

try:
    from Xlib import display, X, XK
    from Xlib.ext import xtest
except Exception as e:
    out({"ok": False, "error": "python-xlib chua san sang: %s" % e})

try:
    req = json.loads(sys.argv[1])
except Exception as e:
    out({"ok": False, "error": "argv khong phai JSON: %s" % e})

act = req.get("action")
try:
    d = display.Display()
except Exception as e:
    out({"ok": False, "error": "khong mo duoc DISPLAY (%s): %s" % (__import__("os").environ.get("DISPLAY"), e)})
root = d.screen().root

def flush():
    d.sync()
    time.sleep(0.03)

def move(x, y):
    xtest.fake_input(d, X.MotionNotify, x=int(x), y=int(y))
    flush()

def button(kind, b):
    xtest.fake_input(d, kind, int(b))
    flush()

# Ban phim: doi mot ky tu / ten phim sang keycode. Ten phim theo keysym cua X ("Return", "Escape").
def keycode_for(name):
    ks = XK.string_to_keysym(name)
    if ks == 0 and len(name) == 1:
        ks = ord(name)
    if ks == 0:
        return None, False
    kc = d.keysym_to_keycode(ks)
    if kc == 0:
        return None, False
    # Chu hoa va ky tu can Shift: keysym nam o cot thu hai cua keycode.
    needs_shift = False
    try:
        mapping = d.keysym_to_keycodes(ks)
        for code, index in mapping:
            if code == kc:
                needs_shift = index % 2 == 1
                break
    except Exception:
        needs_shift = name.isalpha() and name.isupper()
    return kc, needs_shift

SHIFT = d.keysym_to_keycode(XK.string_to_keysym("Shift_L"))
CTRL = d.keysym_to_keycode(XK.string_to_keysym("Control_L"))
ALT = d.keysym_to_keycode(XK.string_to_keysym("Alt_L"))
MODS = {"ctrl": CTRL, "control": CTRL, "shift": SHIFT, "alt": ALT}

def tap(name):
    kc, shift = keycode_for(name)
    if kc is None:
        return False
    if shift:
        xtest.fake_input(d, X.KeyPress, SHIFT)
    xtest.fake_input(d, X.KeyPress, kc)
    xtest.fake_input(d, X.KeyRelease, kc)
    if shift:
        xtest.fake_input(d, X.KeyRelease, SHIFT)
    flush()
    return True

try:
    if act == "screen_info":
        s = d.screen()
        # DPI = pixel / (mm / 25.4). width_in_mmm co the la 0 tren mot so X server ao.
        dpi = 96
        if s.width_in_mms:
            dpi = int(round(s.width_in_pixels / (s.width_in_mms / 25.4)))
        out({"ok": True, "width": s.width_in_pixels, "height": s.height_in_pixels, "dpi": dpi})

    if act == "cursor_position":
        p = root.query_pointer()
        out({"ok": True, "x": p.root_x, "y": p.root_y})

    if act == "mouse_move":
        move(req["x"], req["y"])
        out({"ok": True})

    if act in ("click", "mouse_down", "mouse_up"):
        b = req.get("button", 1)
        if "x" in req and req["x"] is not None:
            move(req["x"], req["y"])
        if act == "click":
            button(X.ButtonPress, b)
            button(X.ButtonRelease, b)
        elif act == "mouse_down":
            button(X.ButtonPress, b)
        else:
            button(X.ButtonRelease, b)
        out({"ok": True})

    if act == "drag":
        move(req["x"], req["y"])
        button(X.ButtonPress, req.get("button", 1))
        # Di chuyen theo tung buoc: mot so app bo qua cu keo nhay thang mot phat.
        steps = 12
        x0, y0, x1, y1 = int(req["x"]), int(req["y"]), int(req["toX"]), int(req["toY"])
        for i in range(1, steps + 1):
            move(x0 + (x1 - x0) * i // steps, y0 + (y1 - y0) * i // steps)
        button(X.ButtonRelease, req.get("button", 1))
        out({"ok": True})

    if act == "scroll":
        if "x" in req and req["x"] is not None:
            move(req["x"], req["y"])
        dy = int(req.get("dy", -3))
        b = 4 if dy < 0 else 5          # 4 = len, 5 = xuong
        for _ in range(min(abs(dy), 50)):
            button(X.ButtonPress, b)
            button(X.ButtonRelease, b)
        out({"ok": True})

    if act == "type":
        text = req.get("text", "")
        missed = []
        for ch in text[:2000]:
            if ch == "\n":
                tap("Return")
                continue
            if ch == "\t":
                tap("Tab")
                continue
            if ch == " ":
                tap("space")
                continue
            if not tap(ch):
                missed.append(ch)
        res = {"ok": True}
        if missed:
            # Khong bia: bao dung nhung ky tu ban phim hien tai khong go duoc.
            res["note"] = "khong go duoc: " + "".join(sorted(set(missed)))[:40]
        out(res)

    if act == "key":
        combo = str(req.get("key", ""))
        parts = [p for p in combo.replace("-", "+").split("+") if p]
        held = [MODS[p.lower()] for p in parts[:-1] if p.lower() in MODS]
        name = parts[-1] if parts else ""
        for m in held:
            xtest.fake_input(d, X.KeyPress, m)
        ok = tap(name)
        for m in reversed(held):
            xtest.fake_input(d, X.KeyRelease, m)
        flush()
        out({"ok": ok} if ok else {"ok": False, "error": "khong biet phim: " + combo})

    if act == "screenshot":
        s = d.screen()
        w, h = s.width_in_pixels, s.height_in_pixels
        raw = root.get_image(0, 0, w, h, X.ZPixmap, 0xffffffff)
        from PIL import Image
        img = Image.frombytes("RGB", (w, h), raw.data, "raw", "BGRX")
        # KHONG thu nho. Model doc anh nay roi tra ve toa do de bam, nen anh phai o dung ty le
        # man hinh that — resize mot cai la moi toa do lech theo, va cai lech do im lang.
        # JPEG thay PNG: cung kich thuoc do phan giai nhung nho hon nhieu lan, va vision khong
        # can khong mat mat.
        path = req.get("shotPath") or "/tmp/grokbot2/shot.jpg"
        img.save(path, format="JPEG", quality=75, optimize=True)
        out({"ok": True, "width": w, "height": h, "path": path,
             "bytes": os.path.getsize(path)})

    out({"ok": False, "error": "khong biet action: %s" % act})
except SystemExit:
    raise
except Exception as e:
    out({"ok": False, "error": "%s: %s" % (type(e).__name__, e)})
`;

const DRIVER_HASH = createHash("sha256").update(DRIVER).digest("hex").slice(0, 12);
const REMOTE_PATH = `${REMOTE_DIR}/desktop-${DRIVER_HASH}.py`;

let deployed = false;

/**
 * Nơi ghi ảnh chụp: phải nằm TRONG gốc mà daemon phục vụ.
 *
 * `readBytes` từ chối mọi đường ngoài gốc ("path escapes root"), nên `/tmp` không dùng được dù
 * driver ghi được vào đó. Hỏi `health` một lần để biết gốc thật thay vì đoán.
 */
let shotPath: string | null = null;

async function shotTarget(): Promise<string> {
  if (shotPath) return shotPath;
  return `${await boxRoot()}/.grokbot2-shot.jpg`;
}

/**
 * Thư mục gốc daemon phục vụ.
 *
 * Mọi thứ cần đọc NGƯỢC về đây phải nằm trong này: `readBytes` từ chối đường dẫn ngoài gốc
 * ("path escapes root"), nên `/tmp` viết được nhưng không đọc lại được — đúng cái bẫy đã mất một
 * vòng khi làm ảnh chụp màn hình.
 */
let cachedRoot: string | null = null;

export async function boxRoot(): Promise<string> {
  if (cachedRoot) return cachedRoot;
  const h = await boxCall<{ root?: string }>("health");
  cachedRoot = String(h.root ?? "").replace(/\/+$/, "") || "/home/box/workspace";
  return cachedRoot;
}

/** Quote một chuỗi cho shell POSIX. */
export const sq = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;

interface ExecResult { stdout?: string; stderr?: string; exitCode?: number }

/**
 * Đẩy driver lên box nếu chưa có.
 *
 * Kiểm tra bằng tên file (đã chứa băm), nên một bản driver mới không bao giờ chạy nhầm bản cũ, và
 * bản cũ không bị xoá — `/tmp` tự dọn.
 */
async function ensureDriver(): Promise<void> {
  if (deployed) return;
  const check = await boxCall<ExecResult>("exec", { command: `test -f ${REMOTE_PATH} && echo yes || echo no` });
  if (String(check.stdout ?? "").trim() === "yes") { deployed = true; return; }
  // base64 để không phải lo escape gì cả: nội dung script có cả nháy đơn, nháy kép và backslash.
  const b64 = Buffer.from(DRIVER, "utf8").toString("base64");
  const cmd = `mkdir -p ${REMOTE_DIR} && printf %s ${sq(b64)} | base64 -d > ${REMOTE_PATH} && echo ok`;
  const wrote = await boxCall<ExecResult>("exec", { command: cmd });
  if (String(wrote.stdout ?? "").trim() !== "ok") {
    throw new Error(`không đẩy được driver lên box: ${String(wrote.stderr ?? "").slice(0, 200)}`);
  }
  deployed = true;
  console.log(`[grokbot2] [desktop] driver ${DRIVER_HASH} đã lên box`);
}

export const desktopConfigured = (): boolean => boxConfigured();

/** Chạy một hành động trên desktop của box. Lỗi trả về trong `error`, không ném. */
export async function desktopAct(a: DesktopAction): Promise<DesktopResult> {
  if (!boxConfigured()) return { ok: false, error: "chưa nối box (GROKBOT2_BOX_EXEC_URL)" };
  try {
    await ensureDriver();
    const withPath = a.action === "screenshot" ? { ...a, shotPath: await shotTarget() } : a;
    const arg = sq(JSON.stringify(withPath));
    const r = await boxCall<ExecResult>("exec", { command: `python3 ${REMOTE_PATH} ${arg}` });
    const text = String(r.stdout ?? "").trim();
    if (!text) return { ok: false, error: `driver không trả gì (${String(r.stderr ?? "").slice(0, 200)})` };
    const res = JSON.parse(text) as DesktopResult;
    // Ảnh không đi qua stdout: daemon cắt ở 200.000 ký tự, và một ảnh màn hình vượt xa mức đó.
    if (res.ok && res.path && a.action === "screenshot") {
      const file = await boxCall<{ bytesBase64?: string }>("readBytes", {
        target_file: res.path, offset: 0, length: res.bytes ?? 4_000_000,
      });
      const b64 = String(file.bytesBase64 ?? "");
      if (!b64) return { ...res, ok: false, error: "đọc lại ảnh từ box về rỗng" };
      return { ...res, imageBase64: b64 };
    }
    return res;
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/**
 * Kích thước màn hình, để đưa vào prompt.
 *
 * Bản gốc gửi `screen_width_pixels` / `screen_height_pixels` / `screen_dpi` cho model vì không có
 * chúng thì không thể đoán toạ độ. Nhớ lại kết quả: kích thước màn hình box không đổi giữa các lượt.
 */
let cachedInfo: { width: number; height: number; dpi: number } | null = null;

export async function screenInfo(): Promise<{ width: number; height: number; dpi: number } | null> {
  if (cachedInfo) return cachedInfo;
  const r = await desktopAct({ action: "screen_info" });
  if (!r.ok || !r.width || !r.height) return null;
  cachedInfo = { width: r.width, height: r.height, dpi: r.dpi ?? 96 };
  return cachedInfo;
}

/**
 * Does this `computer_use` call only LOOK at the screen?
 *
 * Screenshot, cursor position and screen size change nothing, and they are the first half of every
 * loop — asking the user to approve a screenshot would put a card in front of the very step that
 * lets the model see where to click.
 *
 * The mutating half deliberately does NOT get the blanket pass that `browser_*` has. A browser
 * action is bounded by a page; a desktop click is bounded by nothing — it can land in a terminal.
 * Those follow the user's standing permission like any other writing tool.
 */
export const isDesktopLook = (arg: string): boolean => {
  try {
    const a = String(JSON.parse(arg)?.action ?? "");
    return a === "screenshot" || a === "cursor_position" || a === "screen_info";
  } catch { return false; }
};

/** Tên 11 nhánh của `ComputerUseParams`, cộng `screen_info` — xem docs/plan/desktop-computer-use.md. */
const ACTIONS = new Set<DesktopAction["action"]>([
  "mouse_move", "click", "mouse_down", "mouse_up", "drag", "scroll",
  "type", "key", "screenshot", "cursor_position", "screen_info",
]);

/** Những action vô nghĩa nếu thiếu toạ độ — gửi đi thiếu thì click rơi vào chỗ con trỏ đang đứng. */
const NEEDS_XY = new Set(["mouse_move", "click", "mouse_down", "mouse_up", "drag"]);

/**
 * Đọc đối số model gửi thành một action, hoặc trả về câu báo lỗi cho model đọc.
 *
 * Kiểm ngay ở đây thay vì để box từ chối, vì hai lỗi hay gặp nhất đều KHÔNG gây lỗi ở xa: action
 * lạ thì driver trả "khong biet action" sau một vòng mạng, còn `click` thiếu x/y thì chạy trót lọt
 * và bấm vào chỗ con trỏ tình cờ đang đứng — sai mà không ai biết.
 */
export function parseDesktopArg(arg: string): DesktopAction | { error: string } {
  let spec: Record<string, unknown>;
  try {
    const v: unknown = JSON.parse(arg);
    spec = v && typeof v === "object" ? (v as Record<string, unknown>) : { action: String(v) };
  } catch {
    spec = { action: arg.trim().replace(/^["']|["']$/g, "") };
  }

  const action = String(spec.action ?? "").trim() as DesktopAction["action"];
  if (!ACTIONS.has(action)) {
    return { error: `computer_use không có action "${action || "(trống)"}" — dùng ${[...ACTIONS].join(", ")}` };
  }

  const num = (v: unknown): number | undefined => (Number.isFinite(Number(v)) && v !== null && v !== "" ? Number(v) : undefined);
  const a: DesktopAction = {
    action,
    x: num(spec.x), y: num(spec.y),
    toX: num(spec.toX ?? spec.to_x), toY: num(spec.toY ?? spec.to_y),
    button: num(spec.button), dy: num(spec.dy ?? spec.amount),
    ...(typeof spec.text === "string" ? { text: spec.text } : {}),
    ...(typeof spec.key === "string" ? { key: spec.key } : {}),
  };

  if (NEEDS_XY.has(action) && (a.x === undefined || a.y === undefined)) {
    return { error: `computer_use ${action} cần "x" và "y" — chụp màn hình trước rồi đọc toạ độ trên ảnh` };
  }
  if (action === "drag" && (a.toX === undefined || a.toY === undefined)) {
    return { error: 'computer_use drag cần "toX" và "toY" là điểm thả' };
  }
  if (action === "type" && !a.text) return { error: 'computer_use type cần "text"' };
  if (action === "key" && !a.key) return { error: 'computer_use key cần "key", ví dụ "ctrl+s" hoặc "Return"' };
  return a;
}

/**
 * Ai đang cầm màn hình.
 *
 * `browser_*` an toàn khi nhiều bot chạy cùng lúc vì mỗi bot có TAB riêng và CDP tác động thẳng
 * vào tab đó, không cần tab nằm trên cùng. `computer_use` thì ngược lại: nó bấm vào cửa sổ nào
 * đang ở trên cùng. Trên một box dùng chung, cú bấm của bot B rơi vào trang mà bot A đang làm.
 *
 * Đã xảy ra thật: một bot đang phân tích trang Shopee bị cắt ngang vì một bot khác gõ chữ vào
 * chính tab đó. Không ai báo lỗi, vì mọi thao tác đều "thành công" — chỉ là trúng cửa sổ của
 * người khác.
 *
 * Bản gốc không gặp chuyện này: box của họ cấp THEO TỪNG BOT (`forever-box.releaseAgent(agentId)`,
 * gọi khi xoá bot), nên hai bot là hai máy, hai Chrome. Bên mình một box dùng chung, nên phải có
 * trọng tài — và trọng tài đúng là "từ chối", không phải "chờ": bot bị từ chối còn nói lại được
 * với người dùng, bot chờ thì treo im.
 */
interface DesktopHold { agentId: string; atMs: number }
let hold: DesktopHold | null = null;

/** Giữ quá lâu mà không ai nhả thì coi như bỏ rơi — một lượt chết không được khoá máy vĩnh viễn. */
const HOLD_STALE_MS = Number(process.env.GROKBOT2_DESKTOP_HOLD_MS ?? 180_000);

export function claimDesktop(agentId: string): { ok: true } | { ok: false; heldBy: string } {
  if (hold && hold.agentId !== agentId && Date.now() - hold.atMs < HOLD_STALE_MS) {
    return { ok: false, heldBy: hold.agentId };
  }
  hold = { agentId, atMs: Date.now() };
  return { ok: true };
}

export function releaseDesktop(agentId: string): void {
  if (hold?.agentId === agentId) hold = null;
}

/** Ai đang giữ, hoặc null. Dùng cho e2e và cho câu trả lời gửi model. */
export const desktopHeldBy = (): string | null => {
  if (hold && Date.now() - hold.atMs >= HOLD_STALE_MS) hold = null;
  return hold?.agentId ?? null;
};
