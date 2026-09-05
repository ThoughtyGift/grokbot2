/**
 * Mẫu bot — dựng một đội một lần, phát cho máy khác.
 *
 *   npx tsx --test services/grokbot-backend/src/bot-templates.test.ts
 *
 * Bài quan trọng nhất là **vòng tròn cả đội**: nhóm 3 bot có SOP riêng → mẫu → dựng lại → phải ra
 * nhóm 3 bot với đúng SOP đó. Dựng lại mỗi cái vỏ nhóm rỗng thì người nhận có một cái phòng không
 * ai ở trong — mà đó chính là thứ tính năng này tồn tại để tránh.
 *
 * Từ 05/09 mẫu chở thêm **recipe** theo đúng hình dạng client 0.43 vẽ ở trang chi tiết (Instructions ·
 * Memories · Skills · Routines · Integrations) và dựng lại được skill + routine cho bot mới. Nguồn của
 * 5 mục được TIÊM vào (`bindTemplateSources`) — bài này tiêm giả, nên không đụng kho skill/routine thật.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

process.env.GROKBOT2_ALLOW_WRITE = "1";
/**
 * Thư mục kho — phải suy y hệt phần cài đặt, tức đọc `GROKBOT2_DATA_DIR` TRƯỚC.
 *
 * Trước đây dòng này suy đường dẫn từ vị trí module, và đó là một cái bẫy có hai nửa. Phiên trước
 * tôi vá nửa thứ nhất (phần cài đặt) mà để nguyên nửa này, nên kết quả TỆ HƠN lúc chưa vá:
 *
 *   - phần cài đặt ghi vào thư mục tạm mà runner dựng   → đúng
 *   - `sach()` ở đây đi xoá `.data/` THẬT của người dùng → mỗi lần chạy test là một lần xoá
 *   - thư mục tạm không bao giờ được dọn                → rác dồn giữa các bài, và bài
 *     "đọc không được để lại dấu vết gì" đỏ vì đọc trúng rác của bài trước
 *
 * Mười bài đỏ chỉ là triệu chứng; cái mất là dữ liệu. Vá một nửa một cái bẫy thì cái bẫy vẫn còn,
 * chỉ khác là nó không còn báo động nữa.
 */
/*
 * KHÔNG có biến cách ly ⇒ TỰ dựng thư mục tạm. Bản trước chỉ đọc env rồi rơi về `.data` thật khi env
 * vắng — tức chạy `npx tsx --test` trần (đúng cách bảng theo dõi §7 từng dặn) là `sach()` xoá kho THẬT
 * của người dùng. Đo 05/09: `.data/bot-templates`, `.data/box-secrets`, `.data/mcp-prefs` đều biến mất
 * sau một lượt chạy bộ test đầy đủ. Một bài test không được có đường nào dẫn tới dữ liệu thật.
 */
if (!process.env.GROKBOT2_DATA_DIR) process.env.GROKBOT2_DATA_DIR = mkdtempSync(join(tmpdir(), "gb2-templates-"));
const DATA_DIR = process.env.GROKBOT2_DATA_DIR
  ?? join(dirname(fileURLToPath(import.meta.url)), "..", ".data");
const DIR = join(DATA_DIR, "bot-templates");
const sach = (): void => { try { rmSync(DIR, { recursive: true, force: true }); } catch { /* chưa có */ } };

const { runWithOwner: as } = await import("./request-context.js");
const { createAgent, createGroup, updateAgent } = await import("./directory/index.js");
const { agents } = await import("./chat/state.js");
const T = await import("./bot-templates.js");

const A = "local|nguoi-a@vi-du.vn";
const B = "local|nguoi-b@vi-du.vn";

/** Nguồn GIẢ cho 5 mục — ghi lại mọi lệnh dựng để bài test đếm. */
const daDung: { skills: Array<{ agentId: string; name: string }>; routines: Array<{ agentId: string; slug: string }>; memory: string[] } =
  { skills: [], routines: [], memory: [] };
const skillCua = new Map<string, Array<{ name: string; description?: string; content?: string }>>();
const routineCua = new Map<string, Array<{ slug: string; name?: string; description?: string; content?: string; trigger?: string }>>();
const nhoCua = new Map<string, Array<{ kind?: "profile" | "log"; content: string }>>();
T.bindTemplateSources({
  skills: (agentId) => skillCua.get(agentId) ?? [],
  routines: (agentId) => routineCua.get(agentId) ?? [],
  memory: async (agentId) => nhoCua.get(agentId) ?? [],
  plugins: () => [{ pluginId: "7", name: "Gmail", description: "Đọc thư" }],
  restoreSkill: (agentId, s) => { daDung.skills.push({ agentId, name: s.name }); },
  restoreRoutine: (agentId, r) => { daDung.routines.push({ agentId, slug: r.slug }); },
  restoreMemory: async (agentId, m) => { daDung.memory.push(`${agentId}:${m.content}`); },
});

/** Dựng đội Shopee thu nhỏ: nhóm + 2 thành viên, mỗi con một SOP. */
function doiShopee(owner: string) {
  return as(owner, () => {
    const kho = createAgent({ name: "Kho", description: "Ưu tiên Hỏa Tốc, cutoff 18:00." });
    const cs = createAgent({ name: "CS", description: "Trả Shopee Chat trong 2 phút." });
    return createGroup({ name: "Shopee Ops", memberAgentIds: [kho.id, cs.id] });
  });
}

test("vòng tròn cả ĐỘI: nhóm 2 bot có SOP → mẫu → dựng lại đủ người, đủ SOP", async () => {
  sach();
  const g = doiShopee(A);
  const tpl = (await as(A, () => T.createTemplateForAgent(g.id)))!;
  assert.equal(tpl.snapshot.isGroup, true);
  assert.deepEqual(tpl.snapshot.members.map((m) => m.name), ["Kho", "CS"]);

  await as(A, () => T.publishBotTemplate(tpl.shareId, 1));
  const made = (await as(A, () => T.createAgentFromTemplate({ shareId: tpl.shareId, name: "Shopee Ops (bản sao)" })))!;
  const rec = made.agent as { id: string; name: string; isGroup?: boolean; memberIds?: string[] };

  assert.equal(rec.name, "Shopee Ops (bản sao)", "tên trên thẻ phải đè tên của mẫu");
  assert.equal(rec.isGroup, true);
  assert.equal(rec.memberIds?.length, 2, "phòng rỗng là đúng thứ tính năng này phải tránh");
  const dựng = (rec.memberIds ?? []).map((id) => agents.get(id)!);
  assert.deepEqual(dựng.map((m) => m.name), ["Kho", "CS"]);
  assert.match(dựng[0].description ?? "", /Hỏa Tốc/, "SOP thành viên phải đi theo");
  assert.match(dựng[1].description ?? "", /2 phút/);
});

test("bot lẻ cũng dựng lại được, kèm mô tả", async () => {
  sach();
  const bot = as(A, () => createAgent({ name: "Kế toán", description: "GMV không phải tiền về." }));
  const tpl = (await as(A, () => T.createTemplateForAgent(bot.id)))!;
  const made = (await as(A, () => T.createAgentFromTemplate({ shareId: tpl.shareId })))!;
  const rec = made.agent as { name: string; description?: string; isGroup?: boolean };
  assert.equal(rec.name, "Kế toán");
  assert.match(rec.description ?? "", /GMV/);
  assert.notEqual(rec.isGroup, true);
});

test("shareId đúng mẫu client kiểm TRƯỚC khi gọi: 21 ký tự [A-Za-z0-9_-]", async () => {
  sach();
  // Cả 0.29 lẫn 0.43 kiểm `/^[A-Za-z0-9_-]{21}$/` ở host trước khi gọi getPublicBotTemplate — id sai
  // mẫu thì cửa import không bao giờ tới được backend, và không lỗi nào nổi lên.
  const bot = as(A, () => createAgent({ name: "Mau" }));
  const tpl = (await as(A, () => T.createTemplateForAgent(bot.id)))!;
  assert.match(tpl.shareId, T.SHARE_ID_RE);
  assert.equal(tpl.shareId.length, 21);
  const khac = (await as(A, () => T.createTemplateForAgent(as(A, () => createAgent({ name: "Mau 2" })).id)))!;
  assert.notEqual(tpl.shareId, khac.shareId);
});

test("recipe chở đủ 5 mục theo hình dạng 0.43: profile · memory · skills · routines · plugins", async () => {
  sach();
  const bot = as(A, () => createAgent({ name: "Ads", description: "Tối ưu ROAS theo tuần." }));
  skillCua.set(bot.id, [{ name: "Báo cáo ROAS", description: "Cuối tuần", content: "1. Mở Ads Manager…" }]);
  routineCua.set(bot.id, [{ slug: "automation-9", name: "Quét ngân sách", description: "9:00 mỗi ngày", content: "Kiểm ngân sách còn lại" }]);
  const nhap = (await as(A, () => T.createTemplateForAgent(bot.id)))!;
  const tpl = (await as(A, () => T.publishBotTemplate(nhap.shareId, 1)))!;
  const r = tpl.snapshot.recipe;
  assert.equal(r.profile.name, "Ads");
  assert.equal(r.profile.description, "Tối ưu ROAS theo tuần.");
  assert.deepEqual(r.skills.map((s) => s.name), ["Báo cáo ROAS"]);
  assert.equal(r.skills[0].content, "1. Mở Ads Manager…", "thân skill phải đi theo, không chỉ cái tên");
  assert.deepEqual(r.routines.map((x) => x.slug), ["automation-9"]);
  assert.deepEqual(r.plugins.map((p) => p.pluginId), ["7"]);
  assert.deepEqual(r.memory, [], "bot này không có trí nhớ → mảng rỗng, không undefined");
});

test("memory (nguồn ASYNC — trên box) vào recipe, và được dựng lại cho bot mới", async () => {
  sach();
  daDung.memory.length = 0;
  const bot = as(A, () => createAgent({ name: "Nho" }));
  nhoCua.set(bot.id, [{ kind: "log", content: "Khách hay hỏi size." }]);
  const tpl = (await as(A, () => T.createTemplateForAgent(bot.id)))!;
  assert.deepEqual(tpl.snapshot.recipe.memory, [{ kind: "log", content: "Khách hay hỏi size." }]);
  await as(A, () => T.publishBotTemplate(tpl.shareId, 1));
  const made = (await as(A, () => T.createAgentFromTemplate({ shareId: tpl.shareId })))!;
  const moi = (made.agent as { id: string }).id;
  assert.deepEqual(daDung.memory, [`${moi}:Khách hay hỏi size.`]);
});

test("dựng lại từ mẫu: skill + routine + memory của recipe được tạo cho ĐÚNG bot mới", async () => {
  sach();
  daDung.skills.length = 0; daDung.routines.length = 0; daDung.memory.length = 0;
  const bot = as(A, () => createAgent({ name: "Nguon", description: "SOP nguồn" }));
  skillCua.set(bot.id, [{ name: "Skill A", content: "bước A" }, { name: "Skill B", content: "bước B" }]);
  routineCua.set(bot.id, [{ slug: "automation-1", name: "Sáng", description: "8:00", content: "chào" }]);
  const tpl = (await as(A, () => T.createTemplateForAgent(bot.id)))!;
  await as(A, () => T.publishBotTemplate(tpl.shareId, 1));
  const made = (await as(A, () => T.createAgentFromTemplate({ shareId: tpl.shareId, expectedActiveVersion: 1 })))!;
  const moi = (made.agent as { id: string }).id;
  assert.notEqual(moi, bot.id);
  assert.deepEqual(daDung.skills, [{ agentId: moi, name: "Skill A" }, { agentId: moi, name: "Skill B" }]);
  assert.deepEqual(daDung.routines, [{ agentId: moi, slug: "automation-1" }]);
});

test("expectedActiveVersion lệch bản đang active → từ chối (client dùng nó để không import bản cũ)", async () => {
  sach();
  const bot = as(A, () => createAgent({ name: "Ver" }));
  const tpl = (await as(A, () => T.createTemplateForAgent(bot.id)))!;
  await as(A, () => T.publishBotTemplate(tpl.shareId, 3));
  assert.equal(await as(A, () => T.createAgentFromTemplate({ shareId: tpl.shareId, expectedActiveVersion: 2 })), null);
  assert.notEqual(await as(A, () => T.createAgentFromTemplate({ shareId: tpl.shareId, expectedActiveVersion: 3 })), null);
  // Không gửi thì không kiểm — client 0.29 không gửi trường này.
  assert.notEqual(await as(A, () => T.createAgentFromTemplate({ shareId: tpl.shareId })), null);
});

test("đọc CÔNG KHAI xuyên chủ: B đọc được mẫu public+đã xuất bản của A, kèm tên chủ", async () => {
  sach();
  const bot = as(A, () => createAgent({ name: "Cong khai", description: "Cho cả nhà" }));
  const tpl = (await as(A, () => T.createTemplateForAgent(bot.id)))!;
  // Chưa xuất bản, chưa public → không ai thấy
  assert.equal(T.getPublicBotTemplate(tpl.shareId), null);
  await as(A, () => T.publishBotTemplate(tpl.shareId, 1));
  assert.equal(T.getPublicBotTemplate(tpl.shareId), null, "team thì vẫn không public");
  as(A, () => T.setBotTemplateVisibility(tpl.shareId, "public"));
  const pub = T.getPublicBotTemplate(tpl.shareId)!;
  assert.equal(pub.template.shareId, tpl.shareId);
  assert.equal(pub.ownerDisplayName, "nguoi-a", "tên hiển thị = phần trước @ của tài khoản, bỏ tiền tố nhà cung cấp");
  assert.equal(pub.template.snapshot.recipe.profile.description, "Cho cả nhà");
  // và B dựng được bot từ nó — đây là đường Import Bot của Marketplace
  const made = await as(B, () => T.createAgentFromTemplate({ shareId: tpl.shareId, expectedActiveVersion: 1 }));
  assert.notEqual(made, null);
  assert.equal(as(B, () => T.listBotTemplates()).length, 0, "import không làm B sở hữu mẫu của A");
  assert.equal(T.getPublicBotTemplate("khong-du-21-ky-tu"), null);
});

test("hình dạng trả cho renderer 0.43 (`BotTemplateImport`) qua được validator của client", async () => {
  sach();
  // isBotTemplateImport + isPackedImportView, trích 0.43 main-app.cjs: expectedActiveVersion nguyên ≥1 ·
  // view.shareId khớp regex · name/description không rỗng · avatar trong bảng · version===activeVersion
  // ===expectedActiveVersion · active/published true · KHÔNG có sourceAgentId · skills đủ 3 chuỗi min(1).
  const bot = as(A, () => createAgent({ name: "Import", description: "" }));   // mô tả rỗng — chỗ hay hỏng
  skillCua.set(bot.id, [{ name: "Thiếu mô tả", content: "bước 1" }]);          // thiếu description
  routineCua.set(bot.id, [{ slug: "automation-3", trigger: "0 8 * * *" }]);   // thiếu cả name/description/content
  const tpl = (await as(A, () => T.createTemplateForAgent(bot.id)))!;
  assert.equal(T.publicTemplateImport(tpl.shareId), null, "chưa public → null");
  await as(A, () => T.publishBotTemplate(tpl.shareId, 2));
  as(A, () => T.setBotTemplateVisibility(tpl.shareId, "public"));
  const imp = T.publicTemplateImport(tpl.shareId)!;
  assert.equal(imp.expectedActiveVersion, 2);
  assert.equal(typeof imp.instructions, "string");
  const v = imp.view;
  assert.match(v.shareId, T.SHARE_ID_RE);
  assert.equal(v.name, "Import");
  assert.ok(v.description.length > 0, "description rỗng là client từ chối cả mẫu");
  assert.ok((T.AVATAR_SHAPES as readonly string[]).includes(v.avatarShape));
  assert.ok((T.AVATAR_COLORS as readonly string[]).includes(v.avatarColor));
  assert.equal(v.shareUrl, `https://x.ai/bot/${tpl.shareId}`);
  assert.deepEqual([v.version, v.activeVersion, v.active, v.published], [2, 2, true, true]);
  assert.equal("sourceAgentId" in v, false, "isPackedImportView đòi sourceAgentId == null");
  assert.equal(v.creatorName, "nguoi-a");
  for (const s of v.skills) for (const k of ["name", "description", "content"] as const) assert.ok((s[k] ?? "").length > 0, `skill.${k} rỗng`);
  for (const r of v.routines) for (const k of ["slug", "name", "description", "content"] as const) assert.ok((r[k] ?? "").length > 0, `routine.${k} rỗng`);
  assert.equal(v.routines[0].trigger, "0 8 * * *", "cron của ta đi theo để dựng lại đúng nhịp");
});

test("mẫu mới là bản NHÁP — chưa xuất bản", async () => {
  sach();
  const bot = as(A, () => createAgent({ name: "Nhap" }));
  const tpl = (await as(A, () => T.createTemplateForAgent(bot.id)))!;
  // Máy trạng thái của renderer: activeVersion==null && published===false → chưa xuất bản.
  assert.equal(tpl.published, false);
  assert.equal(tpl.activeVersion, null);
  assert.equal(tpl.visibility, "team", "mặc định KHÔNG public — chia sẻ là việc người dùng tự chọn");
});

test("xuất bản chụp LẠI bot nguồn — sửa mô tả rồi bấm Publish phải ăn bản mới", async () => {
  sach();
  const bot = as(A, () => createAgent({ name: "Doi", description: "bản cũ" }));
  const tpl = (await as(A, () => T.createTemplateForAgent(bot.id)))!;
  as(A, () => updateAgent({ id: bot.id, description: "bản MỚI sau khi sửa" }));
  const pub = (await as(A, () => T.publishBotTemplate(tpl.shareId, 2)))!;
  assert.match(pub.snapshot.description, /bản MỚI/, "mẫu phải là ảnh của bot HÔM NAY");
  assert.match(pub.snapshot.recipe.profile.description, /bản MỚI/);
  assert.equal(pub.published, true);
  assert.equal(pub.activeVersion, 2);
});

test("chia sẻ hai lần vẫn MỘT mẫu, không đẻ thêm", async () => {
  sach();
  const bot = as(A, () => createAgent({ name: "Mot" }));
  const t1 = (await as(A, () => T.createTemplateForAgent(bot.id)))!;
  const t2 = (await as(A, () => T.createTemplateForAgent(bot.id)))!;
  assert.equal(t1.shareId, t2.shareId);
  assert.equal(as(A, () => T.listBotTemplates()).length, 1);
});

test("mẫu theo NGƯỜI — người B không thấy và không dựng được mẫu (chưa public) của A", async () => {
  sach();
  const bot = as(A, () => createAgent({ name: "Rieng" }));
  const tpl = (await as(A, () => T.createTemplateForAgent(bot.id)))!;
  assert.deepEqual(as(B, () => T.listBotTemplates()), []);
  assert.equal(as(B, () => T.getBotTemplateVersion(tpl.shareId, 1)), null);
  assert.equal(await as(B, () => T.createAgentFromTemplate({ shareId: tpl.shareId })), null);
});

test("đổi tầm nhìn, và xoá", async () => {
  sach();
  const bot = as(A, () => createAgent({ name: "Xoa" }));
  const tpl = (await as(A, () => T.createTemplateForAgent(bot.id)))!;
  assert.equal(as(A, () => T.setBotTemplateVisibility(tpl.shareId, "public"))?.visibility, "public");
  // Giá trị lạ phải rơi về "team", không được nhận bừa: đây là cờ quyết định ai đọc được mẫu.
  assert.equal(as(A, () => T.setBotTemplateVisibility(tpl.shareId, "ai-cung-doc"))?.visibility, "team");
  as(A, () => T.deleteBotTemplate(tpl.shareId));
  assert.deepEqual(as(A, () => T.listBotTemplates()), []);
});

test("shareId lạ / bot không tồn tại: trả null, không nổ", async () => {
  sach();
  assert.equal(as(A, () => T.getBotTemplateForSourceAgent("khong-co")), null);
  assert.equal(as(A, () => T.getBotTemplateForSourceAgent("")), null);
  assert.equal(await as(A, () => T.publishBotTemplate("tpl-ma", 1)), null);
  assert.equal(as(A, () => T.setBotTemplateVisibility("tpl-ma", "team")), null);
  assert.equal(await as(A, () => T.createAgentFromTemplate({ shareId: "tpl-ma" })), null);
  as(A, () => T.deleteBotTemplate("tpl-ma"));   // không được ném
});

test("ĐỌC là đọc: bot chưa chia sẻ thì trả null, KHÔNG tự đẻ mẫu", () => {
  sach();
  const bot = as(A, () => createAgent({ name: "Chua chia se" }));
  // Bản đầu tự tạo nháp ở đây, và app thật hiện "Delete Template" trên mọi bot dù chưa ai chia sẻ.
  // Renderer chỉ hỏi "có record không", không phân biệt nháp với đã xuất bản.
  assert.equal(as(A, () => T.getBotTemplateForSourceAgent(bot.id)), null);
  assert.deepEqual(as(A, () => T.listBotTemplates()), [], "đọc không được để lại dấu vết gì");
});

test("sau khi chia sẻ thì đọc mới thấy", async () => {
  sach();
  const bot = as(A, () => createAgent({ name: "Da chia se" }));
  const made = (await as(A, () => T.createTemplateForAgent(bot.id)))!;
  assert.equal(as(A, () => T.getBotTemplateForSourceAgent(bot.id))?.shareId, made.shareId);
});

test("0.43 import: bot mang ĐÚNG agentId client tự đúc + avatar chọn trên thẻ; setup trả recipe nhưng không bảo client gửi lời nhắc setup", async () => {
  const bot = as(A, () => createAgent({ name: "Kho", description: "Đếm tồn mỗi tối." }));
  const tpl = (await as(A, () => T.createTemplateForAgent(bot.id)))!;
  const UUID = randomUUID();   // kho test dùng CHUNG giữa các lần chạy (tmpdir/grokbot2-test-store) — id cố định thì lần hai đã "có rồi"
  const made = (await as(A, () => T.createAgentFromTemplate({ shareId: tpl.shareId, agentId: UUID, avatarShape: "gem", avatarColor: "green" })))!;
  const rec = made.agent as { id: string; avatarShape?: string; avatarColor?: string };
  assert.equal(rec.id, UUID, "client vẽ hàng roster mang id này TRƯỚC khi gọi — lệch là hàng ma");
  assert.equal(rec.avatarShape, "gem");
  assert.equal(rec.avatarColor, "green");
  assert.equal(made.setup.kind, "recipe");
  assert.equal((made.setup as { isSetupSendSuppressed?: boolean }).isSetupSendSuppressed, true, "skill đã dựng server-side — không bảo bot dựng lại");
  assert.deepEqual(made.transcript, []);
  const macDinh = (await as(A, () => T.createAgentFromTemplate({ shareId: tpl.shareId })))!;
  const r2 = macDinh.agent as { id: string; avatarShape?: string; avatarColor?: string };
  assert.equal(r2.avatarShape, tpl.avatarShape, "không gửi avatar ⇒ lấy của mẫu");
  assert.equal(r2.avatarColor, tpl.avatarColor);
  const trung = (await as(A, () => T.createAgentFromTemplate({ shareId: tpl.shareId, agentId: UUID })))!;
  assert.notEqual((trung.agent as { id: string }).id, UUID, "id đã có ⇒ đúc id mới, không ghi đè");
  const daNha = (await as(A, () => T.createAgentFromTemplate({ shareId: tpl.shareId, agentId: "agent-999999" })))!;
  assert.notEqual((daNha.agent as { id: string }).id, "agent-999999", "dạng agent-<n> là của bộ đếm bên ta");
});

test("dọn", () => { sach(); });
