/**
 * Bí mật của hộp — đường chính thức để đưa mật khẩu/token cho bot, thay vì dán vào hội thoại.
 *
 * ── Vì sao cần ──────────────────────────────────────────────────────────────────────────────────
 *
 * Client 0.20 đã có đủ giao diện cho việc này: `listSecrets` · `revealSecret` · `upsertSecrets` ·
 * `removeSecrets` chạy phía desktop (kho khoá của máy người dùng), rồi **`setBoxSecrets` đẩy chúng
 * sang hộp**. Backend này nhận `setBoxSecrets` bằng một khúc gỗ — `() => ({})` — nên nhánh đẩy sang
 * hộp **rơi vào hư không** và người dùng chỉ còn cách dán mật khẩu vào chat, nơi nó nằm lại trong
 * bản ghi hội thoại mãi mãi.
 *
 * ── Ba quyết định, và lý do ─────────────────────────────────────────────────────────────────────
 *
 * **1. Theo NGƯỜI, không theo máy.** Từ khi mở đăng ký, backend này phục vụ nhiều người trên cùng
 * một hộp. Một kho bí mật dùng chung nghĩa là bí mật Shopee của bạn nằm trong tầm với bot của người
 * lạ. Nên mỗi người một file, và trên hộp thì mỗi người đã có sẵn một tài khoản OS riêng (chặng 5).
 *
 * **2. Giá trị KHÔNG bao giờ đi qua dòng lệnh.** `ps` trên máy đó mọi người dùng đều đọc được — đây
 * đúng là cái bẫy đã trả giá với `x11vnc -passwd`. Nên bí mật được **ghi vào một file mode 600**
 * trong home của chính người đó, và lệnh của bot `source` file ấy. Không có `KEY=value` nào xuất
 * hiện trong `ps`.
 *
 * **3. `getBoxSecretsStatus` trả TÊN, không trả giá trị.** Pane chỉ cần biết "đã đặt chưa"; trả giá
 * trị về cho renderer là mở thêm một chỗ để rò mà không ai đòi.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { boxCall, boxConfigured } from "./box-exec.js";
import { currentOwner } from "./request-context.js";

/**
 * Nơi kho này ghi.
 *
 * Đọc `GROKBOT2_DATA_DIR` TRƯỚC — `mcp.ts` đã ghi cảnh báo về đúng cái bẫy này: đường dẫn suy từ vị
 * trí module thì nó đi theo mã và **bỏ qua mọi biến cách ly của bài test**, nên một lần chạy thử
 * ghi thẳng vào `.data` thật của người dùng. Đo được ngày 28/08: các lần chạy E2E để lại mẫu bot
 * rác trong kho thật, và một trong số đó làm chính bài test sau đó đọc nhầm.
 */
const DATA_DIR = process.env.GROKBOT2_DATA_DIR ?? join(dirname(fileURLToPath(import.meta.url)), "..", ".data");
const DIR = join(DATA_DIR, "box-secrets");

/** Tên file an toàn cho một danh tính. Cùng phép lọc với hồ sơ Chrome trong `displays.ts`. */
const safe = (authId: string): string => authId.replace(/[^A-Za-z0-9_-]/g, "_");

/** Nơi bot đọc bí mật trên hộp. Trong home của chính người đó, nên không ai đọc được của ai. */
export const BOX_SECRETS_FILE = "$HOME/.grokbot2-secrets.env";

/**
 * Tên biến hợp lệ cho shell — và đây là kiểm tra an ninh, không phải kiểm tra hình thức.
 *
 * File này được `source`, nên một "tên" như `X=1; rm -rf ~` là thực thi mã tuỳ ý dưới tài khoản của
 * chính người dùng. Chỉ nhận đúng dạng biến môi trường.
 */
const VALID_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

const fileFor = (owner: string): string => join(DIR, `${safe(owner)}.json`);

function readAll(owner: string): Record<string, string> {
  try {
    const raw = JSON.parse(readFileSync(fileFor(owner), "utf8")) as unknown;
    if (!raw || typeof raw !== "object") return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (VALID_NAME.test(k) && typeof v === "string") out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function writeAll(owner: string, secrets: Record<string, string>): void {
  mkdirSync(DIR, { recursive: true });
  // 0o600 chỉ có nghĩa thật trên VPS; trên Windows nó là lời khai ý định. Vẫn đặt, vì máy đích là Linux.
  writeFileSync(fileFor(owner), JSON.stringify(secrets, null, 2), { mode: 0o600 });
}

/** Nháy đơn cho shell — giá trị bí mật là dữ liệu người dùng, không phải mã. */
const sq = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;

/**
 * Đẩy bí mật của một người xuống hộp.
 *
 * Ghi qua `exec` nên nó chạy dưới **tài khoản OS của chính người đó** (chặng 5) — file nằm trong
 * home của họ, và `chmod 600` khiến người khác trên cùng hộp không đọc được.
 *
 * Dùng heredoc trích dẫn (`<<'EOF'`) chứ không phải `echo`: giá trị có thể chứa `$`, backtick, dấu
 * nháy — mọi thứ đó nở ra trong `echo` và biến một mật khẩu thành một câu lệnh.
 */
async function pushToBox(secrets: Record<string, string>): Promise<void> {
  if (!boxConfigured()) return;
  const lines = Object.entries(secrets).map(([k, v]) => `export ${k}=${sq(v)}`);
  const cmd = [
    `umask 077`,
    `cat > ${BOX_SECRETS_FILE} <<'GB2_SECRETS_EOF'`,
    ...lines,
    `GB2_SECRETS_EOF`,
    `chmod 600 ${BOX_SECRETS_FILE}`,
    `echo "wrote=$(grep -c '^export ' ${BOX_SECRETS_FILE} 2>/dev/null || echo 0)"`,
  ].join("\n");
  await boxCall<{ stdout?: string }>("exec", { command: cmd });
}

export interface BoxSecretsStatus {
  /** Tên các bí mật đã đặt. **Không bao giờ** kèm giá trị. */
  names: string[];
  count: number;
  /** Nơi bot đọc chúng, để tài liệu và câu trả lời của bot nói cùng một chỗ. */
  path: string;
  /** Chưa cấu hình hộp thì bí mật vẫn lưu được, chỉ chưa đẩy xuống đâu. */
  boxConfigured: boolean;
}

export function boxSecretsStatus(owner = currentOwner()): BoxSecretsStatus {
  const names = Object.keys(readAll(owner)).sort();
  return { names, count: names.length, path: BOX_SECRETS_FILE, boxConfigured: boxConfigured() };
}

/**
 * `setBoxSecrets({secrets})` — trộn vào những cái đã có, KHÔNG thay thế cả kho.
 *
 * Client gửi từng phần (`vl(C())` = bản đồ tên→chuỗi), và một lượt gửi thiếu không có nghĩa là
 * "xoá phần còn lại". Muốn xoá thì gửi chuỗi rỗng — đó là cách duy nhất nói "bỏ cái này" mà không
 * cần thêm một lệnh nữa.
 */
export async function setBoxSecrets(arg: unknown, owner = currentOwner()): Promise<BoxSecretsStatus> {
  const incoming = (arg as { secrets?: unknown } | null)?.secrets;
  if (incoming && typeof incoming === "object") {
    const next = readAll(owner);
    let changed = false;
    for (const [k, v] of Object.entries(incoming as Record<string, unknown>)) {
      if (!VALID_NAME.test(k) || typeof v !== "string") continue;
      if (v === "") { delete next[k]; changed = true; continue; }
      next[k] = v; changed = true;
    }
    if (changed) {
      writeAll(owner, next);
      try { await pushToBox(next); }
      catch (e) { console.warn(`[grokbot2] [secrets] lưu rồi nhưng chưa đẩy được xuống hộp: ${(e as Error).message}`); }
    }
  }
  return boxSecretsStatus(owner);
}

/**
 * Tiền tố nạp bí mật cho một lệnh shell của bot.
 *
 * Hai chi tiết, và cái thứ hai đã suýt làm hỏng mọi lệnh shell của mọi người chưa đặt bí mật:
 *
 * **`.` chứ không phải `source`** — `source` là của bash, còn daemon trên hộp chạy `sh`.
 *
 * **Phải kiểm `[ -r ]` TRƯỚC.** Trong `sh` (dash), `.` là **builtin đặc biệt**: nạp một file không
 * tồn tại làm **shell thoát ngay lập tức**, và `|| true` KHÔNG cứu được — đây là luật của POSIX về
 * special builtin, không phải lỗi của dash. Bản đầu viết `. FILE 2>/dev/null || true` và đo được
 * đúng hậu quả: với một người chưa đặt bí mật, `sh -c 'echo BAT-DAU; . FILE || true; echo KET-THUC'`
 * chỉ in `BAT-DAU`. Tức mọi lệnh của bot chết ở dòng đầu, không chạy gì, không báo gì.
 */
export const SECRETS_PRELUDE = `[ -r ${BOX_SECRETS_FILE} ] && . ${BOX_SECRETS_FILE} || true; `;
