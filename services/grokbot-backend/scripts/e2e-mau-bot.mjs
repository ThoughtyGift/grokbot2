/**
 * E2E mẫu bot khớp 0.43 (bước C) — đo qua `/gw/api` của backend THẬT đang chạy.
 *
 *   node services/grokbot-backend/scripts/e2e-mau-bot.mjs        (cwd = repo root, backend đã lên)
 *
 * Tự chứa, KHÔNG đụng bot thật của người dùng: tạo một bot nguồn tạm + 2 skill, đóng thành mẫu công khai
 * (ngoài tiến trình — xem `mau-bot-ngoai.mts`), rồi đi đúng đường Import Bot của Marketplace:
 *
 *   getPublicBotTemplate{shareId}         → `BotTemplateImport` qua được validator của renderer 0.43
 *   createAgentFromTemplate{expectedActiveVersion lệch} → từ chối · khớp → bot MỚI có đủ skill
 *
 * và dọn hết: hai bot, mẫu, và cả skill của hai bot — vì `deleteAgent` KHÔNG cascade sang kho skill
 * (đo 05/09: xoá bot xong `getAgentWorkflows{id}` vẫn trả 2).
 */
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const GW = process.env.GW ?? "http://127.0.0.1:8788/gw/api";
const OWNER = process.env.MAU_OWNER ?? "auth0|grokbot2-user";
const NGOAI = join(dirname(fileURLToPath(import.meta.url)), "mau-bot-ngoai.mts");
const gw = async (m, body = {}) => {
  const r = await fetch(`${GW}/${m}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return r.json().catch(() => null);
};
const fails = [];
const ok = (name, cond, detail = "") => { console.log(`${cond ? "  ok  " : "  FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); if (!cond) fails.push(name); };
const ngoai = (...args) => JSON.parse(execFileSync("npx", ["tsx", NGOAI, ...args],
  { encoding: "utf8", shell: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, MAU_OWNER: OWNER } }).trim().split("\n").pop());
const xoaSkillCua = async (id) => { for (const w of (await gw("getAgentWorkflows", { id })) ?? []) await gw("deleteAgentWorkflow", { workflowId: w.id }); };

const health = await fetch(`${GW.replace(/\/api$/, "")}/health`).then((r) => r.status).catch(() => 0);
if (health !== 200) { console.log(`backend chưa lên (${GW} → ${health}) — bật \`pnpm backend\` trước`); process.exit(1); }

// 1 · bot nguồn tạm với 2 skill (một cái thiếu mô tả — chỗ validator client hay từ chối)
const nguon = (await gw("createAgent", { name: "E2E nguồn mẫu (xoá)", description: "Bot tạm của bài đo mẫu." }))?.agent;
if (!nguon?.id) { console.log("không tạo được bot nguồn"); process.exit(1); }
await gw("createAgentWorkflow", { agentId: nguon.id, name: "Skill E2E một", description: "Cuối tuần", instructions: "1. mở báo cáo\n2. gửi" });
await gw("createAgentWorkflow", { agentId: nguon.id, name: "Skill E2E hai", description: "", instructions: "chỉ có bước, không mô tả" });
console.log(`bot nguồn: ${nguon.name} (${nguon.id}), ${(await gw("getAgentWorkflows", { id: nguon.id }))?.length} skill`);

let shareId = null, botMoi = null;
try {
  const tao = ngoai("create", nguon.id);
  shareId = tao.shareId;
  ok("shareId 21 ký tự [A-Za-z0-9_-] (regex client kiểm trước khi gọi)", /^[A-Za-z0-9_-]{21}$/.test(shareId ?? ""), shareId);
  ok("mẫu chở 2 skill", tao.skills === 2, String(tao.skills));
  const mine = await gw("getBotTemplateForSourceAgent", { sourceAgentId: nguon.id });
  ok("gateway thấy mẫu trong kho của chủ", mine?.shareId === shareId);

  const imp = await gw("getPublicBotTemplate", { shareId });
  ok("getPublicBotTemplate → BotTemplateImport {expectedActiveVersion, instructions, view}",
    imp && imp.expectedActiveVersion === 1 && typeof imp.instructions === "string" && imp.view?.shareId === shareId, JSON.stringify(imp)?.slice(0, 200));
  ok("instructions = mô tả bot", imp?.instructions === "Bot tạm của bài đo mẫu.");
  ok("view.version = activeVersion = expectedActiveVersion · active · published", imp?.view?.published === true && imp?.view?.active === true && imp?.view?.version === 1 && imp?.view?.activeVersion === 1);
  ok("view KHÔNG có sourceAgentId (isPackedImportView đòi null)", imp && !("sourceAgentId" in imp.view));
  ok("view.skills = 2", imp?.view?.skills?.length === 2);
  ok("skill thiếu mô tả được lấp — schema client đòi min(1)", (imp?.view?.skills ?? []).every((s) => s.name && s.description && s.content), JSON.stringify(imp?.view?.skills?.map((s) => s.description)));
  ok("creatorName suy từ tài khoản", typeof imp?.view?.creatorName === "string" && imp.view.creatorName.length > 0, imp?.view?.creatorName);
  ok("shareUrl dạng hãng", imp?.view?.shareUrl === `https://x.ai/bot/${shareId}`);
  ok("shareId sai mẫu → null", (await gw("getPublicBotTemplate", { shareId: "khong-du-21" })) === null);

  const tuChoi = await gw("createAgentFromTemplate", { shareId, expectedActiveVersion: 2, name: "E2E mẫu (xoá)" });
  ok("expectedActiveVersion lệch → từ chối có chữ", tuChoi?.ok === false && typeof tuChoi.reason === "string", JSON.stringify(tuChoi)?.slice(0, 100));
  const made = await gw("createAgentFromTemplate", { shareId, expectedActiveVersion: 1, name: "E2E mẫu (xoá)", creatorContext: "marketplace" });
  botMoi = made?.agent?.id ?? null;
  ok("expectedActiveVersion khớp → bot mới", typeof botMoi === "string" && botMoi !== nguon.id);
  if (botMoi) {
    ok("tên trên thẻ đè tên mẫu", made.agent.name === "E2E mẫu (xoá)", made.agent.name);
    const ws = await gw("getAgentWorkflows", { id: botMoi });
    ok("bot mới có đủ 2 skill từ recipe, thuộc bot MỚI, ruột giữ nguyên",
      Array.isArray(ws) && ws.length === 2 && ws.every((w) => w.agentId === botMoi) && ws.some((w) => w.name === "Skill E2E một" && /mở báo cáo/.test(w.instructions)),
      JSON.stringify(ws?.map((w) => [w.name, w.agentId])));
    ok("bot nguồn vẫn đúng 2 skill", (await gw("getAgentWorkflows", { id: nguon.id }))?.length === 2);
  }
} finally {
  for (const id of [botMoi, nguon.id].filter(Boolean)) { await xoaSkillCua(id); await gw("deleteAgent", { id }); }
  if (shareId) ngoai("delete", shareId);
  ok("dọn xong: không còn mẫu", (await gw("getBotTemplateForSourceAgent", { sourceAgentId: nguon.id })) === null);
  ok("dọn xong: không còn skill mồ côi", ((await gw("getAgentWorkflows", { id: nguon.id }))?.length ?? 0) === 0 && (!botMoi || ((await gw("getAgentWorkflows", { id: botMoi }))?.length ?? 0) === 0));
  const conLai = (await gw("listAgents")) ?? [];
  ok("dọn xong: không còn bot E2E trong roster", !(Array.isArray(conLai) ? conLai : conLai.agents ?? []).some((a) => /E2E (nguồn )?mẫu/.test(a.name ?? "")));
}
console.log(fails.length ? `\nĐỎ ${fails.length}: ${fails.join(" · ")}` : "\nXANH — mẫu bot khớp 0.43 qua /gw/api");
process.exit(fails.length ? 1 : 0);
