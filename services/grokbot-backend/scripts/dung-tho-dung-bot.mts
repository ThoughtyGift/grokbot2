/**
 * Dựng "Thợ dựng bot" — bot của mình chuyên dựng bot khác — và đưa nó lên hàng Featured của Marketplace local.
 *
 *   npx tsx services/grokbot-backend/scripts/dung-tho-dung-bot.mts            # backend :8788 phải đang chạy
 *   GW=http://127.0.0.1:8788/gw/api GW_TOKEN_FILE=/opt/grokbot2/shared/data/gateway-token.txt npx tsx …   # trên VPS
 *
 * Đây là câu trả lời cho "tab Bots của app gốc có dr eggbot, Overheard, Tradbot… — trích sang được không?": không kéo
 * nội dung của hãng (legal.md), mà dựng bot ĐẦU TIÊN của mình cùng hình dạng: nổi bật, mô tả "làm gì · cho ai", hỏi vài
 * câu rồi dựng. 0 lượt model: hồ sơ + skill là hằng trong `src/tho-dung-bot.ts`, mẫu tạo ngoài tiến trình bằng
 * `mau-bot-ngoai.mts` (cùng cách `e2e-mau-bot`), listing qua gateway với `featured:true` (chỉ chủ vận hành đặt được).
 *
 * Chạy lại an toàn: bot đã có (theo tên) thì dùng lại, skill lệch thì sửa tại chỗ, mẫu đã có thì chỉ cập nhật listing.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TEN_THO, MO_TA_THO, SOP_THO, TEN_SKILL, MO_TA_SKILL, NOI_DUNG_SKILL } from "../src/tho-dung-bot.ts";

const GW = process.env.GW ?? "http://127.0.0.1:8788/gw/api";
const TOKEN = process.env.GW_TOKEN_FILE ? readFileSync(process.env.GW_TOKEN_FILE, "utf8").trim() : (process.env.GW_TOKEN ?? "");
const OWNER = process.env.MAU_OWNER ?? "auth0|grokbot2-user";
const NGOAI = join(dirname(fileURLToPath(import.meta.url)), "mau-bot-ngoai.mts");
type J = any;
const gw = async (m: string, body: Record<string, unknown> = {}): Promise<J> => {
  const r = await fetch(`${GW}/${m}`, { method: "POST", headers: { "content-type": "application/json", ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}) }, body: JSON.stringify(body) });
  return r.json().catch(() => null);
};
const ngoai = (moTa: string, ...args: string[]): J => JSON.parse(execFileSync("npx", ["tsx", NGOAI, ...args],
  { encoding: "utf8", shell: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, MAU_OWNER: OWNER, MAU_MO_TA: moTa } }).trim().split("\n").pop()!);

// 1 · bot
const roster: J[] = (await gw("listAgents")) ?? [];
let bot = roster.find((a) => a.name === TEN_THO);
if (bot) console.log(`bot đã có: ${bot.id}`);
else {
  // Mô tả kiểu thẻ đứng TRƯỚC (thẻ Marketplace cắt vài dòng đầu), SOP theo sau — cả hai cùng vào lời nhắc hệ thống.
  bot = (await gw("createAgent", { name: TEN_THO, description: `${MO_TA_THO}

${SOP_THO}` }))?.agent;
  if (!bot?.id) { console.error("không tạo được bot:", bot); process.exit(1); }
  console.log(`tạo bot: ${bot.id}`);
}

// 2 · skill (tạo hoặc nâng tại chỗ)
const skills: J[] = (await gw("getAgentWorkflows", { id: bot.id })) ?? [];
const co = skills.find((w) => w.name === TEN_SKILL);
if (!co) {
  await gw("createAgentWorkflow", { agentId: bot.id, name: TEN_SKILL, description: MO_TA_SKILL, instructions: NOI_DUNG_SKILL });
  console.log("tạo skill:", TEN_SKILL);
} else if (co.instructions !== NOI_DUNG_SKILL || co.description !== MO_TA_SKILL) {
  await gw("updateAgentWorkflow", { workflowId: co.id, agentId: bot.id, name: TEN_SKILL, description: MO_TA_SKILL, instructions: NOI_DUNG_SKILL });
  console.log("nâng skill tại chỗ:", co.id);
} else console.log("skill đúng bản:", co.id);

// 3 · mẫu (ngoài tiến trình, như e2e-mau-bot) — đã có thì giữ, vì mẫu là thứ người dùng đã import theo version
// Thân thẻ = MO_TA_THO (2–4 câu), KHÔNG phải description của bot (mô tả + SOP — đo 06/09: thẻ hiện cả SOP). Lệch thì
// bản chờ mới với thân thẻ đúng, xuất bản ngay.
let tpl = await gw("getBotTemplateForSourceAgent", { sourceAgentId: bot.id });
if (!tpl?.shareId || (tpl.description ?? tpl.body) !== MO_TA_THO) {
  const t = ngoai(MO_TA_THO, "stage", bot.id);
  if (!t.shareId) { console.error("không tạo được mẫu:", t); process.exit(1); }
  tpl = await gw("getBotTemplateForSourceAgent", { sourceAgentId: bot.id });
  console.log(`mẫu ${tpl?.shareId} bản ${t.version} (${t.skills} skill) — thân thẻ đã đặt`);
} else console.log(`mẫu đã có: ${tpl.shareId} v${tpl.activeVersion ?? "?"}`);

// 4 · listing nổi bật
const l = await gw("publishBotListing", { shareId: tpl.shareId, category: "productivity", featured: true });
console.log("listing:", JSON.stringify(l)?.slice(0, 200));
const pub = await gw("listPublicBotMarketplace", {});
const featured = (pub?.featuredListings ?? []).map((x: J) => x.name ?? x.slug);   // reply 0.43: `featuredListings` + `listings` + `nextPageToken`
console.log("Featured trên Marketplace local:", featured.join(" · ") || "(trống)");
process.exit(featured.some((n: string) => n === TEN_THO || String(n).includes("tho-dung-bot")) ? 0 : 1);
