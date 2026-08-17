/**
 * Dump every bot's full conversation from a running instance, oldest message first.
 *
 * Reads the rendered DOM rather than any API: the original talks to its own backend, so the
 * transcript on screen is the only copy we can see. Scrolls each conversation to the top until
 * it stops growing, because the client pages history in and a single read only captures the
 * tail.
 *
 *   CDP=http://127.0.0.1:9333 OUT=.data/goc-history.json node scripts/dump-original.mjs
 */
import { writeFileSync } from "node:fs";
import { chromium } from "playwright-core";

const CDP = process.env.CDP ?? "http://127.0.0.1:9333";
const OUT = process.env.OUT ?? ".data/goc-history.json";

const b = await chromium.connectOverCDP(CDP, { timeout: 8000 });
const p = b.contexts().flatMap((c) => c.pages()).find((x) => x.url().includes("renderer"));
if (!p) { console.log("no renderer page"); process.exit(1); }

const rowsOf = () => p.evaluate(() => {
  for (const s of [...document.querySelectorAll("div")].filter((e) => {
    const r = e.getBoundingClientRect();
    return r.left < 40 && r.width < 340 && e.scrollHeight > e.clientHeight + 20;
  })) s.scrollTop = 0;
  return [...document.querySelectorAll("div,li,a")]
    .filter((e) => {
      if (e.offsetParent === null) return false;
      const r = e.getBoundingClientRect();
      return r.left < 40 && r.width > 150 && r.width < 340 && r.height > 30 && r.height < 90;
    })
    .map((e) => (e.innerText || "").split("\n")[0].trim())
    .filter((n) => n && n !== "Plugins");
});

const names = [...new Set(await rowsOf())];
console.log("bots:", names.join(" | "));

const out = [];
for (const name of names) {
  const clicked = await p.evaluate((want) => {
    const rows = [...document.querySelectorAll("div,li,a")].filter((e) => {
      if (e.offsetParent === null) return false;
      const r = e.getBoundingClientRect();
      return r.left < 40 && r.width > 150 && r.width < 340 && r.height > 30 && r.height < 90;
    });
    const hit = rows.find((e) => (e.innerText || "").split("\n")[0].trim() === want);
    if (!hit) return null;
    hit.scrollIntoView({ block: "center" });
    const r = hit.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, name);
  if (!clicked) { console.log("  skip (no row):", name); continue; }
  await p.mouse.click(clicked.x, clicked.y);
  await p.waitForTimeout(2200);

  // The transcript is VIRTUALISED: only the rows near the viewport exist in the DOM, so one
  // read after scrolling to the top captures the head and loses the tail. Walk from the top
  // down in steps, accumulating lines in order and de-duplicating as we go.
  const seen = new Set();
  const lines = [];
  const cards = new Set();
  const absorb = async () => {
    const got = await p.evaluate(() => {
      const main = [...document.querySelectorAll("div")]
        .filter((e) => { const r = e.getBoundingClientRect(); return r.left > 250 && r.width > 300; })
        .sort((a, b2) => b2.getBoundingClientRect().height - a.getBoundingClientRect().height)[0];
      return {
        text: (main?.innerText || "").split(String.fromCharCode(10)).map((s2) => s2.trim()).filter(Boolean),
        cards: [...document.querySelectorAll('[class*="sand-"][class*="card"]')]
          .filter((e) => e.offsetParent !== null)
          .map((e) => (e.className.match(/sand-[a-z-]*card[a-z-]*/) || [""])[0]).filter(Boolean),
      };
    });
    for (const l of got.text) { if (!seen.has(l)) { seen.add(l); lines.push(l); } }
    for (const c of got.cards) cards.add(c);
  };

  // First rewind to the top, loading older pages until it stops growing.
  for (let i = 0; i < 40; i++) {
    const before = seen.size;
    await p.evaluate(() => {
      const sc = [...document.querySelectorAll("div")]
        .filter((e) => { const r = e.getBoundingClientRect(); return r.left > 250 && e.scrollHeight > e.clientHeight + 40; })
        .sort((a, b2) => b2.scrollHeight - a.scrollHeight)[0];
      if (sc) sc.scrollTop = 0;
    });
    await p.waitForTimeout(600);
    await absorb();
    if (seen.size === before && i > 2) break;
  }
  // Then walk down a screen at a time to pick up everything virtualisation dropped.
  for (let i = 0; i < 60; i++) {
    const atEnd = await p.evaluate(() => {
      const sc = [...document.querySelectorAll("div")]
        .filter((e) => { const r = e.getBoundingClientRect(); return r.left > 250 && e.scrollHeight > e.clientHeight + 40; })
        .sort((a, b2) => b2.scrollHeight - a.scrollHeight)[0];
      if (!sc) return true;
      sc.scrollTop = Math.min(sc.scrollTop + sc.clientHeight * 0.8, sc.scrollHeight);
      return sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 4;
    });
    await p.waitForTimeout(450);
    await absorb();
    if (atEnd) break;
  }
  const convo = { text: lines, cards: [...cards] };

  out.push({ bot: name, lines: convo.text, cards: [...new Set(convo.cards)] });
  console.log(`  ${name}: ${convo.text.length} lines, cards: ${[...new Set(convo.cards)].join(",") || "-"}`);
}

writeFileSync(OUT, JSON.stringify(out, null, 1));
console.log("wrote", OUT);
await b.close();
