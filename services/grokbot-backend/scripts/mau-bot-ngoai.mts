/**
 * Tạo / xoá mẫu bot NGOÀI tiến trình backend — trợ thủ của `e2e-mau-bot.mjs`.
 *
 *   npx tsx services/grokbot-backend/scripts/mau-bot-ngoai.mts create <agentId>   → {shareId, skills, routines}
 *   npx tsx services/grokbot-backend/scripts/mau-bot-ngoai.mts delete <shareId>
 *   MAU_MO_TA="<thân thẻ>" npx tsx … stage <agentId>   → bản chờ với thân thẻ riêng, xuất bản ngay → {shareId, version}
 *
 * Vì sao cần: cửa TẠO mẫu không có lệnh gateway (hãng cấp `shareId` ở máy chủ; client chỉ xuất bản thứ
 * đã có), bên mình tạo bằng tool `share_bot_template` trong một lượt chat. Bài đo không muốn tốn một lượt
 * model, nên tạo thẳng vào kho ở đây; backend đọc file kho mỗi lần gọi nên thấy ngay.
 *
 * Chủ đi qua ENV `MAU_OWNER` (mặc định chủ đơn `auth0|grokbot2-user`) — `|` trong authId qua argv bị
 * shell hiểu là pipe.
 *
 * Routine (06/09): kho routine nằm trong SQLite mà backend đang giữ mở (WAL, một kết nối ghi — `store.ts`), và
 * `automations.ts` kéo theo `chat.js`; nên KHÔNG import nó ở đây mà hỏi backend đang chạy qua gateway
 * `getAgentAutomations{id}` (`GW`, mặc định :8788; `GW_TOKEN`/`GW_TOKEN_FILE` khi `GROKBOT2_AUTH=enforce`) rồi tiêm
 * vào nguồn `routines`. Backend không lên thì mẫu vẫn dựng được, chỉ không chở routine — in `routines: null` để bài đo
 * phân biệt "không có" với "không hỏi được".
 */
const [, , lenh, a] = process.argv;
const owner = process.env.MAU_OWNER ?? "auth0|grokbot2-user";
const T = await import("../src/bot-templates.ts");
const W = await import("../src/workflows.ts");
const GW = process.env.GW ?? "http://127.0.0.1:8788/gw/api";
const TOKEN = process.env.GW_TOKEN_FILE ? (await import("node:fs")).readFileSync(process.env.GW_TOKEN_FILE, "utf8").trim() : (process.env.GW_TOKEN ?? "");
type RoutineWire = { id: string; name: string; prompt: string; schedule?: string; trigger?: unknown; triggerDescription?: string; scheduleDescription?: string };
/** Routine của bot theo hình client (`toClientAutomation`): cron nằm ở `schedule`, `trigger` là object — recipe cần chuỗi cron. */
async function routineTuBackend(agentId: string): Promise<RoutineWire[] | null> {
  try {
    const r = await fetch(`${GW}/getAgentAutomations`, { method: "POST", headers: { "content-type": "application/json", ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}) }, body: JSON.stringify({ id: agentId }) });
    if (!r.ok) return null;
    const j = await r.json();
    return Array.isArray(j) ? j as RoutineWire[] : null;
  } catch { return null; }
}
const routineCua = new Map<string, RoutineWire[]>();
if (lenh === "create" || lenh === "stage") { const ds = await routineTuBackend(a); if (ds) routineCua.set(a, ds); }
const soRoutine = (agentId: string): number | null => routineCua.has(agentId) ? routineCua.get(agentId)!.length : null;
T.bindTemplateSources({
  skills: (agentId: string) => W.forAgent({ agentId }).map((w) => ({ name: w.name, description: w.description, content: w.instructions })),
  routines: (agentId: string) => (routineCua.get(agentId) ?? []).map((r) => ({
    slug: r.id, name: r.name, description: r.triggerDescription ?? r.scheduleDescription ?? "", content: r.prompt,
    trigger: typeof r.schedule === "string" ? r.schedule : undefined,
  })),
});
if (lenh === "create") {
  const tpl = await T.createTemplateForAgent(a, owner);
  if (!tpl) { console.log(JSON.stringify({ error: "không tạo được mẫu — bot không có trong roster?" })); process.exit(1); }
  const pub = await T.publishBotTemplate(tpl.shareId, 1, owner);
  T.setBotTemplateVisibility(tpl.shareId, "public", owner);
  console.log(JSON.stringify({ shareId: tpl.shareId, skills: pub?.snapshot.recipe.skills.length ?? 0, routines: soRoutine(a) === null ? null : (pub?.snapshot.recipe.routines.length ?? 0) }));
} else if (lenh === "stage") {
  // Bản CHỜ với thân thẻ riêng (ENV `MAU_MO_TA`, 2–4 câu) rồi xuất bản ngay — cho script dựng danh mục: `create` lấy
  // description của bot làm thân thẻ, mà description của bot là mô tả + SOP ⇒ thẻ Marketplace hiện cả SOP (đo 06/09).
  const moTa = process.env.MAU_MO_TA ?? "";
  const tpl = await T.stageTemplateForAgent(a, { description: moTa, visibility: "public" }, owner);
  if (!tpl) { console.log(JSON.stringify({ error: "không tạo được bản chờ — bot không có trong roster?" })); process.exit(1); }
  const v = tpl.staged?.version ?? tpl.version;
  const pub = await T.publishBotTemplate(tpl.shareId, v, owner);
  T.setBotTemplateVisibility(tpl.shareId, "public", owner);
  console.log(JSON.stringify({ shareId: tpl.shareId, version: v, skills: pub?.snapshot.recipe.skills.length ?? 0, routines: soRoutine(a) === null ? null : (pub?.snapshot.recipe.routines.length ?? 0) }));
} else if (lenh === "delete") {
  T.deleteBotTemplate(a, owner);
  console.log(JSON.stringify({ deleted: a }));
} else {
  console.log(JSON.stringify({ error: `lệnh lạ: ${lenh}` }));
  process.exit(2);
}
process.exit(0);
