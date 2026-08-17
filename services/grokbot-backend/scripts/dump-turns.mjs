/**
 * Extract a conversation as ROLES, not just text.
 *
 * innerText alone cannot tell who said what. The app right-aligns the user's bubbles, so the
 * horizontal position of a bubble is the only reliable signal — take the role from geometry.
 *
 *   CDP=http://127.0.0.1:9333 BOT="Thư ký" node scripts/dump-turns.mjs
 */
import { chromium } from "playwright-core";

const CDP = process.env.CDP ?? "http://127.0.0.1:9333";
const BOT = process.env.BOT ?? "";

const b = await chromium.connectOverCDP(CDP, { timeout: 8000 });
const p = b.contexts().flatMap((c) => c.pages()).find((x) => x.url().includes("renderer"));
if (!p) { console.log("no renderer"); process.exit(1); }

if (BOT) {
  const box = await p.evaluate((want) => {
    const rows = [...document.querySelectorAll("div,li,a")].filter((e) => {
      if (e.offsetParent === null) return false;
      const r = e.getBoundingClientRect();
      return r.left < 40 && r.width > 150 && r.width < 340 && r.height > 30 && r.height < 90;
    });
    const hit = rows.find((e) => (e.innerText || "").startsWith(want));
    if (!hit) return null;
    hit.scrollIntoView({ block: "center" });
    const r = hit.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, BOT);
  if (!box) { console.log("row not found:", BOT); process.exit(1); }
  await p.mouse.click(box.x, box.y);
  await p.waitForTimeout(2500);
}

const seen = new Set();
const turns = [];
const absorb = async () => {
  const got = await p.evaluate(() => {
    const main = [...document.querySelectorAll("div")]
      .filter((e) => { const r = e.getBoundingClientRect(); return r.left > 250 && r.width > 300; })
      .sort((a, b2) => b2.getBoundingClientRect().height - a.getBoundingClientRect().height)[0];
    if (!main) return [];
    const mid = main.getBoundingClientRect().left + main.getBoundingClientRect().width / 2;
    // A bubble: a leaf-ish element with text, inside the transcript column.
    return [...main.querySelectorAll("div,p")]
      .filter((e) => e.offsetParent !== null && (e.innerText || "").trim().length > 1)
      .filter((e) => e.children.length <= 2)
      .map((e) => {
        const r = e.getBoundingClientRect();
        return { role: r.left > mid ? "user" : "bot", text: (e.innerText || "").replace(/\s+/g, " ").trim(), y: Math.round(r.top) };
      })
      .filter((t) => t.text.length > 1);
  });
  for (const t of got) {
    const key = t.role + "|" + t.text;
    if (!seen.has(key)) { seen.add(key); turns.push(t); }
  }
};

// Rewind to the top, then walk down — the transcript is virtualised.
for (let i = 0; i < 30; i++) {
  const before = seen.size;
  await p.evaluate(() => {
    const sc = [...document.querySelectorAll("div")]
      .filter((e) => { const r = e.getBoundingClientRect(); return r.left > 250 && e.scrollHeight > e.clientHeight + 40; })
      .sort((a, b2) => b2.scrollHeight - a.scrollHeight)[0];
    if (sc) sc.scrollTop = 0;
  });
  await p.waitForTimeout(500);
  await absorb();
  if (seen.size === before && i > 2) break;
}
for (let i = 0; i < 50; i++) {
  const atEnd = await p.evaluate(() => {
    const sc = [...document.querySelectorAll("div")]
      .filter((e) => { const r = e.getBoundingClientRect(); return r.left > 250 && e.scrollHeight > e.clientHeight + 40; })
      .sort((a, b2) => b2.scrollHeight - a.scrollHeight)[0];
    if (!sc) return true;
    sc.scrollTop = Math.min(sc.scrollTop + sc.clientHeight * 0.75, sc.scrollHeight);
    return sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 4;
  });
  await p.waitForTimeout(400);
  await absorb();
  if (atEnd) break;
}

const users = turns.filter((t) => t.role === "user");
console.log(`turns: ${turns.length}  (user ${users.length})`);
if (process.env.OUT) {
  const { writeFileSync } = await import("node:fs");
  writeFileSync(process.env.OUT, JSON.stringify(turns, null, 1));
  console.log("wrote " + process.env.OUT);
}
console.log("\n=== USER INPUTS, in order ===");
users.forEach((t, i) => console.log(`${String(i + 1).padStart(2)}. ${t.text.slice(0, 150)}`));
await b.close();
