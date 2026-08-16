/**
 * Capture how the REAL box works (VNC + gateway + transcript shape) from the original app.
 *
 * Hooks the renderer's MessagePort, clicks "Open computer" to force the box/VNC flow, then
 * reports STRUCTURE ONLY — field names, shapes and box/VNC endpoints. Message text is
 * redacted so a real workspace can be inspected without dumping its conversations.
 *
 *   node scripts/capture-box.mjs [--cdp http://127.0.0.1:9333] [--seconds 60]
 */
import { chromium } from "playwright-core";
import { writeFileSync, mkdirSync } from "node:fs";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const CDP = arg("--cdp", "http://127.0.0.1:9333");
const SECONDS = Number(arg("--seconds", "60"));

const b = await chromium.connectOverCDP(CDP);
const page = b.contexts()[0].pages()[0];

await page.evaluate(() => {
  if (window.__boxFrames) return;
  window.__boxFrames = [];
  const push = (dir, data) => {
    try { window.__boxFrames.push({ dir, t: Date.now(), data: JSON.parse(JSON.stringify(data)) }); } catch { /* non-cloneable */ }
    if (window.__boxFrames.length > 3000) window.__boxFrames.shift();
  };
  const post = MessagePort.prototype.postMessage;
  MessagePort.prototype.postMessage = function (...a) { push("out", a[0]); return post.apply(this, a); };
  const add = MessagePort.prototype.addEventListener;
  MessagePort.prototype.addEventListener = function (type, fn, ...rest) {
    if (type === "message" && typeof fn === "function") return add.call(this, type, (ev) => { push("in", ev.data); return fn(ev); }, ...rest);
    return add.call(this, type, fn, ...rest);
  };
  const d = Object.getOwnPropertyDescriptor(MessagePort.prototype, "onmessage");
  if (d?.set) Object.defineProperty(MessagePort.prototype, "onmessage", {
    ...d, set(fn) { d.set.call(this, typeof fn === "function" ? (ev) => { push("in", ev.data); return fn(ev); } : fn); },
  });
});
console.log("hooked. triggering the box…");

// Open the computer/VNC pane.
for (const label of ["Open computer", "Open", "Retry"]) {
  const btn = page.locator(`button:has-text("${label}")`).first();
  if (await btn.count()) { await btn.click({ force: true }).catch(() => {}); console.log(`clicked "${label}"`); break; }
}

for (let i = 0; i < SECONDS / 3; i++) {
  await page.waitForTimeout(3000);
  const n = await page.evaluate(() => (window.__boxFrames || []).length).catch(() => 0);
  process.stdout.write(`\r  frames: ${n}   `);
}
console.log();

const frames = await page.evaluate(() => window.__boxFrames || []);

// ── redact free text, keep structure ──
const TEXT_KEYS = /^(content|text|prompt|richText|preview|summary|title|name|authorName|body)$/i;
const redact = (v) => {
  if (Array.isArray(v)) return v.map(redact);
  if (v && typeof v === "object") {
    const o = {};
    for (const [k, val] of Object.entries(v)) o[k] = TEXT_KEYS.test(k) && typeof val === "string" ? `«${val.length} chars»` : redact(val);
    return o;
  }
  return v;
};

mkdirSync(".data", { recursive: true });
writeFileSync(".data/box-frames.json", JSON.stringify(frames.map((f) => ({ ...f, data: redact(f.data) })), null, 1));

const all = JSON.stringify(frames);
console.log(`captured ${frames.length} frames → .data/box-frames.json (text redacted)`);

// ── what the box exposes ──
const findUrls = [...new Set(all.match(/https?:\/\/[a-zA-Z0-9.\-]+(?::\d+)?[a-zA-Z0-9/_\-.]*/g) || [])];
console.log("\n=== endpoints seen ===");
for (const u of findUrls.slice(0, 25)) console.log("  " + u);

console.log("\n=== box / vnc keys present ===");
for (const k of ["vncUrl", "vnc_url", "gatewayUrl", "execDaemonUrl", "podId", "tenantId", "cluster", "networkToken", "gatewayToken", "forkVncBaseUrl", "screen", "computer", "reachable", "nextBeforeSeq", "entries", "seq"]) {
  const c = (all.match(new RegExp(`"${k}"`, "g")) || []).length;
  if (c) console.log(`  ${k}: ${c}`);
}

// ── a real transcript entry, structurally ──
const entryFrame = frames.find((f) => JSON.stringify(f.data).includes('"kind":"send-message"') || JSON.stringify(f.data).includes('"kind":"message"'));
if (entryFrame) {
  const s = JSON.stringify(redact(entryFrame.data));
  console.log("\n=== real transcript frame (redacted) ===\n" + s.slice(0, 1200));
} else {
  console.log("\n(no transcript frame captured — open a bot with history while this runs)");
}
await b.close();
