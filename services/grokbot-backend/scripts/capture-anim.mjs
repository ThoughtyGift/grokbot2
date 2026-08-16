/**
 * Capture the reply animation as it actually runs.
 *
 * Sends a prompt through the real UI over CDP and samples the transcript DOM while the
 * answer streams: which elements animate, their class names, and the computed
 * animation/transition values — so the typing/streaming effect can be mapped back to the
 * keyframes in the extracted CSS.
 *
 *   node scripts/capture-anim.mjs [--cdp http://127.0.0.1:9222] [--prompt "…"]
 */
import { chromium } from "playwright-core";
import { writeFileSync, mkdirSync } from "node:fs";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const CDP = arg("--cdp", "http://127.0.0.1:9222");
const PROMPT = arg("--prompt", "ke mot cau chuyen ngan 3 cau ve con meo");

const b = await chromium.connectOverCDP(CDP);
const page = b.contexts()[0].pages()[0];

/** Everything currently animating, plus anything that looks like a typing indicator. */
const sample = () => page.evaluate(() => {
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const out = { animating: [], indicators: [], running: [] };

  // Elements with a live CSS animation or a non-trivial transition.
  for (const el of document.querySelectorAll("*")) {
    if (!vis(el)) continue;
    const cs = getComputedStyle(el);
    const name = cs.animationName;
    if (name && name !== "none") {
      out.animating.push({
        tag: el.tagName.toLowerCase(),
        cls: (el.className || "").toString().slice(0, 60),
        name, duration: cs.animationDuration, timing: cs.animationTimingFunction,
        iter: cs.animationIterationCount, delay: cs.animationDelay, fill: cs.animationFillMode,
        text: (el.textContent || "").trim().slice(0, 24),
      });
    }
    if (cs.transitionProperty && cs.transitionProperty !== "none" && cs.transitionDuration !== "0s") {
      out.running.push({ cls: (el.className || "").toString().slice(0, 50), prop: cs.transitionProperty.slice(0, 60), dur: cs.transitionDuration, timing: cs.transitionTimingFunction });
    }
  }
  // Small dots / pulsing blocks near the end of the transcript = typing indicator candidates.
  for (const el of document.querySelectorAll("span,div,i")) {
    if (!vis(el)) continue;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (r.width <= 14 && r.height <= 14 && (cs.animationName !== "none" || cs.borderRadius !== "0px")) {
      out.indicators.push({ cls: (el.className || "").toString().slice(0, 50), w: Math.round(r.width), h: Math.round(r.height), anim: cs.animationName, radius: cs.borderRadius, bg: cs.backgroundColor });
    }
  }
  return out;
});

const composer = page.locator('[contenteditable="true"]').last();
await composer.click();
await composer.type(PROMPT, { delay: 8 });
await page.keyboard.press("Enter");
console.log(`sent: ${PROMPT}\nsampling…`);

const frames = [];
for (let i = 0; i < 24; i++) {
  await page.waitForTimeout(500);
  const s = await sample();
  if (s.animating.length || s.indicators.length) frames.push({ tMs: (i + 1) * 500, ...s });
  const names = [...new Set(s.animating.map((a) => a.name))];
  if (names.length) console.log(`  t+${((i + 1) * 500) / 1000}s animating: ${names.join(", ")}`);
}

mkdirSync(".data", { recursive: true });
writeFileSync(".data/reply-animation.json", JSON.stringify(frames, null, 1));

const uniq = new Map();
for (const f of frames) for (const a of f.animating) if (!uniq.has(a.name + a.cls)) uniq.set(a.name + a.cls, a);
console.log(`\n=== distinct animated elements (${uniq.size}) ===`);
for (const a of uniq.values()) console.log(`  ${a.name}  ${a.duration} ${a.timing} x${a.iter}  cls=${a.cls}  «${a.text}»`);
const inds = new Map();
for (const f of frames) for (const i of f.indicators) if (!inds.has(i.cls + i.anim)) inds.set(i.cls + i.anim, i);
console.log(`\n=== indicator-like elements (${inds.size}) ===`);
for (const i of [...inds.values()].slice(0, 12)) console.log(`  ${i.w}x${i.h} anim=${i.anim} radius=${i.radius} bg=${i.bg} cls=${i.cls}`);
await b.close();
