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
      shellArgs: {
        command: op.command,
        workingDirectory: op.cwd ?? cwdCuaMay.get(machineId) ?? "",
        timeout: Math.round(Math.min(op.timeoutMs ?? 30_000, MAX_TIMEOUT_MS) / 1000),
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

  const khung = await waitForResponse(requestId, timeoutMs);
  if (!khung) {
    return {
      ok: false,
      error: `máy tính của bạn không trả lời trong ${Math.round(timeoutMs / 1000)}s`
        + " (daemon có thể đã ngắt kết nối, hoặc lệnh chạy quá lâu)",
    };
  }

  // Khung trả lời cũng mang `kind`: hello · client · control · file · file-error · ping.
  const kind = String(khung.kind ?? "");
  if (kind === "file-error") return { ok: false, error: JSON.stringify(khung).slice(0, 300) };

  const cwd = khung.cwdState;
  if (typeof cwd === "string" && cwd) cwdCuaMay.set(machineId, cwd);
  const keo = typeof cwd === "string" && cwd ? { cwd } : {};

  // `clientMessage`/`controlMessage` là phần thân; tên trường chưa đo được chắc nên nhận nhiều
  // biến thể và, cùng lắm, trả nguyên khung — thà đưa lên thứ đọc được còn hơn nuốt mất.
  const than = khung.clientMessage ?? khung.controlMessage ?? khung.message ?? khung.messageJson;
  if (typeof than === "string") {
    try { return { ok: true, data: JSON.parse(than), ...keo }; } catch { return { ok: true, data: than, ...keo }; }
  }
  if (than != null) return { ok: true, data: than, ...keo };
  return { ok: true, data: khung, ...keo };
}

/** Máy người dùng có đang nối không — nơi gọi cần biết để nói câu từ chối cho tử tế. */
export { userComputerConnected, connectedMachine } from "./channels.js";
