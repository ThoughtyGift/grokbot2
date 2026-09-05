/**
 * Trang đích `/bot/<shareId>` — đầu bên kia của nút "Copy link" (site-bot.ts).
 *
 *   node services/grokbot-backend/scripts/run-tests.mjs src/site-bot.test.ts
 *
 * Bốn thứ đáng khoá. Một: chỉ mẫu ĐÃ xuất bản + public mới ra trang — nháp `staged` phải 404, vì link ấy chép được từ
 * client trước khi bấm Publish. Hai: tên/mô tả do người khác viết đi vào HTML phải được thoát — đây là chỗ duy nhất
 * backend in nội dung người dùng ra trang công khai. Ba: nút mở đúng deep link mà `main-core.cjs` 0.43 đăng ký. Bốn:
 * mọi đường không phải `/bot/<id>` trả `false` để router đi tiếp.
 *
 * Cách ly: `GROKBOT2_DATA_DIR` tự `mkdtemp` khi vắng — không có đường nào dẫn về `.data` thật (bảng theo dõi §7).
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

process.env.GROKBOT2_ALLOW_WRITE = "1";
if (!process.env.GROKBOT2_DATA_DIR) process.env.GROKBOT2_DATA_DIR = mkdtempSync(join(tmpdir(), "gb2-site-bot-"));
if (!process.env.GROKBOT2_STATE_FILE) process.env.GROKBOT2_STATE_FILE = join(process.env.GROKBOT2_DATA_DIR, "state.json");
if (!process.env.GROKBOT2_WORKFLOWS_FILE) process.env.GROKBOT2_WORKFLOWS_FILE = join(process.env.GROKBOT2_DATA_DIR, "workflows.json");

const { runWithOwner: as } = await import("./request-context.js");
const { createAgent } = await import("./directory/index.js");
const T = await import("./bot-templates.js");
const { handleSite } = await import("./site.js");
const { botLandingHtml, deepLinkOf, handleBotSite } = await import("./site-bot.js");

T.bindTemplateSources({
  skills: () => [{ name: "Đặt hàng", description: "Lên đơn Shopee", content: "1. mở app" }, { name: "Đối soát", description: "So công nợ", content: "..." }],
  routines: () => [{ slug: "sang", name: "Báo sáng", description: "8h", content: "tóm tắt", trigger: "0 8 * * *" }],
  memory: async () => [],
  plugins: () => [],
  restoreSkill: () => {}, restoreRoutine: () => {}, restoreMemory: async () => {},
});

const A = "local|nguoi-a@vi-du.vn";
const TEN_DOC = `Bot <script>alert("x")</script> & "Kho"`;

function fakeRes(): ServerResponse & { code: number; headers: Record<string, string>; body: string } {
  const r = {
    code: 0, headers: {} as Record<string, string>, body: "",
    writeHead(code: number, headers?: Record<string, string>) { r.code = code; Object.assign(r.headers, headers ?? {}); return r; },
    end(chunk?: unknown) { if (typeof chunk === "string") r.body += chunk; return r; },
  };
  return r as unknown as ServerResponse & { code: number; headers: Record<string, string>; body: string };
}
const GET = { method: "GET" } as IncomingMessage;

/** Bot thật trong kho tạm + mẫu nháp (chưa Publish) — mỗi bài tự dựng để không phụ thuộc thứ tự. */
async function mauNhap(ten = "Kho Shopee", moTa = "Giữ tồn kho đúng, cutoff 18:00.") {
  const bot = as(A, () => createAgent({ name: ten, description: moTa, avatarShape: "hex", avatarColor: "green" } as Parameters<typeof createAgent>[0]));
  return (await as(A, () => T.stageTemplateForAgent(bot.id, { description: moTa }, A)))!;
}

test("mẫu ĐÃ xuất bản → 200, đúng tên · người tạo · số đếm · deep link của main-core 0.43", async () => {
  const nhap = await mauNhap();
  await as(A, () => T.publishBotTemplate(nhap.shareId, nhap.staged?.version ?? 1));
  const res = fakeRes();
  assert.equal(await handleSite(`/bot/${nhap.shareId}`, GET, res), true, "site.ts phải nhường /bot/<id> cho site-bot");
  assert.equal(res.code, 200);
  assert.match(res.headers["content-type"], /text\/html/);
  assert.match(res.headers["content-security-policy"], /script-src 'nonce-/, "script nội tuyến chỉ chạy với nonce");
  assert.equal(res.headers["x-frame-options"], "DENY");
  assert.match(res.body, /<title>Kho Shopee by nguoi-a<\/title>/, "tiêu đề đúng dạng '<tên> by <người tạo>' như trang hãng");
  assert.match(res.body, /property="og:title" content="Kho Shopee by nguoi-a"/);
  assert.match(res.body, /Giữ tồn kho đúng, cutoff 18:00\./);
  assert.match(res.body, /<b>2<\/b> skills/);
  assert.match(res.body, /<b>1<\/b> routines/);
  assert.doesNotMatch(res.body, /1\. mở app/, "chỉ số đếm, KHÔNG lộ thân skill ra trang công khai");
  assert.match(res.body, new RegExp(`href="grokbot://app/v1/bot-template\\?id=${nhap.shareId}"`), "nút Add mở đúng scheme+path client đăng ký");
  assert.equal(deepLinkOf(nhap.shareId), `grokbot://app/v1/bot-template?id=${nhap.shareId}`);
  assert.match(res.body, /download\/windows/, "phải có lối tải app cho người chưa cài");
});

test("mẫu còn NHÁP (chưa Publish) → 404 — link chép được từ thẻ Unpublished nhưng chưa ai xem được", async () => {
  const nhap = await mauNhap("Bot nháp");
  const res = fakeRes();
  assert.equal(handleBotSite(`/bot/${nhap.shareId}`, GET, res), true);
  assert.equal(res.code, 404);
  assert.match(res.body, /Không tìm thấy mẫu bot/);
  assert.doesNotMatch(res.body, /Bot nháp/, "404 không được lộ tên mẫu chưa xuất bản");
});

test("id lạ, id sai dạng → 404 cùng một trang; không có gì khác nhau để dò", () => {
  const a = botLandingHtml("AAAAAAAAAAAAAAAAAAAAA", "n");
  const b = botLandingHtml("../../etc/passwd", "n");
  assert.equal(a.code, 404);
  assert.equal(b.code, 404);
  assert.equal(a.html, b.html);
});

test("tên và mô tả do người khác viết được THOÁT — không có <script> sống trong trang", async () => {
  const nhap = await mauNhap(TEN_DOC, `mô tả có <img src=x onerror=alert(1)> và 'nháy'`);
  await as(A, () => T.publishBotTemplate(nhap.shareId, nhap.staged?.version ?? 1));
  const { code, html } = botLandingHtml(nhap.shareId, "n");
  assert.equal(code, 200);
  assert.doesNotMatch(html, /<script>alert/);
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt; &amp; &quot;Kho&quot;/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  // Đúng một script hợp lệ của trang, mang nonce.
  assert.equal((html.match(/<script/g) ?? []).length, 1);
  assert.match(html, /<script nonce="n">/);
});

test("gạch chéo cuối → 301 về dạng chuẩn bằng Location TƯƠNG ĐỐI (giữ tiền tố /agent của nginx)", () => {
  // Đo 06/09 trên cinai.app: từ `/agent/bot/<id>/`, link `../download/windows` của trang rơi vào `/agent/bot/download/windows` → 404.
  const res = fakeRes();
  assert.equal(handleBotSite("/bot/AAAAAAAAAAAAAAAAAAAAA/", GET, res), true);
  assert.equal(res.code, 301);
  assert.equal(res.headers.location, "../AAAAAAAAAAAAAAAAAAAAA", "tuyệt đối `/bot/<id>` sẽ mất `/agent` vì proxy_redirect chỉ viết lại URL tuyệt đối");
  assert.equal(res.body, "");
});

test("đường không phải /bot/<id> trả false — router đi tiếp", () => {
  for (const p of ["/bot", "/bot/", "/bots/x", "/v1/login", "/download/windows", "/bot/a/b"]) {
    const res = fakeRes();
    assert.equal(handleBotSite(p, GET, res), false, `${p} không được nuốt`);
    assert.equal(res.code, 0);
  }
});

test("og:url đi theo GROKBOT2_PUBLIC_SITE — cùng nguồn với link mà Copy link chép", async () => {
  const cu = process.env.GROKBOT2_PUBLIC_SITE;
  process.env.GROKBOT2_PUBLIC_SITE = "https://cinai.app/agent/";
  try {
    const nhap = await mauNhap("Bot og");
    await as(A, () => T.publishBotTemplate(nhap.shareId, nhap.staged?.version ?? 1));
    const { html } = botLandingHtml(nhap.shareId, "n");
    assert.match(html, new RegExp(`property="og:url" content="https://cinai.app/agent/bot/${nhap.shareId}"`));
  } finally {
    if (cu === undefined) delete process.env.GROKBOT2_PUBLIC_SITE; else process.env.GROKBOT2_PUBLIC_SITE = cu;
  }
});
