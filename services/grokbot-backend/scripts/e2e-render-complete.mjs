/**
 * Does the SCREEN show everything the transcript holds?
 *
 * A reply arrived two characters short — "bắt tay vào luô" against a stored "bắt tay vào luôn?" — and
 * two is exactly the typewriter's minimum step, so the last tick never landed. Every other check in
 * this repo asserts against the backend, which was right the whole time and therefore could not see
 * this. This one reads the rendered bubble and compares it with the stored entry, character for
 * character, which is the only place the defect exists.
 */
import { chromium } from "playwright-core";
import fs from "node:fs";

const TOKEN = fs.readFileSync(".data/gateway-token.txt", "utf8").trim();
const gw = async (m, a) => {
  const r = await fetch(`http://127.0.0.1:8788/gw/api/${m}`, {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(a ?? {}), signal: AbortSignal.timeout(30_000),
  });
  const t = await r.text();
  try { return JSON.parse(t); } catch { return t; }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const page = browser.contexts()[0].pages().find((p) => !p.url().startsWith("devtools://"));

const made = await gw("createAgent", { name: "render-check" });
const agentId = made?.agent?.id ?? made?.id;

// Open the bot on screen before reading the screen. Without this the check reads whatever
// conversation happened to be open and reports a near-total mismatch — which says nothing about
// rendering and everything about the harness.
await page.locator('text="render-check"').first().click({ timeout: 15_000 });
await sleep(800);

// Long enough that the typewriter runs for a while, and distinctive enough to find on screen.
await gw("sendPrompt", { agentId, text: "Liet ke 5 viec ban lam duoc, moi viec mot cau ngan. Ket thuc bang dung chu: XONG." });
const t0 = Date.now();
while (Date.now() - t0 < 150_000) {
  const rows = await gw("listAgents", {});
  if (Array.isArray(rows) && !rows.some((r) => r.id === agentId && r.isRunning)) break;
  await sleep(1200);
}
await sleep(2500);   // let the client apply the final event

const tail = await gw("getAgentTranscriptTail", { agentId });
const stored = String((tail.entries ?? []).filter((e) => e.kind === "send-message").pop()?.message?.content ?? "").trim();
const screen = await page.evaluate(() => document.body.innerText || "");

// Normalise whitespace on BOTH sides before comparing. The stored text carries "\n\n" between
// paragraphs while the renderer turns those into layout, so a raw substring match reported 4 of 339
// characters and looked like a catastrophic rendering failure — the third harness fault in this one
// check, after reading the screen without opening the bot and importing the wrong playwright package.
const flat = (s) => s.replace(/\s+/g, " ").trim();
const flatStored = flat(stored);
const flatScreen = flat(screen);
const tailOf = (s, n) => s.slice(Math.max(0, s.length - n));
const onScreen = flatScreen.includes(tailOf(flatStored, 40));
console.log(`luu   : ${flatStored.length} ky tu, ket thuc ${JSON.stringify(tailOf(flatStored, 28))}`);
console.log(`man hinh co doan cuoi do? ${onScreen ? "CO" : "KHONG"}`);
if (!onScreen) {
  // Report how much of the ending is missing, so a regression says how bad rather than just "no".
  let keep = 0;
  for (let n = 1; n <= flatStored.length; n++) if (flatScreen.includes(tailOf(flatStored, n))) keep = n;
  console.log(`  man hinh khop duoc ${keep}/${flatStored.length} ky tu cuoi — thieu ${flatStored.length - keep}`);
}
console.log(onScreen ? "PASS  man hinh hien du cau tra loi" : "FAIL  man hinh thieu phan cuoi");

await gw("deleteAgents", { agentIds: [agentId] });
await browser.close();
process.exit(onScreen ? 0 : 1);
