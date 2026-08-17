/**
 * Test the standing hypothesis: a bot the AGENT creates mid-session spins, a bot created empty (the
 * "+" button) renders. Both go through the same createAgent(); the only difference in the tool path is
 * an immediate sendPrompt that starts a turn before the client has ever built a replica for the bot.
 *
 * Measured, not argued: create one of each, open each in the real app over CDP, and read whether the
 * conversation body actually renders.
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

async function makeAndOpen(kind, label) {
  const made = await gw("createAgent", { name: label });
  const id = made?.agent?.id ?? made?.id;
  if (kind === "with-turn") {
    // The path the create_agent tool takes: brief the new bot immediately, which starts a turn.
    await gw("sendPrompt", { agentId: id, content: "Tu gioi thieu mot cau ngan." });
    const t0 = Date.now();
    while (Date.now() - t0 < 60_000) {
      const rows = await gw("listAgents", {});
      if (!rows.some((r) => r.id === id && r.isRunning)) break;
      await sleep(1000);
    }
  }
  // Open it in the app.
  await page.locator(`text="${label}"`).first().click({ timeout: 15_000 });
  await sleep(2500);

  const stored = ((await gw("getAgentTranscriptTail", { agentId: id }))?.entries ?? [])
    .filter((e) => e.kind === "send-message" && String(e.message?.content ?? "").trim())
    .map((e) => String(e.message.content)).join(" ");
  const screen = (await page.evaluate(() => document.body.innerText || "")).replace(/\s+/g, " ");
  const flatStored = stored.replace(/\s+/g, " ").trim();
  // A spinner leaves the body without the stored text; a rendered pane contains it.
  const rendered = flatStored ? screen.includes(flatStored.slice(0, 30)) : "n/a (khong co text)";
  const spinner = await page.locator('svg.animate-spin, [class*="spin"]').count().catch(() => 0);
  console.log(`${label.padEnd(16)} [${kind}]  stored=${flatStored.length}ky  render=${rendered}  spinner-el=${spinner}`);
  return id;
}

const a = await makeAndOpen("empty", `probe-empty-${Date.now() % 10000}`);
const b = await makeAndOpen("with-turn", `probe-turn-${Date.now() % 10000}`);

await gw("deleteAgents", { agentIds: [a, b] });
await browser.close();
process.exit(0);
