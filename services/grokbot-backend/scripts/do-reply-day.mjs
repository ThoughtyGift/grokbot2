/**
 * Đo BA điều kiện mà client thật sự dùng để vẽ khối trích dẫn — trích từ bundle 0.30:
 *
 *   entryById   = new Map(entries.map(e => [e.id, e]))     ← khoá là `entry.id`
 *   resolveEntry(targetId) → null  ⇒  bT(null) = {kind:"missing"}  ⇒  vẽ "(deleted)"
 *   bT(entry): tool-call | notice | event | feedback | voice-call  ⇒  CŨNG "missing"
 *
 * Nên "gửi replyTo dạng string" là điều kiện CẦN, không đủ. Ba điều kiện:
 *   ① entry trả lời có `replyTo` là string
 *   ② trong CÙNG payload có entry `id === replyTo`
 *   ③ entry ấy có kind ∈ {message, send-message, user-attachment}
 */
import { readFileSync } from "node:fs";

const AGENT = process.argv[2] ?? "agent-645";
const CONG = process.env.GROKBOT2_GW_PORT ?? "8790";

const doc = (p) => { try { return readFileSync(p, "utf8").trim(); } catch { return ""; } };
const token = doc("services/grokbot-backend/.data/gateway-token.txt") || doc(".data/gateway-token.txt");
if (!token) { console.log("KHÔNG ĐO ĐƯỢC: không thấy gateway-token.txt"); process.exit(1); }

const goi = async (method, args) => {
  const r = await fetch(`http://127.0.0.1:${CONG}/gw/api/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(args),
  });
  const chu = await r.text();
  if (!r.ok) return { ok: false, status: r.status, chu: chu.slice(0, 200) };
  try { return { ok: true, data: JSON.parse(chu) }; } catch { return { ok: false, chu: chu.slice(0, 200) }; }
};

const r = await goi("getAgentTranscriptTail", { agentId: AGENT, limit: 200 });
if (!r.ok) { console.log("KHÔNG ĐO ĐƯỢC:", JSON.stringify(r)); process.exit(1); }

const entries = r.data?.entries ?? r.data?.transcript?.entries ?? [];
console.log(`agent ${AGENT}: ${entries.length} entry trong payload`);
if (entries.length === 0) { console.log("khoá cấp 1 của payload:", Object.keys(r.data ?? {})); process.exit(1); }

const theoId = new Map(entries.map((e) => [e.id, e]));
const KIND_OK = new Set(["message", "send-message", "user-attachment"]);

const coReply = entries.filter((e) => e.replyTo != null || e.replyToId != null);
console.log(`entry có tham chiếu trả lời: ${coReply.length}`);
if (coReply.length === 0) {
  console.log("→ chưa có entry nào mang replyTo, không có gì để kiểm. Cần một lượt reply thật.");
  process.exit(0);
}

let dat = 0;
for (const e of coReply) {
  const raw = e.replyTo ?? e.replyToId;
  const laString = typeof raw === "string";
  const dich = laString ? theoId.get(raw) : undefined;
  const kindOk = dich ? KIND_OK.has(dich.kind) : false;
  const ve = !laString ? "(deleted) — replyTo KHÔNG phải string"
    : !dich ? "(deleted) — không có entry nào id trùng trong payload"
    : !kindOk ? `(deleted) — entry đích kind="${dich.kind}" nằm trong nhóm missing`
    : "khối trích dẫn ĐÚNG";
  if (laString && dich && kindOk) dat += 1;
  console.log(`\n  ${e.id}  kind=${e.kind}`);
  console.log(`    ① replyTo = ${JSON.stringify(raw)}  (string: ${laString})`);
  console.log(`    ② tra được trong payload: ${dich ? "có" : "KHÔNG"}`);
  console.log(`    ③ kind đích: ${dich?.kind ?? "-"}  hợp lệ: ${kindOk}`);
  console.log(`    → client sẽ vẽ: ${ve}`);
  if (dich) {
    // Mỗi kind giữ chữ ở một chỗ khác nhau — đo từ entry thật, không đoán:
    //   message        → `content`
    //   send-message   → `message.content`   (tôi từng đoán `message.text` và ô này in ra rỗng,
    //                                         trông như dữ liệu thiếu trong khi chỉ là tra sai khoá)
    //   user-attachment→ `file_name`
    const noiDung = dich.kind === "send-message" ? (dich.message?.content ?? "")
      : dich.kind === "user-attachment" ? (dich.file_name ?? dich.file_path ?? "")
      : (dich.content ?? "");
    console.log(`    nội dung sẽ hiện trong khối: "${String(noiDung).replace(/\s+/g, " ").slice(0, 70)}"`);
  }
}
console.log(`\n=== ${dat}/${coReply.length} tham chiếu sẽ vẽ ra khối trích dẫn đúng ===`);
