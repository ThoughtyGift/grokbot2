/** Screenshot a running instance and dump what the window currently reads. */
import { chromium } from "playwright-core";

const b = await chromium.connectOverCDP(process.env.CDP ?? "http://127.0.0.1:9222", { timeout: 8000 });
const p = b.contexts().flatMap((c) => c.pages()).find((x) => x.url().includes("renderer"));
if (!p) { console.log("no renderer page"); process.exit(1); }
const out = process.env.OUT ?? ".data/shot.png";
await p.screenshot({ path: out });
console.log("saved:", out);
console.log("text:", (await p.evaluate(() => (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 600))));
await b.close();
