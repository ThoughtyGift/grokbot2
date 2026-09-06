/**
 * Dựng DANH MỤC bot mẫu của mình lên Marketplace — chín bot (`src/danh-muc-mau.ts`), mỗi nhóm một bot, 0 lượt model.
 *
 *   npx tsx services/grokbot-backend/scripts/dung-danh-muc-mau.mts            # backend :8788 đang chạy
 *   GW=http://127.0.0.1:8788/gw/api GW_TOKEN_FILE=/opt/grokbot2/shared/data/gateway-token.txt npx tsx …   # VPS
 *
 * Mỗi bot: tạo (hoặc dùng lại theo tên) → skill tạo/nâng tại chỗ → mẫu (ngoài tiến trình, `mau-bot-ngoai.mts`, như
 * `e2e-mau-bot`) → listing đúng nhóm, `featured` theo danh mục. Chạy lại an toàn. Từ chối chạy khi `loiDanhMuc` báo lỗi —
 * một mẫu có trường rỗng là client 0.43 nuốt im lặng lúc import.
 *
 * Cặp với `dung-tho-dung-bot.mts` (Thợ dựng bot, thẻ Featured thứ tư). Vì sao tự viết thay vì trích của hãng: xem đầu
 * `src/danh-muc-mau.ts`.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DANH_MUC, loiDanhMuc } from "../src/danh-muc-mau.ts";

const GW = process.env.GW ?? "http://127.0.0.1:8788/gw/api";
const TOKEN = process.env.GW_TOKEN_FILE ? readFileSync(process.env.GW_TOKEN_FILE, "utf8").trim() : (process.env.GW_TOKEN ?? "");
const OWNER = process.env.MAU_OWNER ?? "auth0|grokbot2-user";
const NGOAI = join(dirname(fileURLToPath(import.meta.url)), "mau-bot-ngoai.mts");
type J = any;
const gw = async (m: string, body: Record<string, unknown> = {}): Promise<J> => {
  const r = await fetch(`${GW}/${m}`, { method: "POST", headers: { "content-type": "application/json", ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}) }, body: JSON.stringify(body) });
  return r.json().catch(() => null);
};
const ngoai = (...args: string[]): J => JSON.parse(execFileSync("npx", ["tsx", NGOAI, ...args],
  { encoding: "utf8", shell: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, MAU_OWNER: OWNER } }).trim().split("\n").pop()!);

const loi = loiDanhMuc();
if (loi.length) { console.error("danh mục có lỗi — không dựng:\n  " + loi.join("\n  ")); process.exit(1); }

const roster: J[] = (await gw("listAgents")) ?? [];
let dung = 0;
for (const b of DANH_MUC) {
  let bot = roster.find((a) => a.name === b.name);
  if (!bot) {
    bot = (await gw("createAgent", { name: b.name, description: `${b.moTa}\n\n${b.sop}` }))?.agent;
    if (!bot?.id) { console.error(`✗ ${b.name}: không tạo được bot`, bot); continue; }
  }
  const skills: J[] = (await gw("getAgentWorkflows", { id: bot.id })) ?? [];
  let moi = 0, nang = 0;
  for (const s of b.skills) {
    const co = skills.find((w) => w.name === s.name);
    if (!co) { await gw("createAgentWorkflow", { agentId: bot.id, name: s.name, description: s.description, instructions: s.instructions }); moi++; }
    else if (co.instructions !== s.instructions || co.description !== s.description) { await gw("updateAgentWorkflow", { workflowId: co.id, agentId: bot.id, name: s.name, description: s.description, instructions: s.instructions }); nang++; }
  }
  let tpl = await gw("getBotTemplateForSourceAgent", { sourceAgentId: bot.id });
  if (!tpl?.shareId) {
    const t = ngoai("create", bot.id);
    if (!t.shareId) { console.error(`✗ ${b.name}: không tạo được mẫu`, t); continue; }
    tpl = await gw("getBotTemplateForSourceAgent", { sourceAgentId: bot.id });
  }
  const l = await gw("publishBotListing", { shareId: tpl.shareId, category: b.category, featured: b.featured === true });
  if (!l?.slug) { console.error(`✗ ${b.name}: không đăng được listing`, l); continue; }
  dung++;
  console.log(`✓ ${b.name.padEnd(22)} ${bot.id.padEnd(11)} ${b.category.padEnd(18)} skill +${moi}/~${nang}  mẫu ${tpl.shareId}  ${l.featured ? "★" : " "} ${l.slug}`);
}
const pub = await gw("listPublicBotMarketplace", {});
const f = (pub?.featuredListings ?? []).map((x: J) => x.name);
const n = (pub?.listings ?? []).length + f.length;
console.log(`\nMarketplace: ${n} listing · Featured: ${f.join(" · ")}`);
process.exit(dung === DANH_MUC.length ? 0 : 1);
