/**
 * Tạo / xoá mẫu bot NGOÀI tiến trình backend — trợ thủ của `e2e-mau-bot.mjs`.
 *
 *   npx tsx services/grokbot-backend/scripts/mau-bot-ngoai.mts create <agentId>   → {shareId, skills}
 *   npx tsx services/grokbot-backend/scripts/mau-bot-ngoai.mts delete <shareId>
 *
 * Vì sao cần: cửa TẠO mẫu không có lệnh gateway (hãng cấp `shareId` ở máy chủ; client chỉ xuất bản thứ
 * đã có), bên mình tạo bằng tool `share_bot_template` trong một lượt chat. Bài đo không muốn tốn một lượt
 * model, nên tạo thẳng vào kho ở đây; backend đọc file kho mỗi lần gọi nên thấy ngay.
 *
 * Chủ đi qua ENV `MAU_OWNER` (mặc định chủ đơn `auth0|grokbot2-user`) — `|` trong authId qua argv bị
 * shell hiểu là pipe.
 */
const [, , lenh, a] = process.argv;
const owner = process.env.MAU_OWNER ?? "auth0|grokbot2-user";
const T = await import("../src/bot-templates.ts");
const W = await import("../src/workflows.ts");
T.bindTemplateSources({
  skills: (agentId: string) => W.forAgent({ agentId }).map((w) => ({ name: w.name, description: w.description, content: w.instructions })),
});
if (lenh === "create") {
  const tpl = await T.createTemplateForAgent(a, owner);
  if (!tpl) { console.log(JSON.stringify({ error: "không tạo được mẫu — bot không có trong roster?" })); process.exit(1); }
  const pub = await T.publishBotTemplate(tpl.shareId, 1, owner);
  T.setBotTemplateVisibility(tpl.shareId, "public", owner);
  console.log(JSON.stringify({ shareId: tpl.shareId, skills: pub?.snapshot.recipe.skills.length ?? 0 }));
} else if (lenh === "delete") {
  T.deleteBotTemplate(a, owner);
  console.log(JSON.stringify({ deleted: a }));
} else {
  console.log(JSON.stringify({ error: `lệnh lạ: ${lenh}` }));
  process.exit(2);
}
process.exit(0);
