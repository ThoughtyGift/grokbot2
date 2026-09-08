/**
 * E2E **người mới đăng nhập lần đầu, máy local nối vào lần đầu** — không cần máy thật thứ hai.
 *
 *   npx tsx services/grokbot-backend/scripts/e2e-may-lan-dau.mts
 *   GW=http://127.0.0.1:8788 npx tsx services/grokbot-backend/scripts/e2e-may-lan-dau.mts
 *
 * Trả lời đúng câu hỏi của chủ dự án: *"test được E2E trên máy local khác khi lần đầu login kết nối
 * computer máy local"*. Bảy mốc dưới đây phủ mọi thứ TRỪ cái vỏ Windows — xem "không phủ được gì".
 *
 * ── Vì sao mô phỏng được, và mô phỏng tới đâu ──────────────────────────────────────────────────
 *
 * Hai chi tiết làm bài này chạy được mà không cần phần cứng thứ hai:
 *
 *   1. Vé cổng đúc được ngoài app. `EnsureSandBox` chỉ là hàm DỰNG — nó đóng `mintTicket(authId)`
 *      vào trường 11 của bản mô tả box rồi thôi, không chờ box, không chờ mạng. Nên bài đo gọi
 *      CHÍNH `mintTicket` (không chép lại công thức: một bản chép của định dạng chữ ký là nguồn sự
 *      thật thứ hai, và nó sẽ lệch).
 *   2. Máy local nối vào bằng HTTP thuần: mở SSE `GET /gw/local-exec/requests` → nhận khung
 *      `welcome` mang `providerId` → `POST /gw/local-exec/responses` một khung `hello`. Không có
 *      gì trong đó cần Windows.
 *
 * **Không phủ được gì** (bốn thứ chỉ máy thật trả lời được, xem runbook `docs/runbooks/may-thu-hai.md`):
 * bộ cài chạy trên Windows sạch · daemon THẬT của hãng gửi `hello` (ta gửi khung, không chạy binary)
 * · `computerId` do client tự đúc · hai máy nối cùng lúc (T5).
 *
 * ── Bài đo để lại gì ──────────────────────────────────────────────────────────────────────────
 *
 * Đúng MỘT hàng trong sổ máy, mang chủ tổng hợp `local|e2e-may-lan-dau@vi-du.vn`. Không dọn được
 * vì sổ không có cửa xoá (và thêm một cửa xoá chỉ để bài đo dùng là thêm một cửa cho mạo danh).
 * Hai điều làm nó vô hại, và cả hai chính là thứ bài này đo: hàng ấy **không bao giờ hiện trong
 * bảng của người thật** (mốc 3), và `computerId` là HẰNG SỐ nên chạy lại ghi đè chính nó chứ không
 * mọc thêm. Sổ cũng có trần hàng của riêng nó.
 *
 * Bài đo KHÔNG chạy một lệnh nào trên máy thật: mốc 6 chỉ kiểm câu TỪ CHỐI, và từ chối xảy ra ở
 * `findMachine` trước khi có gì được xếp hàng — chọn thế có chủ ý, vì một bài đo được phép chạm vào
 * máy của người dùng là một bài đo sớm muộn sẽ chạm nhầm.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const GW = (process.env.GW ?? "http://127.0.0.1:8788").replace(/\/+$/, "");

/* Bí mật ký vé: chính vé dùng chung. Đặt TRƯỚC khi nạp module — `secret()` đọc lúc gọi, nhưng đặt
 * sớm thì không phụ thuộc vào thứ tự, và đó là thứ duy nhất module ấy cần từ môi trường. */
const tokenFile = process.env.GW_TOKEN_FILE ?? join(HERE, "..", ".data", "gateway-token.txt");
process.env.GROKBOT2_GATEWAY_TOKEN = (process.env.GW_TOKEN ?? readFileSync(tokenFile, "utf8")).trim();
const VE_CHUNG = process.env.GROKBOT2_GATEWAY_TOKEN;

const { mintTicket } = await import("../src/gateway-ticket.js");

/** Người MỚI — chưa từng có bot, chưa từng có máy. Cố định để chạy lại ghi đè chính nó. */
const B = "local|e2e-may-lan-dau@vi-du.vn";
const VE_B = mintTicket(B);
/** Máy của B. Hằng số vì lý do ở phần "bài đo để lại gì". */
const MAY_B = "e2e11111-2222-4333-8444-555566667777";
const TEN_MAY = "E2E-MAY-LAN-DAU";

let dat = 0, hong = 0;
const moc = (ok: boolean, ten: string, them = "") => {
  ok ? dat++ : hong++;
  console.log(`  ${ok ? "✓" : "✗"} ${ten}${them ? " — " + them : ""}`);
};
const sl = (ms: number) => new Promise((r) => setTimeout(r, ms));

const goi = async (lenh: string, than: unknown, ve: string) => {
  const r = await fetch(`${GW}/gw/api/${lenh}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${ve}` },
    body: JSON.stringify(than ?? {}),
  });
  const chu = await r.text();
  let json: unknown = null;
  try { json = chu ? JSON.parse(chu) : null; } catch { /* giữ chữ thô để in ra khi đỏ */ }
  return { status: r.status, json, chu };
};

const bangCua = async (ve: string): Promise<Array<{ machineId: string; label: string; isCurrent?: boolean }>> => {
  const r = await goi("getSandMachines", { currentMachineId: MAY_B }, ve);
  return Array.isArray(r.json) ? r.json as Array<{ machineId: string; label: string }> : [];
};

console.log(`E2E máy lần đầu — ${GW}`);
console.log(`  người mới : ${B}`);
console.log(`  máy       : ${TEN_MAY} (${MAY_B})\n`);

// ── 0 · backend có sống không, và vé có nói đúng chủ không ────────────────────────────────────
const suc = await fetch(`${GW}/gw/health`, { headers: { authorization: `Bearer ${VE_CHUNG}` } }).catch(() => null);
if (!suc || !suc.ok) {
  console.error(`\n✘ không tới được ${GW}/gw/health — backend chưa lên?`);
  process.exit(1);
}

// ── 1 · Người mới, chưa máy nào: bảng phải RỖNG, không phải 401, không phải máy người khác ────
{
  const r = await goi("getSandMachines", { currentMachineId: MAY_B }, VE_B);
  const ds = Array.isArray(r.json) ? r.json as Array<{ machineId: string }> : null;
  moc(r.status === 200, "người mới gọi bảng Computer được (không 401)", `HTTP ${r.status}`);

  /* Người CHƯA TỪNG nối gì: một danh tính mới tinh mỗi lượt chạy, và nó không nối máy nào nên
   * không để lại hàng sổ nào. Trước 08/09 mốc này đo bằng chính B — sai ở lượt chạy THỨ HAI, vì
   * `MAY_B` là hằng số nên sổ "đã từng nối" của B còn hàng của lượt trước (đúng thứ mốc 7 ghim).
   * Một bài đo không chạy lại được thì lần đỏ thứ hai của nó không nói gì về sản phẩm. */
  const C = `local|e2e-lan-dau-${Date.now().toString(36)}@vi-du.vn`;
  const rc = await goi("getSandMachines", { currentMachineId: MAY_B }, mintTicket(C));
  const dsC = Array.isArray(rc.json) ? rc.json as Array<{ machineId: string }> : null;
  // Chỗ này là cái lỗ cũ: một sổ toàn cục sẽ trả máy của NGƯỜI KHÁC cho người vừa đăng ký.
  moc(rc.status === 200 && dsC != null && dsC.length === 0,
    "người vừa đăng nhập lần đầu: bảng TRỐNG — không thấy máy của bất kỳ ai",
    dsC ? JSON.stringify(dsC.map((m) => m.machineId)) : `HTTP ${rc.status} ${rc.chu.slice(0, 80)}`);

  // Còn bảng của B: chạy lại thì có hàng cũ của CHÍNH B, nhưng không bao giờ được có máy của ai khác.
  moc(ds != null && ds.every((m) => m.machineId === MAY_B), "bảng của B chỉ có thể chứa máy của chính B",
    ds ? JSON.stringify(ds.map((m) => m.machineId)) : `không phải mảng: ${r.chu.slice(0, 80)}`);
}

// ── 2 · Máy của B nối vào lần đầu ─────────────────────────────────────────────────────────────
const huy = new AbortController();
let providerId = "";
{
  const r = await fetch(`${GW}/gw/local-exec/requests`, {
    headers: { authorization: `Bearer ${VE_B}`, accept: "text/event-stream" },
    signal: huy.signal,
  });
  const doc = r.body!.getReader();
  const de = new TextDecoder();
  let dem = "";
  // Khung đầu tiên LUÔN là `welcome` — server chào trước, không đợi `hello` (nếu đợi thì với
  // nhiều máy không ghép được luồng nào với `hello` nào).
  const han = Date.now() + 10_000;
  while (Date.now() < han && !providerId) {
    const { value, done } = await doc.read();
    if (done) break;
    dem += de.decode(value, { stream: true });
    for (const khoi of dem.split("\n\n")) {
      const dong = khoi.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim());
      if (!dong.length) continue;
      try {
        const f = JSON.parse(dong.join("\n")) as { kind?: string; providerId?: string };
        if (f.kind === "welcome" && f.providerId) providerId = f.providerId;
      } catch { /* khối chưa đủ */ }
    }
  }
  moc(!!providerId, "kênh local-exec mở, nhận được welcome", providerId ? `providerId ${providerId.slice(0, 8)}…` : "không có welcome");

  const hello = await fetch(`${GW}/gw/local-exec/responses`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${VE_B}` },
    body: JSON.stringify({
      providerId,
      frames: [{
        kind: "hello", label: TEN_MAY, computerId: MAY_B,
        localRoot: "C:\\Users\\e2e", terminalsFolder: "C:\\Users\\e2e\\terminals",
        supervised: true, variant: "sand",
      }],
    }),
  });
  moc(hello.ok, "daemon gửi hello được", `HTTP ${hello.status}`);

  const ds = await bangCua(VE_B);
  const cua = ds.find((m) => m.machineId === MAY_B);
  moc(!!cua, "bảng của B hiện đúng máy vừa nối", `${ds.length} máy: ${JSON.stringify(ds.map((m) => m.label))}`);
  moc(cua?.label === TEN_MAY, "tên máy đúng thứ daemon tự khai", cua?.label);
  moc(cua?.isCurrent === true, "isCurrent khớp currentMachineId client khai");
  moc(ds.length === 1, "và CHỈ máy của mình", `${ds.length} máy`);
}

// ── 3 · Bảng của người A không thấy máy của B ────────────────────────────────────────────────
{
  const ds = await bangCua(VE_CHUNG);   // vé dùng chung ⇒ danh tính mặc định = người A
  moc(!ds.some((m) => m.machineId === MAY_B), "bảng của A KHÔNG có máy của B",
    JSON.stringify(ds.map((m) => m.machineId)));
}

// ── 4 · A không đổi được tên máy của B, và câu từ chối không tiết lộ gì ──────────────────────
{
  const cuaB = await goi("updateSandMachineLabel", { machineId: MAY_B, label: "A doi ten may cua B" }, VE_CHUNG);
  const khongCo = await goi("updateSandMachineLabel", { machineId: "khong-ton-tai-bao-gio", label: "A doi ten may cua B" }, VE_CHUNG);
  moc(JSON.stringify(cuaB.json) === JSON.stringify(khongCo.json) && cuaB.status === khongCo.status,
    "A đổi tên máy B: từ chối GIỐNG HỆT máy không tồn tại",
    `máy B → ${cuaB.status} ${cuaB.chu.slice(0, 40)} | không có → ${khongCo.status} ${khongCo.chu.slice(0, 40)}`);
  const ds = await bangCua(VE_B);
  moc(ds.find((m) => m.machineId === MAY_B)?.label === TEN_MAY, "và sổ của B không suy suyển");
}

// ── 5 · B đổi được tên máy của mình ─────────────────────────────────────────────────────────
{
  const moi = "May ke toan";
  const r = await goi("updateSandMachineLabel", { machineId: MAY_B, label: moi }, VE_B);
  moc(r.status === 200 && (r.json as { label?: string })?.label === moi, "B đổi tên máy mình được", `HTTP ${r.status}`);
  const ds = await bangCua(VE_B);
  // Tên người đặt phải THẮNG tên daemon tự khai — nếu không nó tự quay về sau vài giây và không ai
  // hiểu vì sao (bẫy 30/08, chính là lý do `tenNguoiDat` là trường riêng).
  moc(ds.find((m) => m.machineId === MAY_B)?.label === moi, "tên người đặt hiện trong bảng");
  await goi("updateSandMachineLabel", { machineId: MAY_B, label: TEN_MAY }, VE_B);
}

// ── 6 · Việc của B không rơi sang máy của A ─────────────────────────────────────────────────
{
  // Gọi ĐÍCH DANH một máy không thuộc B. Từ chối xảy ra ở `findMachine`, TRƯỚC khi có gì được xếp
  // hàng — nên không lệnh nào chạm vào máy thật của người dùng.
  const r = await fetch(`${GW}/internal/ops/local-exec`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${VE_B}` },
    body: JSON.stringify({ kind: "shell", command: "hostname", machineId: "DESKTOP-7D2FJG8" }),
  });
  const chu = await r.text();
  const ok = !r.ok || /không|not|khong/i.test(chu);
  moc(ok, "B chỉ đích danh máy của A thì bị từ chối", `HTTP ${r.status} ${chu.slice(0, 90)}`);
}

// ── 7 · Rút daemon: máy vẫn nằm trong bảng ──────────────────────────────────────────────────
{
  huy.abort();
  await sl(1200);
  const ds = await bangCua(VE_B);
  // Đây là lý do có SỔ THỨ HAI. Bảng hỏi lại khi danh tính đổi (renderer 0.43 `bindAuth`), mà lúc
  // đó daemon thường chưa nối kịp — chỉ đọc "đang nối" thì bảng trống và người dùng tưởng hỏng.
  moc(ds.some((m) => m.machineId === MAY_B), "máy đã rút vẫn còn trong bảng (sổ 'đã từng nối')",
    JSON.stringify(ds.map((m) => m.label)));
}

console.log(`\n${dat}/${dat + hong} mốc`);
if (hong) { console.log("ĐỎ — đọc mốc ✗ ở trên trước khi nghi sản phẩm."); process.exit(1); }
console.log("XANH — người mới + máy mới đi trọn đường, và không thấy gì của người khác.");
