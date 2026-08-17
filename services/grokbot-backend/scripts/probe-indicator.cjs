/**
 * Is anything animating while a reply is in flight?
 *
 * An earlier version of this probe looked for the words "Thinking"/"Working" and for classes
 * containing "spinner"/"typing", found none, and concluded the UI showed nothing. That was a
 * false negative: the original's indicator is an ANIMATED AVATAR (client `tln` maps a verb to
 * one of thinking/searching/working/loading/orbit), which has neither a label nor those class
 * names. So compare consecutive screenshots of the avatar region instead — motion is the only
 * honest test.
 */
const { chromium } = require("playwright-core");
const { createHash } = require("node:crypto");

const GW = "http://localhost:8788/gw/api";
const post = async (m, b) => (await fetch(`${GW}/${m}`, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b),
})).json();
const hash = (buf) => createHash("sha1").update(buf).digest("hex").slice(0, 10);

(async () => {
  const b = await chromium.connectOverCDP("http://127.0.0.1:9222", { timeout: 8000 });
  const page = b.contexts().flatMap((c) => c.pages()).find((x) => x.url().includes("renderer"));
  if (!page) { console.log("no renderer"); process.exit(1); }

  const { agent } = await post("createAgent", { name: "AnimProbe" });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6000);

  const box = await page.evaluate((want) => {
    for (const s of [...document.querySelectorAll("div")].filter((e) => {
      const r = e.getBoundingClientRect();
      return r.left < 40 && r.width < 340 && e.scrollHeight > e.clientHeight + 20;
    })) s.scrollTop = s.scrollHeight;
    const rows = [...document.querySelectorAll("div,li,a")].filter((e) => {
      if (e.offsetParent === null) return false;
      const r = e.getBoundingClientRect();
      return r.left < 40 && r.width > 150 && r.width < 340 && r.height > 30 && r.height < 90;
    });
    const hit = rows.find((e) => (e.innerText || "").startsWith(want));
    if (!hit) return null;
    const r = hit.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, row: { x: r.left, y: r.top, width: r.width, height: r.height } };
  }, "AnimProbe");
  if (!box) { console.log("row not found"); process.exit(1); }
  await page.mouse.click(box.x, box.y);
  await page.waitForTimeout(1500);

  const shot = () => page.screenshot({ clip: box.row });

  console.log("--- BEFORE sending (should be still) ---");
  const idle = [];
  for (let i = 0; i < 3; i++) { idle.push(hash(await shot())); await page.waitForTimeout(400); }
  console.log("  hashes:", idle.join(" "), idle.every((h) => h === idle[0]) ? "→ identical (still)" : "→ MOVING");

  await post("sendPrompt", { agentId: agent.id, content: "Viet mot doan van 6 cau ve mua thu Ha Noi", clientNonce: `n${Date.now()}` });

  console.log("--- DURING the turn ---");
  const busy = [];
  for (let i = 0; i < 6; i++) {
    const roster = await post("listAgents", {});
    const me = roster.find((a) => a.id === agent.id);
    busy.push({ h: hash(await shot()), running: me?.isRunning, act: me?.currentActivity?.kind ?? "-" });
    await page.waitForTimeout(400);
  }
  for (const s of busy) console.log(`  ${s.h}  isRunning=${s.running} activity=${s.act}`);
  const moved = new Set(busy.map((s) => s.h)).size > 1;
  console.log(moved ? "  → avatar region CHANGES while running (animation present)" : "  → avatar region IDENTICAL while running (no animation)");
  await b.close();
})();
