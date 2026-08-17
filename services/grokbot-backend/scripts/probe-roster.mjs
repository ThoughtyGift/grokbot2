/** Side-by-side: what a sidebar row actually shows in each instance. */
import { chromium } from "playwright-core";

const PROBE = () => {
  const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
  // The row is whatever element holds the bot name; find them via the sidebar list.
  const all = [...document.querySelectorAll("div,li,a")].filter((e) => e.offsetParent !== null);
  // A row is an element whose text has a name and which sits inside the left column.
  const rows = all.filter((e) => {
    const r = e.getBoundingClientRect();
    return r.left < 40 && r.width > 150 && r.width < 340 && r.height > 30 && r.height < 90 && (e.innerText || "").trim();
  });
  const seen = new Set();
  const out = [];
  for (const e of rows) {
    const lines = (e.innerText || "").split("\n").map(norm).filter(Boolean);
    const key = lines.join("|");
    if (seen.has(key) || lines.length === 0) continue;
    seen.add(key);
    out.push({ lines: lines.slice(0, 3), h: Math.round(e.getBoundingClientRect().height) });
    if (out.length >= 7) break;
  }
  return out;
};

for (const [tag, cdp] of [["LOCAL", "http://127.0.0.1:9222"], ["GOC", "http://127.0.0.1:9333"]]) {
  const b = await chromium.connectOverCDP(cdp, { timeout: 8000 });
  const p = b.contexts().flatMap((c) => c.pages()).find((x) => x.url().includes("renderer"));
  console.log("=====", tag);
  for (const r of await p.evaluate(PROBE)) console.log(`  h=${r.h}  ${JSON.stringify(r.lines)}`);
  await b.close();
}
