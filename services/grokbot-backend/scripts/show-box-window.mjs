/**
 * Make the box's Chrome window visible again.
 *
 * The agent drives Chrome over CDP, which renders and screenshots a page whether or not its
 * window is mapped on the X display. So the chat can show a correct screenshot of a site while
 * the VNC pane shows an empty desktop — the page is real, the window is just hidden.
 * `Browser.setWindowBounds` with `windowState: "normal"` is what puts it back on screen.
 */
const base = process.env.GROKBOT2_BROWSER_CDP ?? "http://127.0.0.1:9223";
const ver = await (await fetch(`${base}/json/version`)).json();
const ws = new WebSocket(ver.webSocketDebuggerUrl);

let id = 0;
const waits = new Map();
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  const w = waits.get(m.id);
  if (!w) return;
  waits.delete(m.id);
  m.error ? w.rej(new Error(m.error.message)) : w.res(m.result);
});
const send = (method, params = {}) => new Promise((res, rej) => {
  const n = ++id;
  waits.set(n, { res, rej });
  ws.send(JSON.stringify({ id: n, method, params }));
  setTimeout(() => rej(new Error(`${method} timeout`)), 8000);
});
await new Promise((r) => ws.addEventListener("open", r, { once: true }));

const { targetInfos } = await send("Target.getTargets");
const page = targetInfos.find((t) => t.type === "page");
if (!page) { console.log("no page target"); process.exit(1); }
console.log("page:", (page.title || page.url).slice(0, 60));

const win = await send("Browser.getWindowForTarget", { targetId: page.targetId });
console.log("before:", JSON.stringify(win.bounds));
await send("Browser.setWindowBounds", { windowId: win.windowId, bounds: { windowState: "normal" } });
await send("Browser.setWindowBounds", { windowId: win.windowId, bounds: { left: 120, top: 60, width: 1400, height: 900 } });
await send("Target.activateTarget", { targetId: page.targetId });
const after = await send("Browser.getWindowForTarget", { targetId: page.targetId });
console.log("after :", JSON.stringify(after.bounds));
ws.close();
