/**
 * Lái Chrome TRÊN MÁY NGƯỜI DÙNG — gói script, chạy qua local-exec, đọc kết quả.
 *
 * Kênh chỉ có `shell`, nên mọi lời gọi ở đây rốt cuộc là một dòng `node -e`. Hai quyết định làm nó
 * chạy được thay vì chết vì escaping:
 *
 *   · nguồn script đi bằng BASE64 trong `argv[1]`, không nhét thẳng vào dòng lệnh — đường dẫn
 *     Windows đầy backslash, `%` là biến của cmd, và dấu nháy thì mỗi shell hiểu một kiểu;
 *   · kết quả in ra sau mốc `GB2JSON`, không phải in JSON trần — vì stdout còn dính cảnh báo của
 *     Node, dòng chào của Chrome, và mọi thứ khác mà một máy thật hay chen vào.
 */
import { runOnUserComputer } from "./local-exec.js";
import { scriptDaThay, CONG_CDP } from "./local-browser-agent.js";

export interface KetQuaTrinhDuyet {
  ok: boolean;
  loi?: string;
  url?: string;
  tieuDe?: string;
  chu?: string;
  doDaiThat?: number;
  ketQua?: string;
  anhBase64?: string;
}

/** Mốc phân định phần JSON trong stdout. Xem chú thích đầu file. */
const MOC = "GB2JSON";

type Viec =
  | { viec: "mo"; url: string }
  | { viec: "doc"; gioiHan?: number }
  | { viec: "bam"; chu: string }
  | { viec: "go"; o: string; chu: string; enter?: boolean }
  | { viec: "anh" };

/**
 * Chở script sang máy người dùng MỘT LẦN, rồi các lượt sau chạy thẳng file đã có.
 *
 * Bản đầu nhét cả nguồn vào một dòng `node -e "eval(base64)"`. Đo được vì sao nó im lặng chết:
 * nguồn 7.087 ký tự → base64 9.700 → dòng lệnh 9.780, trong khi Windows chặn ở 8.191. Không lỗi,
 * không thông báo, chỉ là hết giờ sau 90 giây.
 *
 * Nên chia base64 thành mẩu dưới ngưỡng và ghi bằng CHÍNH NODE, không bằng shell: shell trên máy
 * đó là POSIX (`$HOME` = `/c/Users/admin`) còn Node là Node Windows, nên `/tmp/...` shell ghi được
 * thì Node lại không đọc nổi — đo được đúng vậy. Để Node tự chọn `os.tmpdir()` là hai bên nói cùng
 * một đường dẫn.
 *
 * Trả về đường dẫn kiểu forward-slash (Node Windows nhận), hoặc `null` kèm lý do.
 */
const CHIA = 5_000;
let duongDanCache: string | null = null;

async function dambaoScript(opts: { machineId?: string }): Promise<{ duong?: string; loi?: string }> {
  const nguon = scriptDaThay();
  const b64 = Buffer.from(nguon, "utf8").toString("base64");
  const may = opts.machineId ? { machineId: opts.machineId } : {};

  const chay = async (command: string, timeoutMs = 40_000) => {
    const r = await runOnUserComputer({ kind: "shell", command }, { timeoutMs, ...may });
    if (!r.ok) return { ok: false as const, loi: String(r.error ?? "lệnh hỏng") };
    return { ok: true as const, out: String((r.data as { stdout?: string })?.stdout ?? "").trim() };
  };

  // Đã chở rồi thì thôi — kiểm bằng ĐỘ DÀI, vì sửa script mà quên chở lại là loại lỗi chạy bản cũ
  // suốt buổi mà không ai biết.
  if (duongDanCache) {
    const c = await chay(`node -e "const f=require('fs');const p=process.argv[1];console.log(f.existsSync(p)?f.readFileSync(p,'utf8').length:0)" "${duongDanCache}"`, 25_000);
    if (c.ok && Number(c.out) === nguon.length) return { duong: duongDanCache };
  }

  const mau: string[] = [];
  for (let i = 0; i < b64.length; i += CHIA) mau.push(b64.slice(i, i + CHIA));

  for (const [i, m] of mau.entries()) {
    const che = i === 0 ? "writeFileSync" : "appendFileSync";
    const r = await chay(`node -e "const f=require('fs'),o=require('os');f.${che}(o.tmpdir()+'/gb2-browser.b64',process.argv[1]);console.log('OK')" ${m}`, 30_000);
    if (!r.ok) return { loi: `chở mẩu ${i + 1}/${mau.length} hỏng: ${r.loi}` };
  }

  const g = await chay(`node -e "const f=require('fs'),o=require('os');const b=o.tmpdir()+'/gb2-browser.b64';const d=o.tmpdir().split(String.fromCharCode(92)).join('/')+'/gb2-browser.cjs';f.writeFileSync(d,Buffer.from(f.readFileSync(b,'utf8'),'base64').toString('utf8'));console.log(d)"`, 30_000);
  if (!g.ok) return { loi: `ghép script hỏng: ${g.loi}` };
  const duong = g.out.split(/\r?\n/).pop()?.trim();
  if (!duong || !duong.endsWith(".cjs")) return { loi: `không rõ script nằm ở đâu: ${g.out.slice(0, 200)}` };
  duongDanCache = duong;
  return { duong };
}

/**
 * Chạy một việc trên trình duyệt của máy người dùng.
 *
 * `timeoutMs` rộng tay ở lần gọi đầu: nếu Chrome chưa mở cổng gỡ lỗi thì script phải tự bật một
 * cửa sổ và chờ tới 20 giây cho nó lên.
 */
export async function lamTrenTrinhDuyet(v: Viec, opts: { machineId?: string; timeoutMs?: number } = {}): Promise<KetQuaTrinhDuyet> {
  const goi = Buffer.from(JSON.stringify(v), "utf8").toString("base64");
  const cho = await dambaoScript(opts);
  if (!cho.duong) return { ok: false, loi: cho.loi ?? "không chở được script sang máy" };

  const command = `node "${cho.duong}" ${goi}`;

  const r = await runOnUserComputer({ kind: "shell", command }, {
    timeoutMs: opts.timeoutMs ?? 60_000,
    ...(opts.machineId ? { machineId: opts.machineId } : {}),
  });
  if (!r.ok) return { ok: false, loi: String(r.error ?? "không chạy được lệnh trên máy") };

  const out = String((r.data as { stdout?: string })?.stdout ?? "");
  const i = out.indexOf(MOC);
  if (i < 0) {
    const err = String((r.data as { stderr?: string })?.stderr ?? "").trim();
    // Nói ra thứ máy thật sự in ra. "Không parse được" mà không kèm nguyên văn là loại thông báo
    // đã tốn của repo này vài buổi.
    return { ok: false, loi: `script không trả về JSON. stdout: ${out.slice(0, 200) || "(rỗng)"}${err ? ` · stderr: ${err.slice(0, 200)}` : ""}` };
  }
  try {
    return JSON.parse(out.slice(i + MOC.length)) as KetQuaTrinhDuyet;
  } catch (e) {
    return { ok: false, loi: `JSON hỏng: ${String((e as Error).message).slice(0, 120)}` };
  }
}

/** Cổng CDP đang dùng trên máy người dùng — để thông báo lỗi nói được số cụ thể. */
export { CONG_CDP };
