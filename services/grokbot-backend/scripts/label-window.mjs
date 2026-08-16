/**
 * Give a running app instance a distinct window title.
 *
 * Both instances ship as "Grok Bot", which is ambiguous in the taskbar when the local build
 * and the original run side by side. The app is signed, so the title is patched at runtime
 * over CDP and re-applied whenever the renderer resets it.
 *
 *   node scripts/label-window.mjs --cdp http://127.0.0.1:9222 --title "Grok Bot 2 — LOCAL"
 */
import { chromium } from "playwright-core";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const CDP = arg("--cdp", "http://127.0.0.1:9222");
const TITLE = arg("--title", "Grok Bot 2 — LOCAL");

const b = await chromium.connectOverCDP(CDP);
const page = b.contexts()[0].pages()[0];
await page.evaluate((t) => {
  const apply = () => { if (document.title !== t) document.title = t; };
  apply();
  // The renderer rewrites the title on navigation/agent switch — keep ours pinned.
  const head = document.querySelector("head");
  if (head) new MutationObserver(apply).observe(head, { subtree: true, childList: true, characterData: true });
  setInterval(apply, 1000);
}, TITLE);
console.log(`titled ${CDP} → ${TITLE}`);
await b.close();
