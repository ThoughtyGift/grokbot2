/**
 * Đo MỘT ca parity, nhiều lượt — không cần app, không cần CDP.
 *
 *   npx tsx services/grokbot-backend/scripts/do-mot-ca.mts 10 --lan 3
 *   npx tsx services/grokbot-backend/scripts/do-mot-ca.mts 15 --lan 5
 *
 * ── Vì sao có bài này bên cạnh `parity-lap` ─────────────────────────────────────────────────────
 *
 * `parity-lap` chạy cả 23 ca qua giao diện thật, và một lượt mất 20–50 phút. Đúng thứ cần khi hỏi
 * "bản này bám app gốc tới đâu". Nhưng khi đã biết CHÍNH XÁC ca nào lệch và vừa sửa đúng chỗ đó,
 * chạy lại cả bộ là trả giá 23 lần cho một câu trả lời một ô.
 *
 * Bài này đi thẳng cửa `sendPrompt` của gateway: không mở app, không bấm chuột, không cạnh tranh
 * với người dùng đang chat. Đổi lại nó KHÔNG đo được thứ `parity-lap` đo — hành vi trong giao diện
 * thật, và những ca phụ thuộc ngữ cảnh các ca trước. Nên dùng nó để kiểm nhanh một ô, rồi chốt
 * bằng `parity-lap` khi cần con số cho cả bảng.
 *
 * ── Chỉ đếm WIDGET, vì đó là thứ bộ ca này chấm ─────────────────────────────────────────────────
 *
 * Cột "app gốc mời chọn" trong bảng phân bố chính là có/không widget. Bài này đếm đúng thứ đó, và
 * in ra n/N chứ không in một chữ "đúng" — một lượt không kết luận được gì, bài học đã trả giá.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const token = readFileSync(join(HERE, "..", ".data", "gateway-token.txt"), "utf8").trim();
const GW = "http://127.0.0.1:8788/gw/api";

const gw = async <T>(method: string, body: unknown = {}): Promise<T> => {
  const r = await fetch(`${GW}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return (await r.json()) as T;
};

const argv = process.argv.slice(2);
const soCa = Number(argv[0] ?? "10");
const lan = Number(argv[argv.indexOf("--lan") + 1]) || 3;

const boCa = JSON.parse(readFileSync(join(HERE, "..", "..", "..", "docs", "parity-runs", "bo-ca-parity.json"), "utf8")) as {
  cases: { input?: string; expected?: { kind: string }[] }[];
};
const ds = boCa.cases.filter((c) => String(c.input ?? "").trim());
const ca = ds[soCa - 1];
if (!ca) { console.error(`không có case ${soCa} (bộ có ${ds.length} ca)`); process.exit(2); }
const mongWidget = (ca.expected ?? []).some((e) => e.kind === "widget");
const cauHoi = String(ca.input);

console.log(`case ${soCa}: ${cauHoi.replace(/\s+/g, " ").slice(0, 70)}`);
console.log(`app gốc ${mongWidget ? "CÓ" : "KHÔNG"} mời chọn · đo ${lan} lượt\n`);

const nghi = (ms: number) => new Promise((r) => setTimeout(r, ms));

let coWidget = 0;
let doDuoc = 0;
const daTao: string[] = [];

for (let i = 1; i <= lan; i += 1) {
  const ten = `CA${soCa}-${Math.random().toString(36).slice(2, 6)}`;
  const tao = await gw<{ agent?: { id: string } }>("createAgent", { name: ten });
  const id = tao.agent?.id ?? "";
  if (!id) { console.log(`  lượt ${i}: không tạo được bot — bỏ`); continue; }
  daTao.push(id);

  const ok = await gw<{ accepted?: boolean }>("sendPrompt", { agentId: id, content: cauHoi });
  if (!ok?.accepted) { console.log(`  lượt ${i}: gateway không nhận lượt — bỏ`); continue; }

  /*
   * Chờ tới khi bản ghi NGỪNG mọc, không chờ một mốc thời gian.
   *
   * Ca dựng đội tạo bốn bot con rồi mở phòng rồi giao việc — dài hơn hẳn một ca hỏi đáp. Ngủ một
   * số cố định thì hoặc cắt giữa lượt (đếm thiếu widget) hoặc chờ thừa vài phút mỗi lượt.
   */
  let truoc = -1;
  let yen = 0;
  let rows: { kind: string; message?: { type?: string } }[] = [];
  for (let b = 0; b < 90; b += 1) {
    await nghi(4000);
    const t = await gw<{ entries?: typeof rows }>("getAgentTranscriptTail", { id, agentId: id, limit: 60 });
    rows = t.entries ?? [];
    /*
     * Sáu nhịp yên (24 giây), không phải ba.
     *
     * Ba nhịp = 12 giây, và đo lần đầu cho 4 entry mỗi lượt trong khi cùng câu hỏi ấy chạy qua giao
     * diện thật cho 11 entry: bot đang gọi một tool dài (dựng bốn bot con) thì bản ghi đứng yên
     * hàng chục giây mà lượt chưa hề xong. Cắt ở đó là đếm thiếu widget rồi kết luận "đã sửa được".
     */
    if (rows.length === truoc) { yen += 1; if (yen >= 6) break; } else { yen = 0; truoc = rows.length; }
  }

  if (!rows.length) { console.log(`  lượt ${i}: không có entry nào — KHÔNG ĐO ĐƯỢC`); continue; }
  doDuoc += 1;
  const co = rows.some((e) => e.kind === "send-message" && e.message?.type === "widget");
  if (co) coWidget += 1;
  const dung = co === mongWidget;
  const ngan = rows.length <= 4;
  console.log(`  lượt ${i}: ${co ? "có widget" : "không widget"} → ${dung ? "đúng" : "LỆCH"} (${rows.length} entry)${ngan ? "  ⚠ ngắn bất thường — có thể cắt giữa lượt" : ""}`);
}

// Dọn bot bài này tạo ra, và CHỈ chúng — kể cả bot con mà lượt đó đẻ thêm.
if (daTao.length) {
  const truoc = await gw<{ agents?: { id: string; name: string }[] } | { id: string; name: string }[]>("getAgents", {});
  const all = Array.isArray(truoc) ? truoc : (truoc.agents ?? []);
  const con = all.filter((a) => Number(String(a.id).replace("agent-", "")) > Number(String(daTao[0]).replace("agent-", ""))).map((a) => a.id);
  const xoa = [...new Set([...daTao, ...con])];
  await gw("deleteAgents", { ids: xoa, agentIds: xoa });
  console.log(`\ndọn ${xoa.length} bot bài này tạo ra`);
}

console.log(`\n${coWidget}/${doDuoc} lượt có widget · app gốc ${mongWidget ? "CÓ" : "KHÔNG"}`);
if (doDuoc < lan) console.log(`(${lan - doDuoc} lượt không đo được — đừng đọc tỉ lệ trên như một kết luận)`);
