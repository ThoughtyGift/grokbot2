/**
 * The two request/response channels the host exposes: `local-exec` and `webauthn`.
 *
 * Both are the same shape, and the host's own router shows it:
 *
 *   GET  /local-exec/requests   → T3s: register a provider, stream requests to it
 *   POST /local-exec/responses  → b3s: `r.submitResponses(o); ZOt(n,{ok:true})`
 *   GET  /webauthn/requests     → _3s: same
 *   POST /webauthn/responses    → I3s: same
 *
 * and when the channel is absent it answers `404 "<name> channel not enabled"` rather than
 * pretending. Both require gateway authentication in the host — the only two routes that do
 * unconditionally.
 *
 * We had the `requests` halves (parked long polls) and **neither** `responses` half, which the
 * observe pass caught the app actually using:
 *
 *     POST /gw/webauthn/responses    {"frames":[{"kind":"ping"}]}
 *     POST /gw/local-exec/responses  ×2
 *
 * Those went into the `200 {}` fallback and vanished. The app got a success it could not act on.
 *
 * What this module does NOT do is implement WebAuthn or local execution. Nothing here issues a
 * request, because this backend has no provider to run one — shell and file work go to the box
 * exec daemon instead (box-exec.ts). So the queue is legitimately always empty. What it does do
 * is close the loop honestly: park a poll, accept the responses the app posts, answer `{ok:true}`
 * the way the host does, and KEEP what arrived so the frame shapes can be read rather than
 * guessed the way `{"frames":[{"kind":"ping"}]}` had to be.
 */
import type { ServerResponse } from "node:http";
import { nhoMay } from "./may-da-biet.js";
import { randomUUID } from "node:crypto";
import { redact } from "./redact.js";

export type ChannelName = "local-exec" | "webauthn";

/** The host holds a poll open until it has work; answering instantly is a bug, not a fast path. */
const PARK_MS = Number(process.env.GROKBOT2_CHANNEL_PARK_MS ?? 25_000);

/** The empty batch each channel answers with on timeout — different key per channel. */
const EMPTY: Record<ChannelName, string> = {
  "local-exec": JSON.stringify({ requests: [] }),
  webauthn: JSON.stringify({ frames: [] }),
};

/**
 * `timer` là setTimeout cho long-poll JSON, hoặc setInterval giữ nhịp cho luồng SSE.
 *
 * `providerId` chỉ có ở `local-exec`, và nó là chìa khoá cho NHIỀU MÁY: ta sinh nó ngay khi luồng
 * mở rồi gửi xuống bằng khung `welcome`; daemon nhớ (`this.providerId = e.providerId`) và đính nó
 * vào MỌI lần POST sau đó. Nhờ vậy một câu trả lời ghép được về đúng luồng, đúng máy — không thì
 * hai máy cùng nối là ta gửi việc cho máy này rồi đọc câu trả lời của máy kia.
 */
interface Waiter { res: ServerResponse; timer: NodeJS.Timeout; providerId?: string }

interface Channel {
  waiters: Set<Waiter>;
  /** Requests waiting for a provider to pick them up. Always empty today — see the note above. */
  queue: unknown[];
  /** Frames the app has posted back, newest last. Bounded: this is a diagnostic, not a store. */
  received: { atMs: number; payload: unknown }[];
  /** Total responses accepted, for the coverage report. */
  submitted: number;
}

const MAX_RECEIVED = 20;

const channels: Record<ChannelName, Channel> = {
  "local-exec": { waiters: new Set(), queue: [], received: [], submitted: 0 },
  webauthn: { waiters: new Set(), queue: [], received: [], submitted: 0 },
};

/**
 * Both channels are enabled: we answer their `requests` polls, so claiming otherwise and
 * returning the host's 404 would be a lie in the other direction.
 */
export const isChannelEnabled = (_name: ChannelName): boolean => true;

/** Park a `requests` poll. Resolves with an empty batch on timeout, or early if work arrives. */
export function parkRequests(name: ChannelName, res: ServerResponse): void {
  const ch = channels[name];

  /*
   * `local-exec` là SSE, không phải long-poll JSON.
   *
   * Đây là chỗ đã nuốt mọi yêu cầu của ta trong im lặng. Daemon đọc luồng này theo khối SSE:
   *
   *     dispatchEventBlock(e){
   *       const r = e.split("\n").filter(i => i.startsWith("data:")).map(i => i.slice(5).trim());
   *       if (r.length === 0) return;                    // ← không có dòng `data:` thì BỎ QUA
   *       try { n = tge(JSON.parse(r.join("\n"))) } catch { console.error("dropping…"); return }
   *     }
   *
   * và vòng đọc tách khối theo `\n\n`. Ta thì trả một thân `{"requests":[…]}` rồi đóng — không
   * dòng `data:` nào, nên daemon bỏ qua không một lời rồi nối lại. Đo được đúng như vậy: hàng đợi
   * rút về 0, `parkedPolls` trở lại 1, và không khung trả lời nào.
   *
   * `webauthn` giữ nguyên đường JSON: chưa đo được nó, và đoán hai lần một lúc là cách không biết
   * cái nào hỏng.
   */
  if (name === "local-exec") {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
      // Luồng này chạy sau proxy nào cũng không được gom đệm, kẻo khung nằm lại trong bộ đệm.
      "x-accel-buffering": "no",
    });
    const providerId = randomUUID();
    const waiter: Waiter = {
      res,
      providerId,
      // Giữ mở, không hết giờ. Nhịp giữ nhịp là dòng chú thích SSE (`:`), daemon bỏ qua nó vì
      // không bắt đầu bằng `data:`.
      timer: setInterval(() => { try { res.write(":\n\n"); } catch { /* đứt rồi */ } }, PARK_MS),
    };
    ch.waiters.add(waiter);
    res.on("close", () => {
      clearInterval(waiter.timer);
      ch.waiters.delete(waiter);
      // Máy rời đi thì bỏ khỏi danh sách hiện diện. Giữ lại một `label` sau khi luồng đứt là nói
      // dối bảng Computer: nó sẽ hiện một máy không còn nhận việc được nữa.
      for (const [id, m] of mayDangNoi) if (m.providerId === providerId) mayDangNoi.delete(id);
    });
    /*
     * Chào TRƯỚC, không đợi `hello`.
     *
     * Bản trước gửi `welcome` khi thấy `hello` — chạy được với MỘT máy, nhưng với nhiều máy thì
     * `hello` không nói nó đến từ luồng nào, nên không ghép được. Gửi trước thì daemon nhớ
     * `providerId` của ta và đính vào mọi POST sau, kể cả `hello`.
     */
    try { res.write(`data: ${JSON.stringify({ kind: "welcome", providerId })}\n\n`); } catch { /* đứt ngay */ }
    // Việc đã xếp hàng từ trước lúc nối: đẩy ra ngay.
    if (ch.queue.length) {
      const batch = ch.queue.splice(0, ch.queue.length);
      for (const f of batch) { try { res.write(`data: ${JSON.stringify(f)}\n\n`); } catch { ch.queue.unshift(f); } }
    }
    return;
  }

  // Work already waiting: answer at once. (Never happens today; correct when it does.)
  if (ch.queue.length > 0) {
    const batch = ch.queue.splice(0, ch.queue.length);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ frames: batch }));
    return;
  }

  const waiter: Waiter = {
    res,
    timer: setTimeout(() => {
      ch.waiters.delete(waiter);
      try {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(EMPTY[name]);
      } catch { /* client gone */ }
    }, PARK_MS),
  };
  ch.waiters.add(waiter);
  res.on("close", () => { clearTimeout(waiter.timer); ch.waiters.delete(waiter); });
}

/**
 * Máy của người dùng có đang nối không.
 *
 * "Nối" = có một long-poll đang treo trên `local-exec/requests`. Đo được ngày 30/08:
 * `parkedPolls: 1` trong khi `queued: 0, submitted: 0` — daemon chờ suốt mà ta chưa từng gửi việc.
 *
 * Nơi gọi cần biết để nói câu từ chối cho tử tế: "máy bạn đang tắt app" khác hẳn "lệnh chạy hỏng".
 */
export const userComputerConnected = (): boolean => channels["local-exec"].waiters.size > 0;

/**
 * Máy người dùng vừa tự khai gì — lấy từ khung `hello` daemon gửi ngay khi nối.
 *
 * Đo được nguyên văn ngày 30/08:
 *
 *     {"kind":"hello","label":"DESKTOP-7D2FJG8","computerId":"ae95f374-…",
 *      "localRoot":"C:\\Users\\admin","terminalsFolder":"C:\\Users\\admin\\terminals",
 *      "supervised":true,"variant":"sand"}
 *
 * `label` chính là chuỗi bảng Setting → Computer của app gốc hiển thị, và `computerId` là thứ mọi
 * yêu cầu phải mang theo — daemon so `machineId` trước khi nhận việc (`localToolApprovalCovers`).
 */
export interface UserMachine {
  computerId: string;
  label: string;
  localRoot?: string;
  terminalsFolder?: string;
  supervised?: boolean;
  variant?: string;
  /**
   * Mức quyền máy đó đang để — `Settings → Execution on Local Computer` phía app.
   *
   * Daemon gửi sẵn trong `hello`, và ta bỏ qua nó suốt. Không đọc thì khi daemon từ chối, bot chỉ
   * trả về *"That action was not approved on the user's computer"* — đúng nhưng người dùng không
   * biết phải làm gì. Đọc rồi thì bot nói được máy nào đang để mức nào.
   */
  standing?: string;
  seenAtMs: number;
  /** Luồng SSE nào đang giữ máy này. Rời đi thì bản ghi bị gỡ — xem `res.on("close")`. */
  providerId: string;
}

/**
 * Mọi máy đang nối, khoá theo `computerId`.
 *
 * App gốc nối được NHIỀU máy cùng lúc — ảnh Settings → Computer của người dùng hiện cả
 * `DESKTOP-7D2FJG8` lẫn `Admin-PC`, và cờ tính năng tên thẳng là `sand_multi_machine_local_exec`.
 * Hợp đồng cũng nói vậy: `ListGrokBotUserComputers` trả một MẢNG `GrokBotUserComputerPresence
 * { machine_id, hello, last_seen_at_ms }`.
 *
 * Bản trước giữ đúng một biến, nên máy nối sau ghi đè máy nối trước và mọi việc chảy nhầm chỗ.
 */
const mayDangNoi = new Map<string, UserMachine>();

/** Máy để dùng khi không ai chỉ định — máy vừa thấy gần nhất. */
export const connectedMachine = (): UserMachine | null => {
  let moiNhat: UserMachine | null = null;
  for (const m of mayDangNoi.values()) if (!moiNhat || m.seenAtMs > moiNhat.seenAtMs) moiNhat = m;
  return moiNhat;
};

/** Danh sách máy cho bảng Settings → Computer, mới thấy trước. */
export const connectedMachines = (): UserMachine[] =>
  [...mayDangNoi.values()].sort((a, b) => b.seenAtMs - a.seenAtMs);

/** Tìm một máy theo id hoặc theo tên hiển thị — người dùng gọi tên, model có thể gọi id. */
export function findMachine(idHoacTen: string): UserMachine | null {
  const s = idHoacTen.trim();
  if (!s) return null;
  const theoId = mayDangNoi.get(s);
  if (theoId) return theoId;
  const thap = s.toLowerCase();
  return [...mayDangNoi.values()].find((m) => m.label.toLowerCase() === thap)
    ?? [...mayDangNoi.values()].find((m) => m.label.toLowerCase().includes(thap))
    ?? null;
}

/**
 * Đẩy một khung yêu cầu vào hàng đợi, đánh thức một poll đang treo nếu có.
 *
 * Trước đây hàng đợi luôn rỗng vì không có ai sinh ra việc — chú thích đầu tệp nói đúng như vậy.
 * Giờ `local-exec.ts` sinh việc, nên nhánh "trả ngay cho poll đang chờ" mới thật sự chạy.
 */
export function queueRequest(name: ChannelName, frame: unknown, machineId?: string): void {
  const ch = channels[name];

  // SSE: ghi vào luồng đang mở và GIỮ nó mở. Đóng luồng sau mỗi khung là bắt daemon nối lại mỗi
  // lệnh, và tệ hơn, khung tiếp theo không có đường đi cho tới khi nó nối xong.
  if (name === "local-exec") {
    /*
     * Gửi đúng MÁY, không phải "luồng đầu tiên trong Set".
     *
     * Với một máy thì hai thứ đó trùng nhau, nên bản trước chạy được. Với nhiều máy thì lấy phần
     * tử đầu của một `Set` là chọn bừa: việc dành cho *Admin-PC* có thể chạy trên
     * *DESKTOP-7D2FJG8*. Không có cách nào phát hiện từ bên ngoài, vì cả hai đều trả về một kết
     * quả trông hợp lệ.
     */
    const may = machineId ? mayDangNoi.get(machineId) : null;
    const waiter = may
      ? [...ch.waiters].find((w) => w.providerId === may.providerId)
      : [...ch.waiters][0];
    if (!waiter) {
      // Chỉ định một máy không nối thì KHÔNG xếp hàng: hàng đợi không mang theo địa chỉ, nên khung
      // ấy sẽ rơi vào máy nối tiếp theo — máy nào cũng được. Thà mất còn hơn chạy nhầm máy.
      if (machineId) { console.warn(`[grokbot2] [local-exec] bỏ khung: máy ${machineId} không nối`); return; }
      ch.queue.push(frame);
      return;
    }
    try { waiter.res.write(`data: ${JSON.stringify(frame)}\n\n`); } catch { if (!machineId) ch.queue.push(frame); }
    return;
  }

  const waiter = [...ch.waiters][0];
  if (!waiter) { ch.queue.push(frame); return; }   // chưa ai nối — nằm chờ trong hàng đợi

  ch.queue.push(frame);
  ch.waiters.delete(waiter);
  clearTimeout(waiter.timer);
  const batch = ch.queue.splice(0, ch.queue.length);
  try {
    waiter.res.writeHead(200, { "content-type": "application/json" });
    waiter.res.end(JSON.stringify({ frames: batch }));
  } catch {
    // Poll đã đứt giữa chừng: trả việc lại hàng đợi cho lần nối sau, đừng nuốt.
    ch.queue.unshift(...batch);
  }
}

/**
 * Ai đang chờ trả lời, theo `requestId`.
 *
 * Tách khỏi `received` (vốn chỉ là bộ đệm chẩn đoán, giới hạn 20 mục): một câu trả lời tới muộn
 * sau khi bộ đệm đã cuộn qua thì vẫn phải đánh thức đúng người chờ.
 */
const dangCho = new Map<string, (frame: Record<string, unknown>) => void>();

/**
 * Chờ khung trả lời mang đúng `requestId`. Hết giờ thì trả mảng rỗng chứ không treo mãi.
 *
 * `xong` quyết định khi nào đủ. Một thao tác đọc trả đúng một khung, nhưng shell là LUỒNG: khung
 * đầu chỉ là `{"shellStream":{"start":…}}`, còn stdout và mã thoát tới ở các khung sau cho tới
 * `streamClose`. Lấy khung đầu rồi thôi là mất sạch đầu ra — đo được đúng như vậy.
 */
export function waitForResponse(
  requestId: string,
  timeoutMs: number,
  xong: (frame: Record<string, unknown>, daCo: Record<string, unknown>[]) => boolean = () => true,
): Promise<Record<string, unknown>[]> {
  return new Promise((res) => {
    const gom: Record<string, unknown>[] = [];
    const hen = setTimeout(() => { dangCho.delete(requestId); res(gom); }, timeoutMs);
    dangCho.set(requestId, (frame) => {
      gom.push(frame);
      if (!xong(frame, gom)) return;
      clearTimeout(hen);
      dangCho.delete(requestId);
      res(gom);
    });
  });
}

/** Khung trả lời có thể tới lẻ hoặc theo lô, và tên trường thì tuỳ bộ mã hoá — nhận cả hai. */
function tanRa(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload as Record<string, unknown>[];
  if (payload && typeof payload === "object") {
    const o = payload as Record<string, unknown>;
    for (const k of ["responses", "frames", "requests"]) {
      if (Array.isArray(o[k])) return o[k] as Record<string, unknown>[];
    }
    return [o];
  }
  return [];
}

/**
 * Accept a `responses` POST.
 *
 * The host's handler parses the body, hands it to the channel and answers `{ok:true}` — it does
 * not validate the frames, so neither do we. An unparseable body is still recorded, because a
 * body we cannot read is exactly the thing worth seeing.
 */
export function submitResponses(name: ChannelName, body: Buffer): { ok: true } {
  const ch = channels[name];
  let payload: unknown;
  try {
    payload = body.length ? JSON.parse(body.toString("utf8")) : null;
  } catch {
    payload = { unparseable: redact(body.toString("utf8").slice(0, 300)) };
  }
  ch.submitted += 1;
  ch.received.push({ atMs: Date.now(), payload });
  while (ch.received.length > MAX_RECEIVED) ch.received.shift();
  // Máy nào gửi. Daemon đính `providerId` ta cấp lúc `welcome` vào mọi POST — đó là thứ ghép câu
  // trả lời về đúng máy khi có nhiều máy cùng nối.
  const nguoiGui = typeof (payload as { providerId?: unknown })?.providerId === "string"
    ? String((payload as { providerId: string }).providerId) : "";
  // Đánh thức người đang chờ. `requestId` là tên protobuf-JSON; `request_id` là dạng snake_case —
  // nhận cả hai vì bộ mã hoá bên kia có thể đổi mà ta không biết.
  for (const f of tanRa(payload)) {
    // `hello` là lời tự khai của máy, không phải trả lời cho ai — nhớ lại để dùng làm `machineId`.
    if (name === "local-exec" && f.kind === "hello" && typeof f.computerId === "string") {
      const may: UserMachine = {
        computerId: f.computerId,
        label: String(f.label ?? f.computerId),
        ...(typeof f.localRoot === "string" ? { localRoot: f.localRoot } : {}),
        ...(typeof f.terminalsFolder === "string" ? { terminalsFolder: f.terminalsFolder } : {}),
        ...(typeof f.supervised === "boolean" ? { supervised: f.supervised } : {}),
        ...(typeof f.variant === "string" ? { variant: f.variant } : {}),
        ...(typeof f.standing === "string" ? { standing: f.standing } : {}),
        seenAtMs: Date.now(),
        providerId: nguoiGui,
      };
      mayDangNoi.set(may.computerId, may);
      // Nhớ sang sổ BỀN nữa: bảng Settings → Computer hỏi một lần lúc app khởi động, mà lúc đó
      // daemon chưa kịp nối. Xem `may-da-biet.ts` để biết vì sao hai sổ chứ không phải một.
      nhoMay({ computerId: may.computerId, label: may.label, ...(may.standing ? { standing: may.standing } : {}) });
      console.log(`[grokbot2] [local-exec] máy nối vào: ${may.label} (${may.computerId}) — đang có ${mayDangNoi.size} máy`);
      continue;
    }
    // Mọi khung khác cũng là dấu hiệu máy còn sống (`ping` gửi đều đặn) — cập nhật giờ thấy cuối.
    if (name === "local-exec" && nguoiGui) {
      for (const m of mayDangNoi.values()) if (m.providerId === nguoiGui) m.seenAtMs = Date.now();
    }
    const id = String(f.requestId ?? f.request_id ?? "");
    const goi = id && dangCho.get(id);
    if (goi) goi(f);
  }
  return { ok: true };
}

/** What each channel has seen — surfaced through `/gw/__coverage` so the shapes are readable. */
export const channelSnapshot = () =>
  Object.fromEntries(
    (Object.keys(channels) as ChannelName[]).map((name) => [
      name,
      {
        enabled: isChannelEnabled(name),
        parkedPolls: channels[name].waiters.size,
        queued: channels[name].queue.length,
        submitted: channels[name].submitted,
        // Newest first: the most recent frame is the one being debugged.
        recent: [...channels[name].received].reverse().slice(0, 5),
      },
    ]),
  );
