/**
 * Bấm thử qua DÂY THẬT mọi bề mặt làm trong ngày — backend đang chạy, HTTP thật, token thật.
 *
 *   node services/grokbot-backend/scripts/verify-today.mjs [--port 8788]
 *
 * Vì sao có script này: 17 commit hôm nay mới chỉ xanh ở unit + hợp đồng. Unit test gọi hàm; cái
 * chưa ai chứng minh là **đường đi**: router có nhận tên lệnh không, ACL có gọi đúng cổng không,
 * hình dạng trả về có đúng kiểu client khai không. Đó đúng là chỗ 404 mềm sống — lệnh có mã, có
 * test, mà tên không nằm trong bảng nên bấm vẫn không ra gì.
 *
 * KHÔNG thay được việc bấm tay trong app: nó không chứng minh renderer vẽ ra hình gì. Nhưng nó
 * chứng minh dây nối, và làm được ngay cả khi hạn mức pool đã cạn.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const argv = process.argv.slice(2);
const PORT = Number(argv[argv.indexOf("--port") + 1]) || 8788;
const HERE = dirname(fileURLToPath(import.meta.url));
const token = readFileSync(join(HERE, "..", ".data", "gateway-token.txt"), "utf8").trim();

const gw = async (method, body = {}) => {
  const r = await fetch(`http://127.0.0.1:${PORT}/gw/api/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, json };
};

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  ok ? pass++ : fail++;
  console.log(`${ok ? "  ok  " : "  FAIL"} ${name}${ok ? "" : `  ${String(detail).slice(0, 220)}`}`);
};
/** Không phải 404 mềm: router nhận tên lệnh. Đây là điều kiện tối thiểu của MỌI bề mặt hôm nay. */
const routed = (r) => r.status === 200 && !(r.json && r.json.error === "unknown method");

console.log(`— dây thật, cổng ${PORT} —\n`);

// ── 1. Mẫu bot: vòng tròn cả đội ───────────────────────────────────────────────────────────────
console.log("mẫu bot");
const kho = (await gw("createAgent", { name: "VT Kho", description: "Ưu tiên Hỏa Tốc." })).json.agent;
const cs = (await gw("createAgent", { name: "VT CS", description: "Trả chat trong 2 phút." })).json.agent;
const room = (await gw("createGroup", { name: "VT Ops", memberAgentIds: [kho.id, cs.id] })).json.agent;

const draft = await gw("getBotTemplateForSourceAgent", { sourceAgentId: room.id });
check("getBotTemplateForSourceAgent có đường đi", routed(draft), JSON.stringify(draft).slice(0, 200));
const shareId = draft.json?.shareId;
check("trả bản nháp có shareId, chưa xuất bản", Boolean(shareId) && draft.json.published === false, JSON.stringify(draft.json).slice(0, 200));

const pub = await gw("publishBotTemplate", { shareId, version: 1 });
check("publishBotTemplate → published + activeVersion", pub.json?.published === true && pub.json?.activeVersion === 1, JSON.stringify(pub.json).slice(0, 200));

const list = await gw("listBotTemplates", {});
check("listBotTemplates trả MẢNG (client khai reply:array)", Array.isArray(list.json), JSON.stringify(list.json).slice(0, 120));

const made = await gw("createAgentFromTemplate", { shareId, agentId: "", name: "VT Ops (bản sao)", avatarShape: "blob", avatarColor: "blue", expectedActiveVersion: 1 });
const copy = made.json?.agent;
check("createAgentFromTemplate dựng lại NHÓM", copy?.isGroup === true && (copy?.memberIds?.length ?? 0) === 2, JSON.stringify(made.json).slice(0, 220));
if (copy?.memberIds?.length) {
  const roster = (await gw("listAgents", {})).json;
  const rows = (Array.isArray(roster) ? roster : roster?.agents ?? []);
  const mem = copy.memberIds.map((id) => rows.find((x) => x.id === id)).filter(Boolean);
  check("thành viên dựng lại kèm SOP", mem.length === 2 && /Hỏa Tốc/.test(mem[0]?.description ?? "") , JSON.stringify(mem.map((m) => [m.name, m.description])).slice(0, 220));
}
check("setBotTemplateVisibility", (await gw("setBotTemplateVisibility", { shareId, visibility: "public" })).json?.visibility === "public");
check("deleteBotTemplate không nổ", routed(await gw("deleteBotTemplate", { shareId })));

// ── 2. MCP ghi ─────────────────────────────────────────────────────────────────────────────────
console.log("\nMCP nửa ghi");
for (const [m, body] of [
  ["listMcpServerTools", { serverId: "memory" }],
  ["toggleMcpToolDisabled", { serverId: "memory", toolName: "create_entities" }],
  ["setMcpCustomInstructions", { serverId: "memory", instructions: "Chỉ đọc." }],
  ["installMcpEntry", { entryId: 1, values: {} }],
  ["uninstallMcpPlugin", { pluginId: 1 }],
  ["updateMcpPluginInstall", { pluginId: 1, values: {} }],
  ["removeMcpServer", { serverId: "khong-co" }],
  ["authenticateMcpServer", { serverId: "khong-co" }],
  ["renameMcpAccount", { serverId: "x", accountKey: "a", newAccountKey: "b" }],
  ["removeMcpAccount", { serverId: "x", accountKey: "a" }],
]) {
  const r = await gw(m, body);
  check(`${m} có đường đi`, routed(r), JSON.stringify(r).slice(0, 160));
}
// Tắt rồi bật lại để không để lại rác cho lượt chat thật.
const t1 = await gw("toggleMcpToolDisabled", { serverId: "memory", toolName: "create_entities" });
check("toggleMcpToolDisabled trả trạng thái SAU khi đổi", typeof t1.json?.disabled === "boolean", JSON.stringify(t1.json));
await gw("setMcpCustomInstructions", { serverId: "memory", instructions: "" });

// ── 3. Thẻ nháp + biểu mẫu ─────────────────────────────────────────────────────────────────────
console.log("\nthẻ nháp + biểu mẫu");
for (const [m, body] of [
  ["sendDraft", { entryId: "khong-co", agentId: kho.id, draft: {} }],
  ["discardDraft", { entryId: "khong-co", agentId: kho.id }],
  ["submitUserForm", { entryId: "khong-co", agentId: kho.id, values: { A: "1" } }],
  ["dismissUserForm", { entryId: "khong-co", agentId: kho.id, mode: "dismissed" }],
]) {
  const r = await gw(m, body);
  check(`${m} có đường đi`, routed(r), JSON.stringify(r).slice(0, 160));
}
const sd = await gw("sendDraft", { entryId: "khong-co", agentId: kho.id, draft: {} });
check("sendDraft TỪ CHỐI có lý do (không giả vờ đã gửi)", sd.json?.ok === false && typeof sd.json?.reason === "string", JSON.stringify(sd.json).slice(0, 200));

// ── 4. Mic ─────────────────────────────────────────────────────────────────────────────────────
console.log("\nmic");
const wav = Buffer.concat([
  Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WAVEfmt "),
  Buffer.from([16, 0, 0, 0, 1, 0, 1, 0, 0x80, 0x3e, 0, 0, 0, 0x7d, 0, 0, 2, 0, 16, 0]),
  Buffer.from("data"), Buffer.alloc(4), Buffer.alloc(3200),
]);
const tr = await gw("transcribeAudio", { audioBase64: wav.toString("base64"), mimeType: "audio/wav" });
check("transcribeAudio có đường đi (hết 404)", routed(tr), JSON.stringify(tr).slice(0, 160));
check("trả record có trường `text` — renderer rút đúng trường này", typeof tr.json?.text === "string", JSON.stringify(tr.json).slice(0, 160));
const bad = await gw("transcribeAudio", { audioBase64: "!!!khong-phai-base64!!!", mimeType: "audio/wav" });
check("âm thanh hỏng KHÔNG làm nổ cổng", routed(bad) && typeof bad.json?.text === "string", JSON.stringify(bad).slice(0, 160));

// ── dọn ────────────────────────────────────────────────────────────────────────────────────────
const del = [kho.id, cs.id, room.id, copy?.id, ...(copy?.memberIds ?? [])].filter(Boolean);
await gw("deleteAgents", { ids: del });
console.log(`\n(dọn ${del.length} bot thử)`);

console.log(`\n${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
