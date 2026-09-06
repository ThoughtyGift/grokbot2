/**
 * Box còn chỗ cho bao nhiêu bot nữa — đọc từ chính box, không từ phỏng đoán.
 *
 * Câu hỏi của người vận hành không phải "RAM còn bao nhiêu" mà là "tôi cấp thêm được mấy bot".
 * Hai câu đó khác nhau, và cái chặn trước **không cố định**: box này còn 8 GB RAM (14 bot) nhưng
 * cũng đã dùng 87% đĩa (37 bot) — RAM chặn trước, dù nhìn con số 87% thì tưởng ngược lại. Chính tôi
 * đã kết luận sai chiều này một lần, nên hàm `headroomOf` trả về CẢ HAI con số và nói rõ cái nào
 * đang chặn, thay vì chọn hộ.
 *
 * Xem docs/plan/one-display-per-bot.md để biết con số đo được và vì sao nó quyết định kiến trúc.
 */
import { boxCall, boxConfigured, boxPoolStatus, type PoolStatus } from "./box-exec.js";

/** Một màn hình ảo đang chạy trên box, cùng những tiến trình sống nhờ nó. */
export interface DisplayRow {
  display: string;
  geometry?: string;
  /** Tổng RSS của mọi tiến trình gắn với màn hình này, tính bằng MB. */
  rssMb: number;
  xvfbMb: number;
  chromeMb: number;
  vncMb: number;
  wmMb: number;
  procs: number;
  /** Hồ sơ Chrome đang dùng — cách duy nhất để nhận ra Chrome nào thuộc màn hình nào. */
  profiles: string[];
  vncPort?: number;
  /** Chỉ còn Xvfb: không Chrome, không VNC. Thu hồi được ngay, và đo được là có thật. */
  idle: boolean;
}

/** Một hồ sơ Chrome và cái giá nó đang trả. Khoản to nhất trên box này, nên không được gộp ẩn. */
export interface ChromeProfileRow {
  profile: string;
  rssMb: number;
  procs: number;
  display?: string;
}

export interface BoxSnapshot {
  ok: boolean;
  error?: string;
  atMs: number;
  ram: { totalMb: number; usedMb: number; freeMb: number; availableMb: number };
  disk: { totalMb: number; usedMb: number; freeMb: number; usedPct: number; mount: string };
  displays: DisplayRow[];
  /** Chrome không gắn được vào màn hình nào — thường là Chrome dùng hồ sơ mặc định. */
  looseChromeMb: number;
  /**
   * Từng hồ sơ Chrome một, kèm dung lượng.
   *
   * Bản đầu chỉ trả một con số tổng cho phần không gán được, và trên box thật con số đó là
   * **6.2 GB** — khoản lớn nhất của cả máy, gộp thành một dòng vô nghĩa. Người vận hành cần biết
   * hồ sơ NÀO đang ăn, vì đó là thứ tắt được.
   */
  chromeProfiles: ChromeProfileRow[];
  /** Bao nhiêu bot nữa thì hết chỗ, tính riêng theo RAM và theo đĩa. */
  headroom: { byRamBots: number; byDiskBots: number; limit: "ram" | "disk"; bots: number };
  /**
   * Dải tài khoản `gb2u*` của router — trần chặn SỚM hơn RAM (bảng theo dõi §7 "hỏi sai khoá…"):
   * hết dải là người kế thấy mọi tool box hỏng cùng lúc. Vắng khi router cũ chưa có `GET /pool`.
   */
  pool?: PoolStatus;
}

/** Đo được ngày 24/08/2026: một màn hình riêng đầy đủ tốn chừng này. */
export const COST_PER_BOT_MB = Number(process.env.GROKBOT2_DISPLAY_COST_MB ?? 500);
/** Hồ sơ Chrome mới chiếm chừng này ngay sau khi mở lần đầu. */
export const PROFILE_MB = Number(process.env.GROKBOT2_PROFILE_COST_MB ?? 350);
/** Chừa lại, không cấp tới viên gạch cuối: một box hết đĩa thì không chỉ bot mới bị chết. */
const RESERVE_MB = 1024;

const num = (s: string | undefined): number => {
  const n = Number(String(s ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

/** `free -m`, dòng `Mem:`. */
export function parseFree(line: string): BoxSnapshot["ram"] {
  const f = line.trim().split(/\s+/);
  // Mem: total used free shared buff/cache available
  return { totalMb: num(f[1]), usedMb: num(f[2]), freeMb: num(f[3]), availableMb: num(f[6] ?? f[3]) };
}

/** `df -m /`, dòng cuối. */
export function parseDf(line: string): BoxSnapshot["disk"] {
  const f = line.trim().split(/\s+/);
  const total = num(f[1]), used = num(f[2]), free = num(f[3]);
  return {
    totalMb: total, usedMb: used, freeMb: free,
    usedPct: num(f[4]) || (total ? Math.round((used / total) * 100) : 0),
    mount: f[5] ?? "/",
  };
}

/**
 * Đoán màn hình từ tên hồ sơ Chrome.
 *
 * Cần đoán vì Chrome không ghi `DISPLAY` vào dòng lệnh. Không phải mẹo tuỳ tiện: hai bộ phần mềm
 * đang chạy trên box này đều nhét số display vào tên hồ sơ, chỉ khác cách —
 * `grok-chrome-77` cho `:77`, và `…-both-9342` cho `:342`, tức số display có thêm tiền tố `9`.
 *
 * Bản đầu chỉ khớp hai hoặc ba chữ số cuối, nên **sáu Chrome** không nối được và 6.2 GB rơi vào ô
 * "không gán được" — rồi sáu màn hình của chúng trông như bị bỏ rơi. Tôi đã kết luận "rác thu hồi
 * được" từ đúng con số đó, và nó sai: đấy là phần mềm khác đang chạy thật.
 *
 * Nên thử lần lượt các cách cắt, và **chỉ nhận khi màn hình đó có thật** — không có thì trả về
 * chuỗi rỗng, thà để trong ô chưa gán hơn là gán bừa.
 */
export function displayFromProfile(profile: string, known: Map<string, unknown> | Set<string>): string {
  const has = (d: string): boolean => (known instanceof Map ? known.has(d) : known.has(d));
  const tail = /(\d{2,5})$/.exec(profile)?.[1];
  const explicit = /disp(\d+)/.exec(profile)?.[1];
  const tries = [explicit, tail, tail?.slice(1), tail?.slice(-3), tail?.slice(-2)];
  for (const t of tries) {
    if (t && has(`:${t}`)) return `:${t}`;
  }
  return "";
}

/**
 * Gom tiến trình theo màn hình.
 *
 * Chrome không ghi display trong dòng lệnh, nên không thể gom theo đó. Nhưng mỗi màn hình riêng
 * dùng một `--user-data-dir` riêng, và **mọi tiến trình con của Chrome đều thừa hưởng cờ đó** —
 * nên hồ sơ mới là chìa khoá gom, không phải display. Nếu một hồ sơ có tên chứa số display (cách
 * `displays.ts` sẽ đặt tên) thì nối được về màn hình; không thì nó vào `looseChromeMb`.
 */
/** Một dòng `ps`: pid, RSS (KB), phần còn lại là dòng lệnh. Không khớp thì không phải dòng của ta. */
const PS_LINE = /^\s*(\d+)\s+(\d+)\s+(.*)$/;

const blankRow = (display: string): DisplayRow =>
  ({ display, rssMb: 0, xvfbMb: 0, chromeMb: 0, vncMb: 0, wmMb: 0, procs: 0, profiles: [], idle: true });

/**
 * Vòng một: **màn hình nào có thật**.
 *
 * Phải đi trước vòng Chrome, và đó là lý do tách: `Xvfb` là thứ duy nhất khai ra một màn hình tồn
 * tại, còn Chrome thì chỉ *nối vào* một màn hình có sẵn. Gộp hai vòng vào một thì một tiến trình
 * Chrome đọc trước `Xvfb` của nó sẽ bị tính là "bơ vơ".
 */
function scanDisplays(lines: string[]): Map<string, DisplayRow> {
  const byDisplay = new Map<string, DisplayRow>();
  const row = (d: string) => byDisplay.get(d) ?? byDisplay.set(d, blankRow(d)).get(d)!;
  for (const raw of lines) {
    const m = PS_LINE.exec(raw);
    if (!m) continue;
    const [, , rssKb, args] = m;
    const mb = num(rssKb) / 1024;
    const xvfb = /(^|\/)Xvfb\s+(:\d+)/.exec(args);
    if (xvfb) {
      const r = row(xvfb[2]);
      r.xvfbMb += mb; r.rssMb += mb; r.procs++;
      const geo = /-screen\s+\d+\s+(\S+)/.exec(args);
      if (geo) r.geometry = geo[1];
      continue;
    }
    const vnc = /x11vnc/.test(args) ? /-display\s+(:\d+)/.exec(args) : null;
    if (vnc) {
      const r = row(vnc[1]);
      r.vncMb += mb; r.rssMb += mb; r.procs++;
      const port = /-rfbport\s+(\d+)/.exec(args);
      if (port) r.vncPort = num(port[1]);
    }
  }
  return byDisplay;
}

/** Làm tròn + gắn nhãn "bỏ rơi", sau khi cả hai vòng đã cộng xong. */
function finishDisplays(byDisplay: Map<string, DisplayRow>): DisplayRow[] {
  const displays = [...byDisplay.values()].sort((a, b) => b.rssMb - a.rssMb);
  for (const d of displays) {
    // "Bỏ rơi" = không Chrome, không VNC. Cẩn thận với chữ này: sáu màn hình từng bị gắn nhãn đó
    // chỉ vì tên hồ sơ Chrome của chúng không khớp phép nối ở vòng hai.
    d.idle = d.chromeMb < 1 && d.vncMb < 1;
    d.rssMb = Math.round(d.rssMb); d.xvfbMb = Math.round(d.xvfbMb);
    d.chromeMb = Math.round(d.chromeMb); d.vncMb = Math.round(d.vncMb); d.wmMb = Math.round(d.wmMb);
  }
  return displays;
}

export function parsePs(lines: string[]): { displays: DisplayRow[]; looseChromeMb: number; chromeProfiles: ChromeProfileRow[] } {
  const profileRows = new Map<string, ChromeProfileRow>();
  const byDisplay = scanDisplays(lines);
  const row = (d: string) => byDisplay.get(d) ?? byDisplay.set(d, blankRow(d)).get(d)!;
  const profileToDisplay = new Map<string, string>();
  let loose = 0;

  // Vòng hai: Chrome và window manager. Hồ sơ có dạng …/disp<N>/… hoặc …-<N> thì nối về màn hình.
  for (const raw of lines) {
    const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(raw);
    if (!m) continue;
    const [, , rssKb, args] = m;
    const mb = num(rssKb) / 1024;
    if (/(^|\/)Xvfb\s+:/.test(args) || /x11vnc/.test(args)) continue;

    if (/chrome|chromium/i.test(args)) {
      const prof = /--user-data-dir=(\S+)/.exec(args)?.[1] ?? "(hồ sơ mặc định)";
      const pr = profileRows.get(prof) ?? { profile: prof, rssMb: 0, procs: 0 };
      pr.rssMb += mb; pr.procs++;
      profileRows.set(prof, pr);
      if (prof === "(hồ sơ mặc định)") { loose += mb; continue; }
      let display = profileToDisplay.get(prof);
      if (display === undefined) {
        display = displayFromProfile(prof, byDisplay);
        profileToDisplay.set(prof, display);
      }
      if (!display) { loose += mb; continue; }
      pr.display = display;
      const r = row(display);
      r.chromeMb += mb; r.rssMb += mb; r.procs++;
      if (!r.profiles.includes(prof)) r.profiles.push(prof);
      continue;
    }
    if (/fluxbox|xfwm4|openbox/.test(args)) {
      // Window manager không ghi display trong dòng lệnh. Không gán bừa: cộng vào màn hình duy
      // nhất nếu box chỉ có một, còn không thì để ngoài — thà thiếu một con số hơn là gán sai.
      const only = byDisplay.size === 1 ? [...byDisplay.keys()][0] : null;
      if (only) { const r = row(only); r.wmMb += mb; r.rssMb += mb; r.procs++; }
      continue;
    }
  }

  const displays = finishDisplays(byDisplay);
  const chromeProfiles = [...profileRows.values()]
    .map((p) => ({ ...p, rssMb: Math.round(p.rssMb) }))
    .sort((a, b) => b.rssMb - a.rssMb);
  return { displays, looseChromeMb: Math.round(loose), chromeProfiles };
}

/**
 * Còn cấp được mấy bot nữa.
 *
 * Trả về CẢ HAI con số và nói rõ cái nào chặn trước, vì đó chính là bài học của lần đo: nhìn RAM
 * thì tưởng còn 15 chỗ, nhìn đĩa thì chỉ còn 4. Một bảng điều khiển chỉ vẽ RAM sẽ nói "còn thoải
 * mái" đúng vào lúc đĩa hết.
 */
export function headroomOf(ram: BoxSnapshot["ram"], disk: BoxSnapshot["disk"]): BoxSnapshot["headroom"] {
  const byRamBots = Math.max(0, Math.floor((ram.availableMb - RESERVE_MB) / COST_PER_BOT_MB));
  const byDiskBots = Math.max(0, Math.floor((disk.freeMb - RESERVE_MB) / PROFILE_MB));
  const bots = Math.min(byRamBots, byDiskBots);
  return { byRamBots, byDiskBots, limit: byDiskBots <= byRamBots ? "disk" : "ram", bots };
}

const EMPTY: BoxSnapshot = {
  ok: false, atMs: 0,
  ram: { totalMb: 0, usedMb: 0, freeMb: 0, availableMb: 0 },
  disk: { totalMb: 0, usedMb: 0, freeMb: 0, usedPct: 0, mount: "/" },
  displays: [], looseChromeMb: 0, chromeProfiles: [],
  headroom: { byRamBots: 0, byDiskBots: 0, limit: "disk", bots: 0 },
};

/** Một lệnh, một vòng mạng: bảng này bị mở lại mỗi mươi giây. */
const PROBE = [
  "echo '#RAM'", "free -m | sed -n '2p'",
  "echo '#DISK'", "df -m / | tail -1",
  "echo '#PS'", "ps -eo pid=,rss=,args= | grep -E 'Xvfb|x11vnc|fluxbox|xfwm4|openbox|chrome' | grep -v grep",
].join("; ");

export async function boxSnapshot(): Promise<BoxSnapshot> {
  if (!boxConfigured()) return { ...EMPTY, atMs: Date.now(), error: "chưa nối box" };
  try {
    // Hai câu hỏi song song: lệnh đo trên daemon và số dải ở router. `boxPoolStatus` không ném — nó
    // trả `null` — nên một router cũ không làm hỏng cả bảng.
    const [r, pool] = await Promise.all([boxCall<{ stdout?: string }>("exec", { command: PROBE }), boxPoolStatus()]);
    const text = String(r.stdout ?? "");
    const section = (name: string): string[] => {
      const i = text.indexOf(`#${name}`);
      if (i < 0) return [];
      const rest = text.slice(i + name.length + 1);
      const end = rest.search(/\n#[A-Z]/);
      return (end < 0 ? rest : rest.slice(0, end)).split("\n").map((l) => l.trimEnd()).filter(Boolean);
    };
    const ram = parseFree(section("RAM")[0] ?? "");
    const disk = parseDf(section("DISK")[0] ?? "");
    const { displays, looseChromeMb, chromeProfiles } = parsePs(section("PS"));
    return {
      ok: true, atMs: Date.now(), ram, disk, displays, looseChromeMb, chromeProfiles,
      headroom: headroomOf(ram, disk),
      ...(pool ? { pool } : {}),
    };
  } catch (e) {
    return { ...EMPTY, atMs: Date.now(), error: (e as Error).message };
  }
}
