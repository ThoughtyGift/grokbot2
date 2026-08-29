/**
 * Chạy việc trên MÁY CỦA NGƯỜI DÙNG — `GrokBotUserComputer`.
 *
 * Khác `box-exec.ts` ở chỗ căn bản: box là "máy của bot", còn đây là máy Windows/mac người dùng
 * đang ngồi, nơi có OBS, có Chrome đã đăng nhập, có tệp thật. App gốc gọi đó là *"your computer"*
 * và gọi box là *"your own computer (Shell, Read, AwaitShell)"* — hai máy, hai đường.
 *
 * ── Đường ống đã có sẵn ba phần tư ──────────────────────────────────────────────────────────────
 *
 * Daemon (`dist/local-exec-daemon/main.cjs`, 3,4 MB) đi kèm chính client ta chạy, và nó ĐANG treo
 * một long-poll vào `/gw/local-exec/requests` — đo ngày 30/08: `parkedPolls: 1, queued: 0`. Nghĩa
 * là suốt thời gian qua nó chờ việc mà ta chưa từng gửi.
 *
 * ── Hợp đồng trên dây, đo từ chính daemon ───────────────────────────────────────────────────────
 *
 * KHÔNG phải protobuf. Cửa HTTP này nói JSON `{frames:[{kind:…}]}`, y hệt kênh webauthn. Daemon tự
 * khai ngay lần bắt tay:
 *
 *     {"kind":"hello","label":"DESKTOP-7D2FJG8","computerId":"ae95f374-…",
 *      "localRoot":"C:\Users\admin","terminalsFolder":"…","supervised":true,"variant":"sand"}
 *
 * và schema zod trong daemon cho biết ta được gửi gì:
 *
 *     {kind:"exec", requestId, serverMessage, approvalId?} | upload | download
 *     | retire-approval | cancel | welcome
 *     trả về: kind ∈ hello · client · control · file · file-error · ping
 *
 * Bộ `aiserver.v1.GrokBotUserComputer*` bóc được trong daemon là hợp đồng của đường LÊN MÁY CHỦ
 * HÃNG, không phải cửa này — tôi đã xây nhầm tầng một lần. Nội dung `serverMessage` vẫn là một
 * `agent.v1.ExecServerMessage` (`{execId, machineId, shellArgs:{command, workingDirectory,…}}`).
 *
 * Xem `scripts/extract-user-computer.mjs` và `docs/extracted/user-computer-proto.json`.
 *
 * ── CHƯA CHẠY ĐƯỢC ĐẦU-CUỐI ─────────────────────────────────────────────────────────────────────
 *
 * Đo 30/08: daemon nhận khung (hàng đợi rút về 0, nó poll lại) nhưng KHÔNG trả lời khung nào. Đã
 * thử và loại bốn giả thuyết: `machineId` rỗng, thiếu bắt tay `welcome`, `serverMessage` dạng
 * object, `serverMessage` dạng chuỗi JSON. Nghi phạm còn lại đáng thử: `approvalId` — daemon có
 * chuỗi *"That action was not approved on the user's computer, so nothing ran"*, nên nhiều khả năng
 * nó chờ một mã duyệt do máy chủ cấp mà ta chưa cấp.
 *
 * ── Vì sao chỉ ba thao tác ──────────────────────────────────────────────────────────────────────
 *
 * Sổ đăng ký khai 40 cặp Args→Result, nhưng đó là bảng mã dùng CHUNG với box host. Đếm số lần
 * xuất hiện trong chính daemon thì chỉ 8 thao tác có thân xử lý — shell và đọc tệp. `computerUse`
 * và `recordScreen` chỉ có đúng 2 lần, cả hai ở dòng đăng ký codec, và trong 3,4 MB không có một
 * chữ `SendInput`/`user32`/`SendKeys`/`robotjs` nào. Daemon của hãng KHÔNG bấm chuột được; nó chạy
 * lệnh. App gốc lái OBS bằng dòng lệnh, không bằng con trỏ.
 */
import { randomUUID } from "node:crypto";
import { queueRequest, waitForResponse, connectedMachine } from "./channels.js";

/** Bằng `JM` trong daemon (12e4). Lệnh dài hơn hai phút thì nên chạy nền, không nên treo lượt. */
const MAX_TIMEOUT_MS = 120_000;

export type LocalOp =
  | { kind: "shell"; command: string; cwd?: string; timeoutMs?: number }
  | { kind: "read"; path: string }
  | { kind: "ls"; path: string };

export interface LocalResult {
  ok: boolean;
  /** Nguyên văn `message_json` daemon trả về, đã parse nếu đọc được. */
  data?: unknown;
  /** Thư mục làm việc sau lệnh — daemon gửi kèm ở `control.cwd_state`. Xem `ghiNhoCwd`. */
  cwd?: string;
  error?: string;
}

/**
 * Thư mục làm việc còn lại sau lệnh trước.
 *
 * Hãng giải bài toán "mỗi lệnh một shell mới" bằng cách kết xuất trạng thái PowerShell ra tệp rồi
 * nạp lại (`Dump-PowerShellState` trong daemon), và gửi thư mục hiện hành về trong `cwd_state`.
 * Ta chưa nạp lại trạng thái, nhưng GIỮ cwd thì đã đủ để `cd` của lệnh trước không bốc hơi — đúng
 * cái bẫy đã làm bot mò ba lần khi tìm video trên box.
 */
const cwdCuaMay = new Map<string, string>();

/** `ExecServerMessage` ở dạng protobuf-JSON (lowerCamelCase). Chỉ ba nhánh ta thật sự dùng. */
function serverMessage(op: LocalOp, machineId: string, execId: string): Record<string, unknown> {
  const base = { id: 1, execId, machineId };
  if (op.kind === "shell") {
    return {
      ...base,
      // `shellArgs` KHÔNG có handler trong daemon — nó tự nói: "No handler found for server message
      // of type shellArgs". Hai tên thật là `shellStreamArgs` và `backgroundShellSpawnArgs`, xác
      // nhận bởi `shellWorkingDirectoryTarget`:
      //     if (r.case !== "shellStreamArgs" && r.case !== "backgroundShellSpawnArgs") return "unset";
      // và `cwd:"unset"` ta nhận về lần đầu chính là dòng đó trả lời cho case sai.
      shellStreamArgs: {
        command: op.command,
        workingDirectory: op.cwd ?? cwdCuaMay.get(machineId) ?? "",
        // MILI-GIÂY, không phải giây. Gửi `30` tưởng là 30s thì daemon huỷ lệnh sau 48ms và trả
        // `{"exit":{"aborted":true,"abortReason":"SHELL_ABORT_REASON_TIMEOUT"}}` — đo được đúng vậy.
        timeout: Math.min(op.timeoutMs ?? 30_000, MAX_TIMEOUT_MS),
        toolCallId: execId,
      },
    };
  }
  if (op.kind === "read") return { ...base, readArgs: { path: op.path } };
  return { ...base, lsArgs: { path: op.path } };
}

/** Hành động tương ứng cho thẻ xin quyền — khớp `describeLocalExec` của daemon. */
export function actionOf(op: LocalOp): "run-command" | "read-file" | "list-directory" {
  if (op.kind === "shell") return "run-command";
  if (op.kind === "read") return "read-file";
  return "list-directory";
}

/** Thứ hiện trên thẻ quyền: lệnh, hoặc đường dẫn. */
export function targetOf(op: LocalOp): string {
  return op.kind === "shell" ? op.command : op.path;
}

/**
 * Gửi một việc xuống máy người dùng và chờ trả lời.
 *
 * KHÔNG tự xin quyền ở đây. Nơi gọi phải xin trước — tách ra vì quyền là quyết định của người,
 * còn hàm này chỉ là dây dẫn; trộn hai thứ là cách một đường tắt lọt vào sau này mà không ai thấy.
 */
export async function runOnUserComputer(
  op: LocalOp,
  opts: { machineId?: string; approvalId?: string; authorizedByStanding?: boolean; timeoutMs?: number } = {},
): Promise<LocalResult> {
  // `machineId` PHẢI là id máy tự khai trong khung `hello`: daemon so nó trước khi nhận việc
  // (`localToolApprovalCovers` mở đầu bằng `t.machineId !== e.machineId`). Gửi chuỗi rỗng thì
  // nó nuốt yêu cầu không một lời — đo được đúng như vậy trước khi sửa.
  const machineId = opts.machineId ?? connectedMachine()?.computerId ?? "";
  const requestId = randomUUID();
  const timeoutMs = Math.min(opts.timeoutMs ?? (op.kind === "shell" ? 60_000 : 20_000), MAX_TIMEOUT_MS);

  /*
   * Khung đi trên dây là JSON `{kind:…}`, KHÔNG phải `GrokBotUserComputerRequestFrame`.
   *
   * Bản đầu của tệp này dựng khung theo bộ mô tả protobuf bóc từ daemon — và daemon lặng lẽ bỏ
   * qua. Nó tự khai hình dạng thật ngay lần bắt tay:
   *
   *     {"frames":[{"kind":"hello","label":"DESKTOP-7D2FJG8","localRoot":"C:\\Users\\admin",…}]}
   *
   * rồi schema zod trong chính daemon xác nhận:
   *
   *     {kind:"exec", requestId, serverMessage, approvalId?} | upload | download
   *     | retire-approval | cancel | welcome
   *
   * Bộ `aiserver.v1.GrokBotUserComputer*` là hợp đồng của đường LÊN MÁY CHỦ HÃNG, không phải cửa
   * HTTP này. Hai tầng khác nhau, và tôi đã xây nhầm tầng một lần.
   */
  queueRequest("local-exec", {
    kind: "exec",
    requestId,
    serverMessage: serverMessage(op, machineId, requestId),
    ...(opts.approvalId ? { approvalId: opts.approvalId } : {}),
  });

  /*
   * Shell là LUỒNG; đọc/liệt kê thì một khung là xong.
   *
   * Khung đầu của shell chỉ là `{"shellStream":{"start":{"sandboxPolicy":…}}}`. Đầu ra thật và mã
   * thoát tới ở các khung sau, và daemon đóng luồng bằng `streamClose` (hoặc `throw` nếu hỏng).
   */
  const laShell = op.kind === "shell";
  const khungs = await waitForResponse(requestId, timeoutMs, (f) => {
    if (!laShell) return true;
    const m = thanCua(f);
    return m != null && ("streamClose" in m || "throw" in m);
  });

  if (!khungs.length) {
    return {
      ok: false,
      error: `máy tính của bạn không trả lời trong ${Math.round(timeoutMs / 1000)}s`
        + " (daemon có thể đã ngắt kết nối, hoặc lệnh chạy quá lâu)",
    };
  }

  const cuoiCung = khungs[khungs.length - 1];
  const cwd = cuoiCung.cwdState ?? khungs.find((f) => typeof f.cwdState === "string" && f.cwdState !== "unset")?.cwdState;
  if (typeof cwd === "string" && cwd && cwd !== "unset") cwdCuaMay.set(machineId, cwd);
  const keo = typeof cwd === "string" && cwd && cwd !== "unset" ? { cwd } : {};

  const thans = khungs.map(thanCua).filter((x): x is Record<string, unknown> => x != null);
  const nem = thans.find((m) => m.throw != null);
  if (nem) return { ok: false, error: String((nem.throw as Record<string, unknown>)?.error ?? "lỗi không rõ").slice(0, 500), ...keo };
  if (khungs.some((f) => String(f.kind ?? "") === "file-error")) {
    return { ok: false, error: JSON.stringify(khungs[khungs.length - 1]).slice(0, 300), ...keo };
  }

  if (!laShell) return { ok: true, data: thans[0] ?? cuoiCung, ...keo };
  return { ok: true, data: gomLuongShell(thans), ...keo };
}

/** Thân bên trong một khung trả lời — daemon gói nó dưới vài tên khác nhau tuỳ loại khung. */
function thanCua(f: Record<string, unknown>): Record<string, unknown> | null {
  const t = f.clientMessage ?? f.controlMessage ?? f.message ?? f.messageJson;
  if (typeof t === "string") { try { return JSON.parse(t) as Record<string, unknown>; } catch { return null; } }
  if (t != null && typeof t === "object") return t as Record<string, unknown>;
  // Khung `client` phẳng: chính nó đã là thân (đo được: `{"id":6,"shellStream":{…}}`).
  return "shellStream" in f || "readResult" in f || "lsResult" in f || "throw" in f || "streamClose" in f
    ? f : null;
}

/**
 * Ghép các khung `shellStream` thành một kết quả đọc được.
 *
 * Hình dạng từng nhánh đo bằng chính luồng thật, không đoán: khung `start` mang `sandboxPolicy`,
 * còn stdout/stderr/exit là các nhánh riêng. Nhánh nào chưa gặp thì giữ nguyên trong `khac` để lần
 * sau còn đọc được nó là gì, thay vì nuốt mất.
 */
function gomLuongShell(thans: Record<string, unknown>[]): Record<string, unknown> {
  let out = "", err = "";
  let exitCode: number | undefined;
  let cwdSau: string | undefined;
  let huy: string | undefined;
  const khac: unknown[] = [];
  for (const m of thans) {
    const st = m.shellStream as Record<string, unknown> | undefined;
    // `heartbeat` là nhịp giữ luồng của daemon, không phải đầu ra — bỏ qua, đừng báo là lạ.
    if (!st) { if (!("streamClose" in m) && !("heartbeat" in m)) khac.push(m); continue; }
    for (const [k, v] of Object.entries(st)) {
      const val = v as Record<string, unknown>;
      if (k === "stdout") out += String(val?.data ?? val?.text ?? val?.chars ?? "");
      else if (k === "stderr") err += String(val?.data ?? val?.text ?? val?.chars ?? "");
      else if (k === "exit" || k === "exited") {
        exitCode = Number(val?.code ?? val?.exitCode ?? 0);
        // `cwd` về ở ĐÂY, không ở `cwdState`: {"exit":{"cwd":"C:\Users\admin",…}}
        if (typeof val?.cwd === "string" && val.cwd) cwdSau = val.cwd;
        if (val?.aborted === true) huy = String(val.abortReason ?? "aborted");
      }
      else if (k !== "start") khac.push({ [k]: v });
    }
  }
  return {
    stdout: out, stderr: err,
    ...(exitCode !== undefined ? { exitCode } : {}),
    ...(cwdSau ? { cwd: cwdSau } : {}),
    ...(huy ? { aborted: huy } : {}),
    ...(khac.length ? { khungChuaHieu: khac.slice(0, 6) } : {}),
  };
}

/** Máy người dùng có đang nối không, và nó tự khai là máy nào — cho nơi gọi nói câu từ chối tử tế. */
export { userComputerConnected, connectedMachine } from "./channels.js";
