/**
 * Công cụ phải chạy dưới danh tính CHỦ CỦA BOT — không phải danh tính mặc định.
 *
 *   npx tsx --test services/grokbot-backend/src/tool-owner.test.ts
 *
 * ── Vì sao đây là chuyện cách ly, không phải chuyện gọn gàng ────────────────────────────────────
 *
 * Lượt chat chạy TÁCH RỜI khỏi request, nên AsyncLocalStorage mất và `currentOwner()` rơi về
 * `auth0|grokbot2-user`. Đo trực tiếp ngày 28/08:
 *
 *     trong ngữ cảnh request : currentOwner() = local|nguoi-b@vi-du.vn
 *     ngoài ngữ cảnh (tool)  : currentOwner() = auth0|grokbot2-user
 *
 * Box đang chạy per-user: nó ghép owner → tài khoản hệ điều hành. Sai owner nghĩa là lệnh của mọi
 * người dùng chạy chung MỘT tài khoản, đúng thứ chế độ đó sinh ra để tránh. Và không chỉ box —
 * `box-secrets`, `mcp-prefs`, `bot-templates`, `mcp` đọc `currentOwner()` ở 26 chỗ, nên bot của
 * người B sẽ đọc và ghi vào kho của người A.
 *
 * Trên máy một người thì vô hại. Trên VPS đã mở đăng ký thì không.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";

process.env.GROKBOT2_ALLOW_WRITE = "1";
const { runWithOwner: as, currentOwner } = await import("./request-context.js");
const { createAgent } = await import("./directory/index.js");
const { TOOLS } = await import("./runtime/tools.js");
const { resolveLocalToolPermission } = await import("./runtime/turn.js");
const { transcripts, nextEntryId, authorOf, pending } = await import("./chat/state.js");

const NGUOI_B = "local|nguoi-b@vi-du.vn";

/** Công cụ giả: chỉ ghi lại nó thấy mình đang chạy dưới danh tính nào. */
let thayOwner: string | null = null;
(TOOLS as Record<string, unknown>).probe_owner = () => { thayOwner = currentOwner(); return "ok"; };

test("tool chạy sau khi duyệt quyền mang danh tính chủ bot, KHÔNG phải mặc định", async () => {
  const bot = as(NGUOI_B, () => createAgent({ name: "Bot nguoi B" }));
  const t = transcripts.get(bot.id)!;
  const toolCallId = "tc-probe-1";
  const entryId = nextEntryId();
  t.push({ id: toolCallId, kind: "tool-call", toolCallId, name: "probe_owner", rawArgs: "",
           status: "pending", timestampMs: Date.now() } as never);
  t.push({ id: entryId, kind: "send-message", author: authorOf(bot.id), timestampMs: Date.now(),
           message: { type: "local-tool-permission",
                      ask: { status: "pending", action: "run-command", target: "probe_owner()", requestId: "req-probe" } } } as never);
  pending.set("req-probe", { agentId: bot.id, entryId, toolCallId, name: "probe_owner", arg: "" } as never);

  thayOwner = null;
  // Duyệt từ NGOÀI mọi ngữ cảnh — đúng cảnh lượt chạy tách rời.
  resolveLocalToolPermission({ requestId: "req-probe", entryId, agentId: bot.id, resolution: "allow-once" });
  await new Promise((r) => setTimeout(r, 50));

  assert.equal(thayOwner, NGUOI_B,
    `tool phải thấy chủ bot; thấy ${JSON.stringify(thayOwner)} — nếu là auth0|grokbot2-user thì cách ly đã vỡ`);
});
