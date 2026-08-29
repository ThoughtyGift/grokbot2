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
import { redact } from "./redact.js";

export type ChannelName = "local-exec" | "webauthn";

/** The host holds a poll open until it has work; answering instantly is a bug, not a fast path. */
const PARK_MS = Number(process.env.GROKBOT2_CHANNEL_PARK_MS ?? 25_000);

/** The empty batch each channel answers with on timeout — different key per channel. */
const EMPTY: Record<ChannelName, string> = {
  "local-exec": JSON.stringify({ requests: [] }),
  webauthn: JSON.stringify({ frames: [] }),
};

interface Waiter { res: ServerResponse; timer: NodeJS.Timeout }

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

  // Work already waiting: answer at once. (Never happens today; correct when it does.)
  if (ch.queue.length > 0) {
    const batch = ch.queue.splice(0, ch.queue.length);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(name === "webauthn" ? { frames: batch } : { requests: batch }));
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
  seenAtMs: number;
}
let mayNguoiDung: UserMachine | null = null;
export const connectedMachine = (): UserMachine | null => (userComputerConnected() ? mayNguoiDung : null);

/**
 * Đẩy một khung yêu cầu vào hàng đợi, đánh thức một poll đang treo nếu có.
 *
 * Trước đây hàng đợi luôn rỗng vì không có ai sinh ra việc — chú thích đầu tệp nói đúng như vậy.
 * Giờ `local-exec.ts` sinh việc, nên nhánh "trả ngay cho poll đang chờ" mới thật sự chạy.
 */
export function queueRequest(name: ChannelName, frame: unknown): void {
  const ch = channels[name];
  ch.queue.push(frame);
  const waiter = [...ch.waiters][0];
  if (!waiter) return;                     // chưa ai nối — nằm chờ trong hàng đợi
  ch.waiters.delete(waiter);
  clearTimeout(waiter.timer);
  const batch = ch.queue.splice(0, ch.queue.length);
  try {
    waiter.res.writeHead(200, { "content-type": "application/json" });
    waiter.res.end(JSON.stringify(name === "webauthn" ? { frames: batch } : { requests: batch }));
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

/** Chờ khung trả lời mang đúng `requestId`. Hết giờ thì trả `null` chứ không treo mãi. */
export function waitForResponse(requestId: string, timeoutMs: number): Promise<Record<string, unknown> | null> {
  return new Promise((res) => {
    const hen = setTimeout(() => { dangCho.delete(requestId); res(null); }, timeoutMs);
    dangCho.set(requestId, (frame) => { clearTimeout(hen); dangCho.delete(requestId); res(frame); });
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
  // Đánh thức người đang chờ. `requestId` là tên protobuf-JSON; `request_id` là dạng snake_case —
  // nhận cả hai vì bộ mã hoá bên kia có thể đổi mà ta không biết.
  for (const f of tanRa(payload)) {
    // `hello` là lời tự khai của máy, không phải trả lời cho ai — nhớ lại để dùng làm `machineId`.
    if (name === "local-exec" && f.kind === "hello" && typeof f.computerId === "string") {
      mayNguoiDung = {
        computerId: f.computerId,
        label: String(f.label ?? f.computerId),
        ...(typeof f.localRoot === "string" ? { localRoot: f.localRoot } : {}),
        ...(typeof f.terminalsFolder === "string" ? { terminalsFolder: f.terminalsFolder } : {}),
        ...(typeof f.supervised === "boolean" ? { supervised: f.supervised } : {}),
        ...(typeof f.variant === "string" ? { variant: f.variant } : {}),
        seenAtMs: Date.now(),
      };
      console.log(`[grokbot2] [local-exec] máy người dùng nối vào: ${mayNguoiDung.label} (${mayNguoiDung.computerId})`);
      /*
       * Đáp lễ `welcome`.
       *
       * Bộ khung yêu cầu có sẵn một nhánh `{kind:"welcome", providerId}` không mang `requestId` —
       * tức nó không phải một việc, mà là lời xác nhận "đã ghi nhận máy này". Khung `welcome` cũng
       * có trong giao thức webauthn y hệt, nên đây là bắt tay chung của cả hai kênh.
       *
       * Đo trước khi thêm: gửi thẳng `exec` sau `hello` thì daemon nuốt im, không một khung trả lời
       * nào — kể cả khi `machineId` đã đúng.
       */
      queueRequest(name, { kind: "welcome", providerId: mayNguoiDung.computerId });
      continue;
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
