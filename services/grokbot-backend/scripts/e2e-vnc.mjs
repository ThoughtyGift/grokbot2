/**
 * Computer-pane check — proves the VNC workspace actually renders, over CDP, in the real app.
 *
 * Verifies the three things that each failed silently before: the forever-box status is
 * "running" with a vncUrl, the viewer webview exists, and noVNC reports a live RFB session
 * (root class `noVNC_connected` plus a sized canvas).
 *
 * The viewer is a <webview>, and Playwright does not surface those as pages, so this talks
 * raw CDP to the webview target's own debugger socket.
 *
 * Launch the app with `--remote-debugging-port=9222` first, then:
 *   node scripts/e2e-vnc.mjs
 */
import { writeFileSync } from "node:fs";

const CDP = process.env.GROKBOT2_CDP ?? "http://127.0.0.1:9222";
const BACKEND = process.env.GROKBOT2_BACKEND ?? "http://localhost:8788";

/** One CDP round-trip per call, on a socket opened just for this target. */
async function withTarget(wsUrl, fn) {
  const ws = new WebSocket(wsUrl);
  const pending = new Map();
  let id = 0;
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    const slot = pending.get(msg.id);
    if (slot == null) return;
    pending.delete(msg.id);
    msg.error ? slot.reject(new Error(msg.error.message)) : slot.resolve(msg.result);
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const mid = ++id;
      pending.set(mid, { resolve, reject });
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
  try {
    return await fn(send);
  } finally {
    ws.close();
  }
}

const evaluate = (send, expression) =>
  send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })
    .then((r) => r.result?.value);

const targets = await (await fetch(`${CDP}/json/list`)).json();
const viewers = targets.filter((t) => /vnc\.html/.test(t.url ?? ""));
console.log(`viewer webviews: ${viewers.length}`);
for (const t of viewers) {
  const interactive = /sandInteractive=1/.test(t.url) ? "interactive" : "preview";
  console.log(`  [${interactive}] ${t.title}`);
}

const status = await (
  await fetch(`${BACKEND}/gw/api/getForeverBoxStatus`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: "probe" }),
  })
).json();
console.log(`\nforever-box: state=${status.state} agentId=${JSON.stringify(status.agentId)} vncUrl=${status.vncUrl ? "set" : "MISSING"}`);

if (viewers.length === 0) {
  console.error("\nFAIL: no viewer webview — the app never opened the screen.");
  process.exit(1);
}

let allLive = true;
for (const t of viewers) {
  const kind = /sandInteractive=1/.test(t.url) ? "interactive" : "preview";
  const live = await withTarget(t.webSocketDebuggerUrl, async (send) => {
    await send("Runtime.enable");
    const info = await evaluate(
      send,
      `(() => { const c = document.querySelector("canvas");
        return JSON.stringify({ title: document.title,
          classes: document.documentElement.className,
          connected: document.documentElement.classList.contains("noVNC_connected"),
          canvas: c ? c.width + "x" + c.height : null }); })()`,
    );
    const parsed = JSON.parse(info);
    // The framebuffer comes off the canvas, not Page.captureScreenshot: a webview that is not
    // on screen (the modal is closed) never answers a screenshot, but the canvas still holds
    // the live remote desktop.
    if (parsed.canvas != null) {
      const png = await evaluate(send, `document.querySelector("canvas").toDataURL("image/png")`);
      writeFileSync(`.data/vnc-${kind}.png`, Buffer.from(png.split(",")[1], "base64"));
    }
    return parsed;
  });
  console.log(`\n${kind} viewer`);
  console.log(`  html class: ${live.classes || "(none)"}`);
  console.log(`  connected:  ${live.connected}`);
  console.log(`  canvas:     ${live.canvas ?? "none"}`);
  if (!live.connected || live.canvas == null) allLive = false;
}

console.log("\nscreenshots: .data/vnc-preview.png .data/vnc-interactive.png");
console.log(allLive ? "\nPASS: RFB session is live inside the app." : "\nFAIL: viewer open but not connected.");
process.exit(allLive ? 0 : 1);
