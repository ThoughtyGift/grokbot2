/**
 * Một máy tính GIẢ nối vào kênh local-exec — để thử đường ĐA MÁY mà không cần máy thứ hai thật.
 *
 *   node services/grokbot-backend/scripts/may-gia.mjs --ten "May-Ao-01"
 *   node services/grokbot-backend/scripts/may-gia.mjs --ten "May-Ao-01" --tra-loi "xin chao"
 *
 * ── Vì sao ──────────────────────────────────────────────────────────────────────────────────────
 *
 * `channels.ts` đã dựng sổ đăng ký nhiều máy (`mayDangNoi`, `findMachine`, `queueRequest` có
 * `machineId`) vì ảnh Settings → Computer của người dùng hiện HAI máy cùng lúc. Nhưng suốt từ lúc
 * viết tới giờ chỉ có đúng một máy thật cắm vào, nên nhánh "chọn đúng máy trong nhiều máy" chưa
 * bao giờ chạy. Mã chưa chạy lần nào là mã chưa biết đúng hay sai.
 *
 * Bài này đóng vai daemon: mở SSE tới `/gw/local-exec/requests`, nhận `welcome`, gửi `hello` như
 * daemon thật, rồi trả lời mọi khung `exec` gửi tới nó. Nhờ vậy backend thấy hai máy — máy thật
 * của người dùng và (các) máy ảo — và `findMachine("tên")` có thứ để mà chọn sai.
 *
 * ── Hợp đồng, đo từ daemon thật 30/08 chứ không đoán ────────────────────────────────────────────
 *
 * Kênh là SSE (`data: <json>\n\n`), KHÔNG phải long-poll JSON — chuyện này đã tốn bốn giả thuyết
 * sai trước khi đo ra. Server gửi `welcome` mang `providerId` ngay khi mở luồng; daemon giữ lấy và
 * đính vào mọi POST, và đó chính là khoá định tuyến đa máy.
 *
 *     hello  → {kind, label, computerId, localRoot, terminalsFolder, standing, supervised, variant}
 *     exec   → {kind:"exec", requestId, serverMessage:{id, execId, machineId, shellStreamArgs|…}}
 *     đáp    → {kind:"client", requestId, clientMessage:{…}}   qua POST /gw/local-exec/responses
 *
 * Máy ảo KHÔNG chạy lệnh thật. Nó trả một chuỗi cố định — mục đích là đo ĐỊNH TUYẾN (việc có tới
 * đúng máy không), không phải đo shell.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const argv = process.argv.slice(2);
const doc = (co, mac) => { const i = argv.indexOf(co); return i >= 0 ? argv[i + 1] : mac; };
const TEN = doc("--ten", `May-Ao-${Math.random().toString(36).slice(2, 6)}`);
const TRA_LOI = doc("--tra-loi", `xin chao tu ${TEN}`);
const GOC = doc("--goc", "http://127.0.0.1:8788");

const HERE = dirname(fileURLToPath(import.meta.url));
const token = readFileSync(join(HERE, "..", ".data", "gateway-token.txt"), "utf8").trim();
const dau = { authorization: `Bearer ${token}`, "content-type": "application/json" };

const computerId = randomUUID();
let providerId = null;

const gui = async (body) => {
  const r = await fetch(`${GOC}/gw/local-exec/responses`, {
    method: "POST",
    headers: dau,
    body: JSON.stringify(providerId ? { ...body, providerId } : body),
  });
  if (!r.ok) console.error(`  POST /responses → ${r.status} ${(await r.text()).slice(0, 120)}`);
};

/**
 * Trả lời một khung `exec`.
 *
 * Daemon thật phát nhiều mẩu rồi mới đóng luồng; ta rút gọn còn hai mẩu — một mẩu chữ và một
 * `streamClose` — vì `gomLuongShell` bên backend gom tới khi thấy đóng luồng. Ít hơn thế thì
 * `runOnUserComputer` treo tới lúc hết giờ và ta đo nhầm timeout thành lỗi định tuyến.
 */
const traLoiExec = async (khung) => {
  const sm = khung.serverMessage ?? {};
  const execId = sm.execId ?? sm.id ?? randomUUID();
  const lenh = sm.shellStreamArgs?.command ?? sm.readArgs?.path ?? "(khong ro)";
  console.log(`  ← exec ${String(lenh).slice(0, 60)}  (machineId=${sm.machineId ?? "(khong)"})`);

  // Shape đúng như daemon thật: mọi mẩu bọc trong `shellStream`, và `stdout` là một OBJECT mang
  // `data` chứ không phải chuỗi trần. Bản đầu gửi chuỗi trần, backend trả `khungChuaHieu` — đúng
  // chỗ `gomLuongShell` giữ lại thứ nó không hiểu thay vì nuốt mất, nên cái sai lộ ra ngay.
  await gui({
    kind: "client", requestId: khung.requestId,
    clientMessage: { execId, shellStream: { stdout: { data: `${TRA_LOI}\n` } } },
  });
  // `cwd` về trong nhánh `exit`, không phải một nhánh riêng — xem chú thích trong `gomLuongShell`.
  await gui({
    kind: "client", requestId: khung.requestId,
    clientMessage: { execId, shellStream: { exit: { code: 0, cwd: "/ao" } } },
  });
  await gui({ kind: "client", requestId: khung.requestId, clientMessage: { execId, streamClose: {} } });
};

const chay = async () => {
  const res = await fetch(`${GOC}/gw/local-exec/requests`, { headers: { ...dau, accept: "text/event-stream" } });
  if (!res.ok) { console.error(`mở luồng hỏng: ${res.status}`); process.exit(1); }
  console.log(`máy ảo "${TEN}" đã mở luồng (computerId ${computerId.slice(0, 8)}…)`);

  const doc = res.body.getReader();
  const bo = new TextDecoder();
  let dem = "";
  for (;;) {
    const { value, done } = await doc.read();
    if (done) break;
    dem += bo.decode(value, { stream: true });
    // SSE: các sự kiện cách nhau bằng dòng trống. Keepalive là `:\n\n` — bỏ qua.
    let cat;
    while ((cat = dem.indexOf("\n\n")) >= 0) {
      const khoi = dem.slice(0, cat); dem = dem.slice(cat + 2);
      const dong = khoi.split("\n").filter((l) => l.startsWith("data:"));
      if (dong.length === 0) continue;
      let khung;
      try { khung = JSON.parse(dong.map((l) => l.slice(5).trim()).join("")); } catch { continue; }

      if (khung.kind === "welcome") {
        providerId = khung.providerId ?? null;
        console.log(`  → welcome, providerId=${String(providerId).slice(0, 8)}…; gửi hello`);
        await gui({
          kind: "hello",
          label: TEN,
          computerId,
          localRoot: "/ao",
          terminalsFolder: "/ao/terminals",
          standing: "always",
          supervised: true,
          variant: "sand",
        });
        continue;
      }
      if (khung.kind === "exec") { await traLoiExec(khung); continue; }
      console.log(`  → khung ${khung.kind}`);
    }
  }
  console.log("luồng đóng");
};

chay().catch((e) => { console.error(e); process.exit(1); });
