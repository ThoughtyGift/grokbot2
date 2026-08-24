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
import { boxSnapshot } from "./box-resources.js";

export interface DisplaySlot {
  /** 0-based, trùng thứ tự cổng hầm đã mở. */
  index: number;
  display: string;
  cdpPort: number;
  profileDir: string;
  dir: string;
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
const ROOT = "/tmp/grokbot2/slots";
/** Nghỉ lâu hơn mức này thì thu — 500 MB không nên nằm không vì một bot đã xong việc. */
const IDLE_MS = Number(process.env.GROKBOT2_DISPLAY_IDLE_MS ?? 600_000);

export const slotOf = (index: number): DisplaySlot => ({
  index,
  display: `:${DISPLAY_BASE + index}`,
  cdpPort: CDP_BASE_PORT + index,
  dir: `${ROOT}/${DISPLAY_BASE + index}`,
  profileDir: `${ROOT}/${DISPLAY_BASE + index}/profile`,
});

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
async function spawnSlot(s: DisplaySlot): Promise<void> {
  const chrome = [
    "google-chrome", "--no-first-run", "--no-default-browser-check", "--test-type",
    "--disable-background-networking", "--disable-component-update", "--no-sandbox",
    "--disable-gpu", "--window-size=1280,800",
    `--user-data-dir=${s.profileDir}`, `--remote-debugging-port=${s.cdpPort}`,
    "about:blank",
  ].join(" ");
  const cmd = [
    `mkdir -p ${sq(s.profileDir)}`,
    `nohup Xvfb ${s.display} -screen 0 1280x800x24 -ac > ${sq(`${s.dir}/xvfb.log`)} 2>&1 < /dev/null & sleep 1.2`,
    `DISPLAY=${s.display} nohup fluxbox > ${sq(`${s.dir}/wm.log`)} 2>&1 < /dev/null & sleep 0.6`,
    `DISPLAY=${s.display} nohup ${chrome} > ${sq(`${s.dir}/chrome.log`)} 2>&1 < /dev/null & echo started`,
  ].join("; ");
  await boxCall<ExecResult>("exec", { command: cmd });
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

  await spawnSlot(slot);
  if (!(await waitCdp(slot.cdpPort))) {
    // Không lên được thì thu ngay. Để lại một Xvfb mồ côi là rò 500 MB không ai nhìn thấy.
    await teardown(slot);
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
  const port = `${s.cdpPort}`;
  const n = s.display.slice(1);
  const cmd = [
    `pkill -f ${sq(`[r]emote-debugging-port=${port}`)}`,
    `pkill -f ${sq(`[X]vfb :${n}`)}`,
    "sleep 1",
    `rm -rf ${sq(s.dir)}`,
    `rm -f ${sq(`/tmp/.X11-unix/X${n}`)}`,
    // Nói ra kết quả thật thay vì "done": còn sót thì phải thấy ngay ở log, không phải một tuần sau
    // khi RAM hết.
    `echo "left=$(ps -eo args | grep -cE '[X]vfb :${n}|[c]hrome.*${port}') dir=$(test -e ${sq(s.dir)} && echo yes || echo no)"`,
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
