/**
 * Mỗi bot một màn hình — sổ cấp và thu.
 *
 * Vì sao cần: box dùng chung một X display, nên `computer_use` của bot B bấm vào cửa sổ bot A đang
 * làm. Đã xảy ra thật. Có khoá rồi (`claimDesktop`) nhưng khoá bắt các bot xếp lượt; cấp riêng thì
 * chúng chạy song song, đúng như bản gốc (`forever-box.releaseAgent(agentId)` — box theo từng bot).
 *
 * **Số slot là cố định, và không phải lựa chọn thẩm mỹ.** Chrome trên box mở CDP ở một cổng, và
 * backend chỉ với tới cổng nào đường hầm SSH đã mở TRƯỚC (`infra/scripts/box-tunnel.ps1 -Slots`).
 * Nên slot là một cặp (display, cổng) đã biết sẵn, không phải thứ cấp phát tự do. Đo mới biết:
 * hầm chỉ mở 9223, và một Chrome thứ hai vô hình với backend dù code có đúng đến đâu.
 *
 * Mặc định TẮT (`GROKBOT2_PER_BOT_DISPLAY=on` mới bật). Đường dùng chung đang chạy tốt cho mọi bot;
 * nó không bị đổi cho tới khi đường mới tự chứng minh.
 *
 * Xem docs/plan/one-display-per-bot.md.
 */
import { boxCall, boxConfigured } from "./box-exec.js";
import { sq } from "./desktop.js";

/**
 * Bọc nháy KÉP — dùng khi đường dẫn có `$HOME` cần shell nở ra.
 *
 * `sq` bọc nháy đơn và chặn mọi phép nở, đúng cho đường dẫn cố định. Nhưng slot nay nằm trong home
 * của từng người, và home đó chỉ shell của họ mới biết. Chỉ thoát `"`, `$` của biến giữ nguyên —
 * đường dẫn ở đây do code sinh (`$HOME` + số slot), không nhận chuỗi từ người dùng.
 */
const dq = (s: string): string => `"${s.replace(/"/g, '\\"')}"`;
import { randomBytes } from "node:crypto";
import { boxSnapshot } from "./box-resources.js";

export interface DisplaySlot {
  /** 0-based, trùng thứ tự cổng hầm đã mở. */
  index: number;
  display: string;
  cdpPort: number;
  dir: string;
  /** Cổng RFB của x11vnc cho slot này. Theo đúng nếp của box: 5900 + số display. */
  vncPort: number;
  /** Cổng websockify — noVNC nói WebSocket, nginx đứng trước. 7000 + số display, cùng nếp. */
  wsPort: number;
}

export interface DisplayLease extends DisplaySlot {
  agentId: string;
  startedAtMs: number;
  lastUsedMs: number;
}

const ON = (): boolean => process.env.GROKBOT2_PER_BOT_DISPLAY === "on";
export const perBotDisplays = ON;

/** Phải khớp `-Slots` của đường hầm. Lệch xuống thì thừa cổng; lệch lên thì bot cuối vô hình. */
const MAX = Number(process.env.GROKBOT2_MAX_DISPLAYS ?? 4);
const CDP_BASE_PORT = Number(process.env.GROKBOT2_SLOT_CDP_BASE ?? 9301);
/** Tránh xa các display box đang dùng (:77 :99 :294 :336 :341 :342 :381 :433). */
const DISPLAY_BASE = Number(process.env.GROKBOT2_SLOT_DISPLAY_BASE ?? 521);
/**
 * Nơi đặt display + hồ sơ Chrome của mỗi slot.
 *
 * `~/grokbot2-slots` chứ không phải `/tmp/grokbot2/slots`, và đây là chỗ chặng 5 buộc phải đổi.
 *
 * Bản cũ dùng một thư mục dùng chung dưới `/tmp`, do `box` sở hữu, mode 755. Chạy được khi mọi bot
 * là `box`. Sau khi tách người dùng thì bot chạy dưới `gb2uNNN`, và `mkdir` trong đó trả
 * **`Permission denied`** — nhưng `spawnSlot` không kiểm mã trả về, nên nó **im lặng không tạo được
 * gì**, `waitCdp` hết giờ, `ensureDisplay` trả `null`, và bot lặng lẽ lùi về con Chrome dùng chung.
 * Tức là chỗ rò mà cờ này sinh ra để bịt lại **vẫn mở**, trong khi mọi thứ trông như đã bật.
 *
 * Dùng `$HOME`, và bọc bằng **nháy kép** (`dq`) chứ không phải `sq`: trong nháy đơn shell không nở
 * biến, nên `sq("$HOME/…")` sẽ tạo một thư mục tên đúng là `$HOME`. `dq` giữ được phép nở, và nở
 * thành home của **chính người đang chạy lệnh** — nên mỗi người một chỗ, không ai chạm được của ai.
 */
const ROOT = process.env.GROKBOT2_SLOT_ROOT ?? "$HOME/grokbot2-slots";
/** Nghỉ lâu hơn mức này thì thu — 500 MB không nên nằm không vì một bot đã xong việc. */
const IDLE_MS = Number(process.env.GROKBOT2_DISPLAY_IDLE_MS ?? 600_000);

/**
 * Hồ sơ Chrome thuộc về **BOT**, không thuộc về slot — và đây là chỗ quyết định Shopee dùng được
 * hay không.
 *
 * Bản trước để hồ sơ ở `${ROOT}/<display>/profile`, tức trong thư mục slot, mà `teardown` thì
 * `rm -rf` cả thư mục đó sau **10 phút nghỉ**. Hệ quả: chủ đăng nhập Shopee trong màn của bot, mười
 * phút sau phiên bị xoá sạch, và lần sau bot nhận slot khác thì lại là một hồ sơ khác nữa. Đúng quy
 * trình mà chính đám bot đề ra — *"Owner đăng nhập xong em kéo queue liền"* — không thể chạy được.
 *
 * Cùng một bài học với `shared/data` bên triển khai: **trạng thái phải sống ngoài cái thứ bị dựng
 * lại**. Slot là thứ dùng xong thì bỏ; phiên đăng nhập thì không.
 *
 * Giá: hồ sơ Chrome không tự nhỏ đi. Chúng nằm trong home của chính người dùng nên không ai thấy
 * hồ sơ của ai, và `/admin` đã báo dung lượng đĩa còn lại.
 */
export const profileDirOf = (agentId: string): string =>
  `${ROOT}/agents/${agentId.replace(/[^A-Za-z0-9_-]/g, "_")}/profile`;

export const slotOf = (index: number): DisplaySlot => ({
  index,
  display: `:${DISPLAY_BASE + index}`,
  cdpPort: CDP_BASE_PORT + index,
  dir: `${ROOT}/${DISPLAY_BASE + index}`,
  // Số cổng suy ra từ số display, không cấp phát tự do — cùng phép mà box đã dùng cho `:77`
  // (RFB 5977, websockify 7077). Nhờ vậy cấu hình nginx viết được sẵn, tĩnh, không phải nạp lại
  // mỗi lần một bot xin màn.
  vncPort: 5900 + DISPLAY_BASE + index,
  wsPort: 7000 + DISPLAY_BASE + index,
});

/**
 * Nhánh công khai của một slot, và mật khẩu của nó.
 *
 * **Mỗi slot một mật khẩu ngẫu nhiên, sinh mới mỗi lần dựng.** Bản dùng chung của box đi một mật
 * khẩu cố định nằm trong `GROKBOT2_VNC_URL`; sao chép cách đó sang đây thì một người đọc được URL
 * là xem được màn hình của **mọi** bot, kể cả bot của người khác — đúng cái lỗ mà chặng 5 sinh ra
 * để bịt. Mật khẩu nằm trong thư mục slot, chỉ chủ slot đọc được.
 */
const vncPass = new Map<number, string>();
const publicBase = (): string =>
  (process.env.GROKBOT2_SLOT_VNC_BASE ?? "https://admin.halcion.vn").replace(/\/+$/, "");
const slotPath = (index: number): string => `flowvnc-gb2-${index + 1}`;

/** URL noVNC của slot đang giữ bởi `agentId`, hoặc `null` khi bot không có slot riêng. */
export function slotVncUrl(agentId: string): string | null {
  const lease = leases.get(agentId);
  if (!lease) return null;
  const pass = vncPass.get(lease.index);
  if (!pass) return null;
  const p = slotPath(lease.index);
  return `${publicBase()}/${p}/vnc.html?path=${p}/websockify&autoconnect=true&password=${encodeURIComponent(pass)}`;
}

export const allSlots = (): DisplaySlot[] => Array.from({ length: MAX }, (_, i) => slotOf(i));

const leases = new Map<string, DisplayLease>();

export const displayOf = (agentId: string): DisplayLease | null => leases.get(agentId) ?? null;
export const leasesSnapshot = (): DisplayLease[] => [...leases.values()];
export const touchDisplay = (agentId: string): void => {
  const l = leases.get(agentId);
  if (l) l.lastUsedMs = Date.now();
};

/**
 * Slot rảnh đầu tiên, hoặc null khi hết.
 *
 * Tách khỏi phần gọi box để test được: chọn slot là logic thuần, dựng slot thì không.
 */
export function freeSlot(taken: Iterable<number>): DisplaySlot | null {
  const used = new Set(taken);
  for (let i = 0; i < MAX; i++) if (!used.has(i)) return slotOf(i);
  return null;
}

interface ExecResult { stdout?: string; stderr?: string }

/**
 * Dựng Xvfb + fluxbox + Chrome cho một slot.
 *
 * `;` trước `&`, không phải `&&`: với `A && B &` shell tách một subshell giữ ống stdout của daemon,
 * và daemon ngồi chờ hết phiên — đo được 60 giây mỗi lần bật bản ghi thao tác, cùng cái bẫy đó.
 *
 * Cờ Chrome không phải để cho gọn: `--test-type` bỏ dải cảnh báo "unsupported flag" và
 * `--disable-background-networking` bỏ hộp "Can't update Chrome". Cả hai **chiếm chỗ trên ảnh chụp**
 * mà model đọc toạ độ từ đó, nên chúng là lỗi đo chứ không phải chuyện thẩm mỹ.
 */
async function spawnSlot(s: DisplaySlot & { vncPass: string; profileDir: string }): Promise<void> {
  const chrome = [
    "google-chrome", "--no-first-run", "--no-default-browser-check", "--test-type",
    "--disable-background-networking", "--disable-component-update", "--no-sandbox",
    "--disable-gpu", "--window-size=1280,800",
    `--user-data-dir=${dq(s.profileDir)}`, `--remote-debugging-port=${s.cdpPort}`,
    "about:blank",
  ].join(" ");
  const cmd = [
    // `mkdir` phải nói ra khi thất bại. Bản trước nuốt mã trả về, nên khi thư mục dùng chung dưới
    // `/tmp` không cho `gb2uNNN` ghi, cả hàm này **im lặng không tạo gì** — rồi `waitCdp` hết giờ và
    // bot lặng lẽ lùi về Chrome dùng chung. Nghĩa là chỗ rò vẫn mở trong khi mọi thứ trông như đã bật.
    `mkdir -p ${dq(s.profileDir)} || { echo "MKDIR-FAIL"; exit 1; }`,
    /*
     * Dọn tiến trình cũ của CHÍNH slot này trước khi dựng — bước này đã trả giá thật.
     *
     * Mật khẩu VNC sinh mới mỗi lần dựng. Nếu `x11vnc` cũ còn sống thì cái mới **không chiếm được
     * cổng RFB**, chết lặng, và cái cũ tiếp tục phục vụ bằng **mật khẩu cũ** — trong khi URL vừa
     * phát cho người dùng mang mật khẩu mới. Triệu chứng: *"New connection has been rejected with
     * reason: password check failed!"*, và không có gì trong log backend nói vì sao.
     *
     * Không phải "để cho chắc": `teardown` chạy khi thu slot, nhưng backend khởi động lại giữa
     * chừng thì lượt thu ấy không bao giờ chạy, và tiến trình cũ sống tiếp qua nhiều bản triển khai.
     */
    `pkill -f ${sq(`[x]11vnc -display ${s.display} `)} 2>/dev/null; true`,
    `pkill -f ${sq(`[w]ebsockify --web /usr/share/novnc/ ${s.wsPort} `)} 2>/dev/null; true`,
    "sleep 0.5",
    `nohup Xvfb ${s.display} -screen 0 1280x800x24 -ac > ${dq(`${s.dir}/xvfb.log`)} 2>&1 < /dev/null & sleep 1.2`,
    `DISPLAY=${s.display} nohup fluxbox > ${dq(`${s.dir}/wm.log`)} 2>&1 < /dev/null & sleep 0.6`,
    `DISPLAY=${s.display} nohup ${chrome} > ${dq(`${s.dir}/chrome.log`)} 2>&1 < /dev/null & sleep 0.4`,
    /*
     * Màn hình phải NHÌN THẤY được, nếu không cả slot là vô hình.
     *
     * Bật cờ này lần đầu (27/08) đã tách cái bot điều khiển khỏi cái người dùng nhìn thấy: Chrome
     * riêng chạy trên `:521` mà không ai chiếu nó, còn khung "màn hình của bot" vẫn chỉ có một địa
     * chỉ cố định trỏ vào màn dùng chung. Hậu quả đo được: Teach vũ trang vào một tab `about:blank`
     * trong khi người dùng thao tác ở chỗ khác, mỗi lần dạy ghi đúng một bước rỗng.
     *
     * `-passwdfile` chứ không phải `-passwd`: đối số của tiến trình nằm trong `ps` mà **mọi người
     * dùng trên máy đều đọc được**, kể cả bot của người khác.
     */
    `printf %s ${dq(s.vncPass)} > ${dq(`${s.dir}/vncpass`)} && chmod 600 ${dq(`${s.dir}/vncpass`)}`,
    `nohup x11vnc -display ${s.display} -rfbport ${s.vncPort} -localhost -forever -shared`
      + ` -passwdfile ${dq(`${s.dir}/vncpass`)} -o ${dq(`${s.dir}/x11vnc.log`)}`
      + ` > /dev/null 2>&1 < /dev/null & sleep 0.5`,
    `nohup websockify --web /usr/share/novnc/ ${s.wsPort} localhost:${s.vncPort}`
      + ` > ${dq(`${s.dir}/websockify.log`)} 2>&1 < /dev/null & sleep 0.6`,
    // Nói ra ai đã lên. Một `x11vnc` không chiếm được cổng thì chết im lặng, và chỉ người dùng mới
    // phát hiện — bằng một thông báo mật khẩu sai chẳng liên quan gì tới nguyên nhân.
    `echo "started vnc=$(ps -eo args | grep -c ${sq(`[x]11vnc -display ${s.display} `)}) ws=$(ps -eo args | grep -c ${sq(`[w]ebsockify --web /usr/share/novnc/ ${s.wsPort} `)})"`,
  ].join("; ");
  const r = await boxCall<ExecResult>("exec", { command: cmd });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  if (out.includes("MKDIR-FAIL")) {
    throw new Error(`không tạo được thư mục slot ${s.dir} — kiểm quyền trên box: ${out.trim().slice(0, 160)}`);
  }
  if (/vnc=0|ws=0/.test(out)) {
    console.warn(`[grokbot2] [displays] ${s.display}: màn hình KHÔNG lên (${out.trim().slice(0, 120)}) — bot sẽ chạy nhưng không ai nhìn được`);
  }
}

/** CDP đã trả lời chưa. Không có bước này thì lệnh đầu tiên của bot rơi vào một Chrome chưa mở. */
async function waitCdp(port: number, timeoutMs = 20_000): Promise<boolean> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(2500) });
      if (r.ok) return true;
    } catch { /* chưa lên */ }
    await new Promise((r) => setTimeout(r, 700));
  }
  return false;
}

/**
 * Màn hình của bot này, dựng nếu chưa có.
 *
 * Trả về null khi tắt cờ, khi hết slot, hoặc khi box không còn chỗ — và **null có nghĩa là "dùng
 * màn hình chung"**, không phải lỗi. Người gọi phải chịu được điều đó, vì hết slot là trạng thái
 * bình thường của một box 22 GB.
 */
export async function ensureDisplay(agentId: string): Promise<DisplayLease | null> {
  if (!ON() || !boxConfigured() || !agentId) return null;
  const existing = leases.get(agentId);
  if (existing) { existing.lastUsedMs = Date.now(); return existing; }

  const slot = freeSlot([...leases.values()].map((l) => l.index));
  if (!slot) return null;

  // Đừng cấp tới viên gạch cuối. `/admin` hiện đúng con số này, và nó là con số đã bắt tôi kết
  // luận ngược một lần (RAM chặn trước, không phải đĩa).
  const snap = await boxSnapshot();
  if (snap.ok && snap.headroom.bots < 1) return null;

  // Mật khẩu mới mỗi lần dựng: một slot được cấp lại cho người khác thì URL cũ phải chết theo.
  const pass = randomBytes(9).toString("base64url");
  await spawnSlot({ ...slot, vncPass: pass, profileDir: profileDirOf(agentId) });
  vncPass.set(slot.index, pass);
  if (!(await waitCdp(slot.cdpPort))) {
    // Không lên được thì thu ngay. Để lại một Xvfb mồ côi là rò 500 MB không ai nhìn thấy.
    await teardown(slot);
    vncPass.delete(slot.index);
    return null;
  }
  const lease: DisplayLease = { ...slot, agentId, startedAtMs: Date.now(), lastUsedMs: Date.now() };
  leases.set(agentId, lease);
  console.log(`[grokbot2] [displays] ${agentId} nhận ${slot.display} (CDP ${slot.cdpPort})`);
  return lease;
}

/**
 * Giết tiến trình của một slot và xoá hồ sơ. Hồ sơ mới là phần chiếm đĩa.
 *
 * Mẫu bọc trong ngoặc vuông (`[X]vfb`) không phải để cho đẹp: `pkill -f 'Xvfb :521'` khớp **cả cái
 * shell đang chạy chính lệnh đó**, vì chuỗi mẫu nằm trong dòng lệnh của nó. Shell tự sát trước khi
 * kịp chạy `rm -rf`, nên tiến trình chết mà hồ sơ ở lại — thu hồi một nửa, và nửa còn lại là phần
 * chiếm đĩa. Đo được đúng như vậy: `X521` và thư mục hồ sơ vẫn nguyên sau khi `releaseDisplay`
 * báo xong. `[X]vfb` khớp "Xvfb" nhưng không khớp chính nó.
 */
async function teardown(s: DisplaySlot): Promise<void> {
  vncPass.delete(s.index);
  const port = `${s.cdpPort}`;
  const n = s.display.slice(1);
  const cmd = [
    `pkill -f ${sq(`[r]emote-debugging-port=${port}`)}`,
    `pkill -f ${sq(`[X]vfb :${n}`)}`,
    // x11vnc và websockify cũng phải chết theo. Bỏ sót chúng là để lại một cổng còn mở chiếu vào
    // một màn hình không còn tồn tại — và slot sau nhận cùng số cổng sẽ đụng nó.
    `pkill -f ${sq(`[x]11vnc -display :${n}`)}`,
    `pkill -f ${sq(`[w]ebsockify --web /usr/share/novnc/ ${s.wsPort}`)}`,
    "sleep 1",
    // Chỉ xoá thư mục RUNTIME của slot (log, mật khẩu vnc). Hồ sơ Chrome nằm ở
    // `agents/<id>/profile`, ngoài chỗ này — xem `profileDirFor`.
    `rm -rf ${dq(s.dir)}`,
    `rm -f ${sq(`/tmp/.X11-unix/X${n}`)}`,
    // Nói ra kết quả thật thay vì "done": còn sót thì phải thấy ngay ở log, không phải một tuần sau
    // khi RAM hết.
    `echo "left=$(ps -eo args | grep -cE '[X]vfb :${n}|[c]hrome.*${port}|[x]11vnc -display :${n}|[w]ebsockify.* ${s.wsPort} ') dir=$(test -e ${dq(s.dir)} && echo yes || echo no)"`,
  ].join("; ");
  const r = await boxCall<ExecResult>("exec", { command: cmd });
  const out = String(r.stdout ?? "").trim();
  if (!/left=0 dir=no/.test(out)) {
    console.warn(`[grokbot2] [displays] thu ${s.display} chưa sạch: ${out}`);
  }
}

export async function releaseDisplay(agentId: string): Promise<void> {
  const l = leases.get(agentId);
  if (!l) return;
  leases.delete(agentId);
  try {
    await teardown(l);
    console.log(`[grokbot2] [displays] đã thu ${l.display} của ${agentId}`);
  } catch (e) {
    // Thu không được thì phải nói ra: cái slot đó giờ vừa không dùng được vừa vẫn ăn RAM.
    console.warn(`[grokbot2] [displays] KHÔNG thu được ${l.display}: ${(e as Error).message}`);
  }
}

/** Thu những màn hình nghỉ quá lâu. Trả về danh sách bot đã bị thu, để log nói được điều gì đã xảy ra. */
export async function reapIdleDisplays(nowMs = Date.now()): Promise<string[]> {
  const gone: string[] = [];
  for (const l of [...leases.values()]) {
    if (nowMs - l.lastUsedMs < IDLE_MS) continue;
    gone.push(l.agentId);
    await releaseDisplay(l.agentId);
  }
  return gone;
}

/**
 * Xoá hồ sơ Chrome của một bot đã bị xoá.
 *
 * Hồ sơ sống ngoài slot để phiên đăng nhập không chết theo mỗi lần thu màn — nhưng "sống lâu" và
 * "sống mãi" là hai chuyện. Đo được: một hồ sơ đã dùng thật nặng **57 MB**, nên bốn chục con bot đã
 * xoá là hơn 2 GB nằm không trong home của người dùng, không ai nhìn thấy.
 *
 * Gọi khi bot bị xoá, không gọi khi thu slot.
 */
export async function dropAgentProfile(agentId: string): Promise<void> {
  if (!ON() || !agentId) return;
  const dir = profileDirOf(agentId);
  // Chỉ xoá trong đúng gốc slot của người dùng — `profileDirOf` đã lọc ký tự, đây là lớp thứ hai.
  if (!dir.startsWith(`${ROOT}/agents/`)) return;
  try {
    await boxCall<ExecResult>("exec", { command: `rm -rf ${dq(dir.replace(/\/profile$/, ""))}` });
  } catch { /* bot bị xoá rồi thì một hồ sơ còn sót không đáng làm hỏng lượt xoá */ }
}

/** Ai cũng nghỉ thì thu hết — dùng khi backend tắt, để không để lại Xvfb mồ côi trên box. */
export async function releaseAllDisplays(): Promise<void> {
  for (const id of [...leases.keys()]) await releaseDisplay(id);
}

/**
 * Dọn slot mồ côi từ một lần chạy trước.
 *
 * Backend chết giữa lúc có slot đang chạy thì Xvfb và Chrome vẫn sống trên box, còn sổ ở đây thì
 * trắng — 500 MB mỗi cái, không ai đòi. Chỉ dọn đúng dải slot của mình, không chạm vào tám display
 * mà phần mềm khác trên box đang dùng.
 */
export async function reapOrphanSlots(): Promise<number> {
  if (!boxConfigured()) return 0;
  let n = 0;
  for (const s of allSlots()) {
    const live = [...leases.values()].some((l) => l.index === s.index);
    if (live) continue;
    const r = await boxCall<ExecResult>("exec", {
      command: `test -e /tmp/.X11-unix/X${s.display.slice(1)} && echo yes || echo no`,
    });
    if (String(r.stdout ?? "").trim() !== "yes") continue;
    await teardown(s);
    n++;
    console.log(`[grokbot2] [displays] dọn slot mồ côi ${s.display}`);
  }
  return n;
}
