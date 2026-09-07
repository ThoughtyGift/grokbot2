/**
 * Chép tệp hai chiều MÁY NGƯỜI DÙNG ↔ BOX — bản của ta cho `CopyToBox` / `CopyFromBox` của hãng.
 *
 * Bằng chứng hãng có hai tool ấy nằm trong chính daemon local-exec (câu báo khi người dùng tắt local
 * tools): *"Shell, Read, and AwaitShell with machineId, plus CopyToBox and CopyFromBox, cannot run on
 * their computer."* Đường dây của họ và của ta là một: khung `download` lấy bytes từ máy người dùng,
 * khung `upload` đẩy bytes về (cùng hai khung `local_write` đã dùng); phía box là hai op của
 * exec-daemon `readBytes` / `writeBytes`.
 *
 * ── Ba trần, ba lý do ──────────────────────────────────────────────────────────────────────────
 *
 *   TRAN_TEP     100 MiB — `maxFileBytes` của daemon máy người dùng: tệp lớn hơn nó từ chối ở cả hai
 *                chiều ("File is 120.3 MiB, which exceeds Grok Bot's 100.0 MiB limit…"). Ta kiểm
 *                trước để nói câu tiếng Việt, không để một request 130 MB đi rồi mới bị từ chối.
 *   KHUC_LEN_BOX 6 MiB — backend → box đi qua nginx `admin.halcion.vn` có `client_max_body_size 20m`;
 *                6 MiB thô = 8 MiB base64 + JSON, dư đủ. Khúc đầu ghi MỚI, khúc sau `append`.
 *   KHUC_TU_BOX  4 MiB — cùng cỡ `MEDIA_CHUNK_CAP` mà đường xem trước media đã dùng với `readBytes`.
 *
 * Chiều máy người dùng ↔ backend đi MỘT khung (nginx `cinai-app` 300m, daemon cho phép tới 100 MiB),
 * nên phía ấy không cắt khúc — cắt là việc của phía box.
 *
 * Mọi việc I/O đi qua `Day` để test không cần daemon nào: bài đo ghim SỐ KHÚC, cờ `append`, sha, và
 * đường dẫn mặc định — những thứ sai im lặng nhất (một khúc thiếu cờ `append` là tệp bị cắt đầu mà sha
 * vẫn… khác, và không ai đọc sha).
 */
import { createHash } from "node:crypto";
import { runOnUserComputer, type LocalResult } from "./local-exec.js";
import { boxCall } from "./box-exec.js";

export const TRAN_TEP = 100 * 1024 * 1024;
export const KHUC_LEN_BOX = 6 * 1024 * 1024;
export const KHUC_TU_BOX = 4 * 1024 * 1024;
/** Hết cỡ trần daemon (`MAX_TIMEOUT_MS` của local-exec) — 100 MiB qua Cloudflare không đi trong 20 s mặc định. */
const CHO_MAY_MS = 120_000;

/** Bốn động tác I/O; bản thật ở `dayThat`, test tiêm bản giả. */
export interface Day {
  taiTuMay(path: string, machineId: string, owner: string): Promise<LocalResult>;
  dayLenMay(path: string, bytesBase64: string, machineId: string, owner: string): Promise<LocalResult>;
  ghiBox(a: { path: string; bytesBase64: string; append: boolean }): Promise<{ totalSize?: number }>;
  docBox(a: { path: string; offset: number; length: number }): Promise<{ totalSize: number; bytesBase64: string }>;
}

export const dayThat: Day = {
  taiTuMay: (path, machineId, owner) => runOnUserComputer({ kind: "download", path }, { machineId, owner, timeoutMs: CHO_MAY_MS }),
  dayLenMay: (path, bytesBase64, machineId, owner) => runOnUserComputer({ kind: "write", path, bytesBase64 }, { machineId, owner, timeoutMs: CHO_MAY_MS }),
  ghiBox: (a) => boxCall("writeBytes", { path: a.path, bytesBase64: a.bytesBase64, append: a.append }),
  docBox: (a) => boxCall("readBytes", { target_file: a.path, offset: a.offset, length: a.length }),
};

export const sha256 = (b: Buffer): string => createHash("sha256").update(b).digest("hex");
export const tenTep = (p: string): string => p.split(/[\\/]/).filter(Boolean).pop() ?? "tep";
const mib = (n: number): string => `${(n / (1024 * 1024)).toFixed(1)} MiB`;

/** Cắt đệm thành các khúc `size`; đệm rỗng vẫn ra MỘT khúc rỗng để tệp 0 byte cũng được tạo. */
export function catKhuc(buf: Buffer, size: number): Buffer[] {
  if (buf.length === 0) return [Buffer.alloc(0)];
  const ra: Buffer[] = [];
  for (let i = 0; i < buf.length; i += size) ra.push(buf.subarray(i, i + size));
  return ra;
}

export type KetQuaChep =
  | { ok: true; duongMay: string; duongBox: string; bytes: number; sha256: string; khuc: number }
  | { ok: false; error: string };

/**
 * Máy người dùng → box. `duongBox` mặc định `tu-may/<tên tệp>` dưới gốc làm việc của box, để mọi tệp
 * kéo lên nằm một chỗ và không đè lên việc bot đang làm.
 */
export async function chepLenBox(
  vao: { machineId: string; duongMay: string; duongBox?: string; owner: string },
  day: Day = dayThat,
): Promise<KetQuaChep> {
  const duongMay = vao.duongMay.trim();
  if (!duongMay) return { ok: false, error: "thiếu đường dẫn tệp trên máy" };
  const r = await day.taiTuMay(duongMay, vao.machineId, vao.owner);
  if (!r.ok) return { ok: false, error: `không đọc được ${duongMay} trên máy: ${r.error}` };
  const b64 = String((r.data as { bytesBase64?: unknown })?.bytesBase64 ?? "");
  const buf = Buffer.from(b64, "base64");
  if (buf.length > TRAN_TEP) return { ok: false, error: `tệp ${mib(buf.length)} vượt trần ${mib(TRAN_TEP)} của daemon máy người dùng` };
  const duongBox = (vao.duongBox ?? "").trim() || `tu-may/${tenTep(duongMay)}`;
  const khucs = catKhuc(buf, KHUC_LEN_BOX);
  for (const [i, k] of khucs.entries()) {
    try {
      await day.ghiBox({ path: duongBox, bytesBase64: k.toString("base64"), append: i > 0 });
    } catch (e) {
      return { ok: false, error: `ghi khúc ${i + 1}/${khucs.length} lên box hỏng: ${String((e as Error)?.message ?? e).slice(0, 300)}` };
    }
  }
  return { ok: true, duongMay, duongBox, bytes: buf.length, sha256: sha256(buf), khuc: khucs.length };
}

/**
 * Box → máy người dùng. `duongMay` mặc định `<localRoot>\Desktop\<tên tệp>` — Desktop là chỗ người
 * dùng nhìn thấy ngay; `localRoot` là gốc daemon tự khai trong `hello` (thường `C:\Users\<tên>`),
 * ngoài đó daemon từ chối ghi.
 */
export async function chepVeMay(
  vao: { machineId: string; duongBox: string; duongMay?: string; localRoot?: string; owner: string },
  day: Day = dayThat,
): Promise<KetQuaChep> {
  const duongBox = vao.duongBox.trim();
  if (!duongBox) return { ok: false, error: "thiếu đường dẫn tệp trên box" };
  let duongMay = (vao.duongMay ?? "").trim();
  if (!duongMay) {
    if (!vao.localRoot) return { ok: false, error: "không biết ghi vào đâu: máy chưa khai thư mục gốc, hãy đưa \"path\" đầy đủ" };
    const goc = vao.localRoot.replace(/[\\/]+$/, "");
    const noi = goc.includes("/") && !goc.includes("\\") ? "/" : "\\";
    duongMay = `${goc}${noi}Desktop${noi}${tenTep(duongBox)}`;
  }

  const phan: Buffer[] = [];
  let total = -1, offset = 0;
  try {
    do {
      const r = await day.docBox({ path: duongBox, offset, length: KHUC_TU_BOX });
      if (total < 0) {
        total = Number(r.totalSize ?? 0);
        if (total > TRAN_TEP) return { ok: false, error: `tệp trên box ${mib(total)} vượt trần ${mib(TRAN_TEP)} của daemon máy người dùng` };
      }
      const k = Buffer.from(String(r.bytesBase64 ?? ""), "base64");
      if (k.length === 0 && offset < total) return { ok: false, error: `box trả khúc rỗng ở offset ${offset}/${total}` };
      phan.push(k);
      offset += k.length;
    } while (offset < total);
  } catch (e) {
    return { ok: false, error: `đọc ${duongBox} trên box hỏng: ${String((e as Error)?.message ?? e).slice(0, 300)}` };
  }
  const buf = Buffer.concat(phan);
  const r = await day.dayLenMay(duongMay, buf.toString("base64"), vao.machineId, vao.owner);
  if (!r.ok) return { ok: false, error: `không ghi được ${duongMay} trên máy: ${r.error}` };
  return { ok: true, duongMay, duongBox, bytes: buf.length, sha256: sha256(buf), khuc: phan.length };
}
