/**
 * Exercise the browser tool set against a real Chrome, without the app in the loop.
 *
 * Point GROKBOT2_BROWSER_CDP at any Chrome started with --remote-debugging-port. On the box
 * that is the desktop's own Chrome (infra/vps/grok-box-up.sh); locally any Chrome will do:
 *
 *   chrome --remote-debugging-port=9223 --user-data-dir=/tmp/p about:blank
 *   GROKBOT2_BROWSER_CDP=http://127.0.0.1:9223 node scripts/e2e-browser.mjs
 */
import { runBrowserTool, browserProbe, BROWSER_TOOL_NAMES, isBrowserConfigured } from "../src/browser.ts";

if (!isBrowserConfigured()) {
  console.error("GROKBOT2_BROWSER_CDP is not set");
  process.exit(1);
}
console.log(`tools: ${BROWSER_TOOL_NAMES.length}`);
console.log(`probe: ${await browserProbe()}\n`);

const steps = [
  ["browser_navigate", '{"url":"https://example.com"}'],
  ["browser_get_bounding_box", '{"selector":"h1"}'],
  ["browser_evaluate", '{"expression":"document.querySelector(\'h1\').textContent"}'],
  ["browser_highlight", '{"selector":"h1"}'],
  ["browser_scroll", '{"y":200}'],
  ["browser_tabs", ""],
  ["browser_take_screenshot", ""],
  ["browser_click", '{"selector":"a"}'],
  ["browser_click", '{"selector":"#definitely-not-here"}'],  // must fail gracefully
];

let failures = 0;
for (const [name, arg] of steps) {
  const out = String(await runBrowserTool(name, arg));
  const first = out.split("\n")[0].slice(0, 110);
  const bad = out.startsWith("browser error") && !name.includes("not-here") && !arg.includes("not-here");
  if (bad) failures++;
  console.log(`${bad ? "FAIL" : "ok  "} ${name}(${arg.slice(0, 48)}) → ${first}`);
}

// The graceful-failure case must actually have failed, or the guard is not working.
const missing = String(await runBrowserTool("browser_click", '{"selector":"#nope"}'));
if (!missing.startsWith("browser error")) { console.log("FAIL missing-element did not report an error"); failures++; }

console.log(failures === 0 ? "\nPASS: browser tools drive a real page." : `\nFAIL: ${failures} step(s)`);
process.exit(failures === 0 ? 0 : 1);
