/**
 * Capture the REAL box protocol from a second app instance.
 *
 * The renderer talks to the host over a MessagePort (`coordinatorPort`), so hook
 * postMessage/onmessage and log every frame. Run this against the instance that is
 * pointed at the real backend (default CDP 9333) while you use it normally; transcript
 * frames land in .data/real-frames.json for diffing against our own responses.
 *
 *   node scripts/capture-real.mjs [--cdp http://127.0.0.1:9333] [--seconds 180]
 */
import { chromium } from "playwright-core";
import { writeFileSync, mkdirSync } from "node:fs";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const CDP = arg("--cdp", "http://127.0.0.1:9333");
const SECONDS = Number(arg("--seconds", "180"));
const OUT = ".data/real-frames.json";

const b = await chromium.connectOverCDP(CDP);
const page = b.contexts()[0].pages()[0];

// Hook every MessagePort in the page and stash frames on window.__frames.
await page.addInitScript(() => {
  // @ts-ignore
  window.__frames = [];
  const push = (dir, data) => {
    try {
      // @ts-ignore
      window.__frames.push({ dir, t: Date.now(), data: JSON.parse(JSON.stringify(data)) });
      // @ts-ignore
      if (window.__frames.length > 4000) window.__frames.shift();
    } catch { /* non-cloneable */ }
  };
  const origPost = MessagePort.prototype.postMessage;
  MessagePort.prototype.postMessage = function (...args) { push("out", args[0]); return origPost.apply(this, args); };
  const origAdd = MessagePort.prototype.addEventListener;
  MessagePort.prototype.addEventListener = function (type, fn, ...rest) {
    if (type === "message" && typeof fn === "function") {
      const wrapped = (ev) => { push("in", ev.data); return fn(ev); };
      return origAdd.call(this, type, wrapped, ...rest);
    }
    return origAdd.call(this, type, fn, ...rest);
  };
  const desc = Object.getOwnPropertyDescriptor(MessagePort.prototype, "onmessage");
  if (desc?.set) {
    Object.defineProperty(MessagePort.prototype, "onmessage", {
      ...desc,
      set(fn) { desc.set.call(this, typeof fn === "function" ? (ev) => { push("in", ev.data); return fn(ev); } : fn); },
    });
  }
});
await page.reload().catch(() => {});
console.log(`hooked. use the app (log in, open a bot, send a message). capturing ${SECONDS}s…`);

const deadline = Date.now() + SECONDS * 1000;
let last = 0;
while (Date.now() < deadline) {
  await page.waitForTimeout(3000);
  const n = await page.evaluate(() => (window.__frames || []).length).catch(() => 0);
  if (n !== last) { console.log(`  frames: ${n}`); last = n; }
}

const frames = await page.evaluate(() => window.__frames || []);
mkdirSync(".data", { recursive: true });
writeFileSync(OUT, JSON.stringify(frames, null, 1));
console.log(`saved ${frames.length} frames → ${OUT}`);

// Surface anything that looks like a transcript payload.
const hits = frames.filter((f) => JSON.stringify(f.data).includes("send-message") || JSON.stringify(f.data).includes("entries"));
console.log(`transcript-ish frames: ${hits.length}`);
for (const h of hits.slice(0, 3)) console.log(JSON.stringify(h.data).slice(0, 600));
await b.close();
