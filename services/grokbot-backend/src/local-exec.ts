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
 * ── Đã chạy đầu-cuối ───────────────────────────────────────────────────────────────────────────
 *
 * Đo 30/08 trên máy Windows thật: `hostname` → `DESKTOP-7D2FJG8`, exitCode 0, cwd `C:\Users\admin`.
 *
 * Chỗ nghẽn cuối cùng là LỚP VẬN CHUYỂN, không phải nội dung: kênh này là SSE, và daemon bỏ qua
 * trong im lặng mọi thân không có dòng `data:`. Bốn giả thuyết ở tầng nội dung đều trượt trước khi
 * điều đó lộ ra — xem `channels.ts`.
 *
 * ── Nhiều máy ──────────────────────────────────────────────────────────────────────────────────
 *
 * App gốc nối được nhiều máy cùng lúc (ảnh Settings → Computer của người dùng hiện cả
 * `DESKTOP-7D2FJG8` lẫn `Admin-PC`), và cờ tính năng tên thẳng là `sand_multi_machine_local_exec`.
 * Mỗi máy đăng nhập là tự đăng ký; hợp đồng `ListGrokBotUserComputers` trả một MẢNG `Presence
 * { machine_id, hello, last_seen_at_ms }`.
 *
 * Bên ta định tuyến bằng `providerId` cấp lúc mở luồng — xem `channels.ts`. Việc gửi cho một máy
 * không nối thì DỪNG với câu nói rõ, không im lặng rơi sang máy khác: chạy nhầm máy là thứ không
 * phát hiện được từ kết quả trả về.
 *
 * ── Sáu thao tác, không hơn (ba đầu 30/08, ba sau 06/09) ───────────────────────────────────────
 *
 * Sổ đăng ký khai 40 cặp Args→Result, nhưng đó là bảng mã dùng CHUNG với box host. Đếm số lần
 * xuất hiện trong chính daemon thì chỉ 8 thao tác có thân xử lý — shell (đồng bộ, nền, stdin) và
 * đọc/ghi/liệt kê tệp; xem chú thích trên `LocalOp` cho ba thao tác thêm sau. `computerUse`
 * và `recordScreen` chỉ có đúng 2 lần, cả hai ở dòng đăng ký codec, và trong 3,4 MB không có một
 * chữ `SendInput`/`user32`/`SendKeys`/`robotjs` nào. Daemon của hãng KHÔNG bấm chuột được; nó chạy
 * lệnh. App gốc lái OBS bằng dòng lệnh, không bằng con trỏ.
 */
import { randomUUID } from "node:crypto";
import { queueRequest, waitForResponse, connectedMachine, connectedMachines, findMachine } from "./channels.js";

/** Bằng `JM` trong daemon (12e4). Lệnh dài hơn hai phút thì nên chạy nền, không nên treo lượt. */
const MAX_TIMEOUT_MS = 120_000;

/*
 * Sáu việc, khớp bảy hành động daemon 0.43 khai trong `isSandLocalToolAction` (trừ hai việc
 * Messages của macOS). Ba việc sau thêm 06/09 — đọc từ chính daemon, không đoán:
 *
 *   write  → khung RIÊNG `{kind:"upload", requestId, path, bytesBase64}` (không đi qua `serverMessage`;
 *            `describeLocalExec` không có nhánh write — daemon mô tả upload là `write-file` ở chỗ nhận
 *            khung). Trả `{kind:"file"}` khi xong, `{kind:"file-error", error}` khi hỏng. Đường dẫn phải
 *            nằm dưới `localRoot` (`containPath`), quá 100 MiB thì từ chối trước khi ghi.
 *   spawn  → `backgroundShellSpawnArgs {command, workingDirectory, toolCallId, enableWriteShellStdinTool}`
 *            → `backgroundShellSpawnResult.success {shellId, pid, workingDirectory}`; đầu ra chảy vào
 *            `<terminalsFolder>/<shellId>.txt` (`isTerminalFile`), đọc lại bằng `read` — daemon coi tệp
 *            ấy thuộc cùng phép duyệt với lệnh (`attachToResourcePath`). Lệnh SỐNG QUA lượt.
 *   stdin  → `writeShellStdinArgs {shellId, chars}` → `writeShellStdinResult.success|error` THEO HỢP ĐỒNG —
 *            nhưng ĐO 06/09 trên máy thật: daemon trả *"No handler found for server message of type
 *            writeShellStdinArgs"*. `buildLocalExecManager` của daemon (0.29 lẫn 0.43) chỉ đăng ký BỐN bộ:
 *            shellStreamArgs · backgroundShellSpawnArgs · readArgs · lsArgs. `send-input` có tên trong
 *            `isSandLocalToolAction` và có nhánh trong `describeLocalExec`, nhưng không có người thực thi
 *            — bẫy "trường có trong hợp đồng ≠ có người đọc" (bảng theo dõi §7) lần nữa. Giữ nhánh này
 *            để cửa `/internal/ops/local-exec` đo lại khi daemon đổi; KHÔNG có tool nào cho model gọi nó.
 */
export type LocalOp =
  | { kind: "shell"; command: string; cwd?: string; timeoutMs?: number }
  | { kind: "read"; path: string }
  | { kind: "ls"; path: string }
  | { kind: "write"; path: string; bytesBase64: string }
  /** Đọc BYTES thô — khung `{kind:"download", path}` → `{kind:"file", bytesBase64}`; cặp với `write`. Cho chép tệp sang box. */
  | { kind: "download"; path: string }
  | { kind: "spawn"; command: string; cwd?: string; description?: string }
  | { kind: "stdin"; shellId: number; chars: string };

/** Hành động daemon gắn cho mỗi việc — đúng chuỗi `isSandLocalToolAction` của daemon, thẻ quyền dùng lại. */
export type LocalAction = "run-command" | "read-file" | "list-directory" | "write-file" | "send-input";

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
  if (op.kind === "spawn") {
    return {
      ...base,
      backgroundShellSpawnArgs: {
        command: op.command,
        workingDirectory: op.cwd ?? cwdCuaMay.get(machineId) ?? "",
        toolCallId: execId,
        ...(op.description ? { description: op.description } : {}),
      },
    };
  }
  if (op.kind === "stdin") return { ...base, writeShellStdinArgs: { shellId: op.shellId, chars: op.chars } };
  if (op.kind === "write" || op.kind === "download") throw new Error("write/download đi bằng khung upload/download, không qua serverMessage");
  return { ...base, lsArgs: { path: op.path } };
}

/**
 * Khung đi trên dây cho một việc — tách ra để test ghim được HÌNH DẠNG mà không cần daemon.
 *
 * `write` là khung `upload` riêng; mọi việc khác là `exec` bọc một `ExecServerMessage`.
 */
export function khungGui(op: LocalOp, machineId: string, requestId: string, approvalId?: string): Record<string, unknown> {
  const duyet = approvalId ? { approvalId } : {};
  if (op.kind === "write") return { kind: "upload", requestId, path: op.path, bytesBase64: op.bytesBase64, ...duyet };
  if (op.kind === "download") return { kind: "download", requestId, path: op.path, ...duyet };
  return { kind: "exec", requestId, serverMessage: serverMessage(op, machineId, requestId), ...duyet };
}

/** Hành động tương ứng cho thẻ xin quyền — khớp `describeLocalExec` (và nhánh upload) của daemon. */
export function actionOf(op: LocalOp): LocalAction {
  if (op.kind === "shell" || op.kind === "spawn") return "run-command";
  if (op.kind === "read" || op.kind === "download") return "read-file";
  if (op.kind === "write") return "write-file";
  if (op.kind === "stdin") return "send-input";
  return "list-directory";
}

/** Thứ hiện trên thẻ quyền: lệnh, đường dẫn, hoặc chính chuỗi sẽ gõ vào — như `describeLocalExec` chọn. */
export function targetOf(op: LocalOp): string {
  if (op.kind === "shell" || op.kind === "spawn") return op.command;
  if (op.kind === "stdin") return op.chars;
  return op.path;
}

/** Tệp đầu ra của một lệnh nền trên máy đó — daemon ghi `<terminalsFolder>/<shellId>.txt`. */
export function tepDauRaNen(may: { terminalsFolder?: string; localRoot?: string }, shellId: number): string {
  const goc = may.terminalsFolder ?? (may.localRoot ? `${may.localRoot.replace(/[\\/]+$/, "")}\\terminals` : "terminals");
  const noi = goc.includes("/") && !goc.includes("\\") ? "/" : "\\";
  return `${goc.replace(/[\\/]+$/, "")}${noi}${shellId}.txt`;
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
  /*
   * Máy nào chạy việc này.
   *
   * `opts.machineId` nhận cả id lẫn TÊN máy, vì người dùng gọi tên ("chạy trên Admin-PC") còn model
   * có thể nhắc lại id. Không chỉ định thì lấy máy vừa thấy gần nhất.
   *
   * Chỉ định một máy không nối thì DỪNG ngay ở đây với câu nói rõ, chứ không im lặng rơi về máy
   * khác: chạy một lệnh trên nhầm máy là thứ không phát hiện được từ kết quả trả về.
   */
  const may = opts.machineId ? findMachine(opts.machineId) : connectedMachine();
  if (opts.machineId && !may) {
    const co = connectedMachines().map((m) => m.label);
    return {
      ok: false,
      error: `không thấy máy "${opts.machineId}" đang nối`
        + (co.length ? ` — đang có: ${co.join(", ")}` : " — hiện không máy nào nối"),
    };
  }
  const machineId = may?.computerId ?? "";
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
  queueRequest("local-exec", khungGui(op, machineId, requestId, opts.approvalId), machineId);

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
  if (nem) {
    const loi = String((nem.throw as Record<string, unknown>)?.error ?? "lỗi không rõ").slice(0, 500);
    /*
     * Lỗi "chưa được duyệt" là lỗi HAY GẶP NHẤT, và câu của hãng không nói phải làm gì trên máy nào.
     *
     * Daemon gửi mức quyền hiện tại trong `hello` (`standing`), nên ta nói ra được. Không nói thì
     * người dùng đọc "That action was not approved on the user's computer" rồi đi tìm — mà setting
     * ấy nằm trong Settings của APP, không phải trong backend này.
     */
    if (/not approved|Execution on Local Computer/i.test(loi) && may) {
      return {
        ok: false,
        error: `Máy ${may.label} đang để mức "${may.standing ?? "ask"}" nên không cho chạy lệnh.`
          + ` Mở Settings → General → Execution on Local Computer trên máy đó và chọn "Always allow".`
          + ` (Bạn vẫn được hỏi trước mỗi lệnh bằng thẻ trong khung chat.)`,
        ...keo,
      };
    }
    return { ok: false, error: loi, ...keo };
  }
  const loiTep = khungs.find((f) => String(f.kind ?? "") === "file-error");
  if (loiTep) {
    // Câu của daemon đã đủ rõ ("Path is outside the allowed local-exec root…", "File is 120.3 MiB…").
    return { ok: false, error: String(loiTep.error ?? JSON.stringify(loiTep).slice(0, 300)), ...keo };
  }
  if (op.kind === "write" || op.kind === "download") {
    const tep = khungs.find((f) => String(f.kind ?? "") === "file");
    if (!tep) return { ok: false, error: `daemon trả khung lạ cho ${op.kind}: ${JSON.stringify(cuoiCung).slice(0, 300)}`, ...keo };
    return op.kind === "write"
      ? { ok: true, data: { written: true, path: op.path }, ...keo }
      : { ok: true, data: { path: op.path, bytesBase64: String(tep.bytesBase64 ?? "") }, ...keo };
  }
  if (op.kind === "spawn" || op.kind === "stdin") return docKetQuaMotNhanh(op, thans[0] ?? cuoiCung, keo);

  if (!laShell) return { ok: true, data: thans[0] ?? cuoiCung, ...keo };
  return { ok: true, data: gomLuongShell(thans), ...keo };
}

/**
 * Kết quả `oneof result` của spawn/stdin — daemon trả MỘT khung `control` mang
 * `{backgroundShellSpawnResult:{success|error|rejected|permissionDenied|sandboxUnsupported}}` hoặc
 * `{writeShellStdinResult:{success|error}}` (tên khoá lowerCamel vì `toJson()` của protobuf-es).
 *
 * Nhánh không phải `success` đều là lỗi cho người gọi, nhưng giữ TÊN nhánh trong câu lỗi: "rejected"
 * và "permissionDenied" là hai chuyện khác nhau với người dùng.
 */
function docKetQuaMotNhanh(
  op: Extract<LocalOp, { kind: "spawn" | "stdin" }>,
  than: Record<string, unknown>,
  keo: { cwd?: string },
): LocalResult {
  const khoa = op.kind === "spawn" ? "backgroundShellSpawnResult" : "writeShellStdinResult";
  const kq = than?.[khoa] as Record<string, Record<string, unknown>> | undefined;
  if (!kq || typeof kq !== "object") {
    return { ok: false, error: `daemon không trả ${khoa}: ${JSON.stringify(than).slice(0, 300)}`, ...keo };
  }
  if (kq.success) return { ok: true, data: kq.success, ...keo };
  const [nhanh, gia] = Object.entries(kq)[0] ?? ["?", {}];
  const chu = String((gia as Record<string, unknown>)?.error ?? (gia as Record<string, unknown>)?.reason ?? JSON.stringify(gia)).slice(0, 400);
  return { ok: false, error: `${nhanh}: ${chu}`, ...keo };
}

/** Thân bên trong một khung trả lời — daemon gói nó dưới vài tên khác nhau tuỳ loại khung. */
function thanCua(f: Record<string, unknown>): Record<string, unknown> | null {
  const t = f.clientMessage ?? f.controlMessage ?? f.message ?? f.messageJson;
  if (typeof t === "string") { try { return JSON.parse(t) as Record<string, unknown>; } catch { return null; } }
  if (t != null && typeof t === "object") return t as Record<string, unknown>;
  // Khung `client` phẳng: chính nó đã là thân (đo được: `{"id":6,"shellStream":{…}}`).
  return "shellStream" in f || "readResult" in f || "lsResult" in f || "throw" in f || "streamClose" in f
    || "backgroundShellSpawnResult" in f || "writeShellStdinResult" in f
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
export { userComputerConnected, connectedMachine, connectedMachines, findMachine } from "./channels.js";
