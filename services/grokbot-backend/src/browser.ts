/**
 * Browser tools — the `cursor-ide-browser` action set, driven over CDP.
 *
 * The original ships these as an MCP provider (`cursor-ide-browser`) wrapped in a `browserUse`
 * subagent; the 16 action names below are lifted verbatim from the box host bundle, so a model
 * prompted with the original vocabulary hits the same names here
 * (see `docs/extracted/subagent-prompts.md`).
 *
 * The target is the **box's own Chrome**, not a browser on this machine — that is the whole
 * point: the user watches the agent work in the VNC pane. `infra/vps/grok-box-up.sh` starts
 * Chrome with its DevTools port bound to 127.0.0.1 on the box; reach it with an SSH tunnel and
 * point `GROKBOT2_BROWSER_CDP` at the local end. An open CDP port is unauthenticated remote
 * code execution, so it must never be published.
 *
 * Raw CDP over the built-in WebSocket keeps this dependency-free of npm packages, matching
 * scripts/e2e-vnc.mjs. The one internal import below is deliberate and narrow: which CDP endpoint
 * a bot talks to is now a property of that bot, not of the machine, and there is nowhere else to
 * learn it. Nothing else about this file changes when the feature is off.
 */
import { displayOf, ensureDisplay, touchDisplay, perBotDisplays } from "./displays.js";

/**
 * Cổng CDP của con Chrome thuộc bot này.
 *
 * Mặc định là con Chrome dùng chung (`GROKBOT2_BROWSER_CDP`, đi qua đường hầm SSH cổng 9223). Khi
 * bot đã được cấp màn hình riêng thì nó có Chrome riêng ở một cổng slot — xem displays.ts.
 *
 * Cả một hàm chỉ để đổi một chuỗi, nhưng **đây là chỗ rủi ro nhất của cả thay đổi**: mọi thao tác
 * browser của mọi bot đều đi qua nó. Nên khi cờ tắt, `displayOf` luôn trả null và hàm này trả về
 * đúng chuỗi cũ — đường đang chạy tốt không đổi một byte nào.
 */
const SHARED_CDP = (): string => process.env.GROKBOT2_BROWSER_CDP ?? "http://127.0.0.1:9223";

const CDP_BASE = (agentId: string = currentAgent): string => {
  const lease = displayOf(agentId);
  return lease ? `http://127.0.0.1:${lease.cdpPort}` : SHARED_CDP();
};
const CALL_TIMEOUT_MS = 20_000;

/**
 * One CDP connection PER BOT, not one for the whole backend.
 *
 * Every bot used to drive `pages[0]` — the first tab it happened to find — so two bots working
 * at once fought over the same page, and the computer pane showed all of them the same thing.
 * The original gives each bot its own screen; the least we can do on a single shared box is
 * give each its own tab, created on demand and remembered.
 */
interface Session { socket: WebSocket; targetId: string }
const sessions = new Map<string, Session>();
/**
 * Which tab each bot owns, tracked separately from its socket.
 *
 * `sessions` is deleted when the CDP socket closes — which happens on idle, long before the bot
 * is finished with the tab. Closing from `sessions` therefore did nothing in the common case:
 * measured, a deleted bot kept its tab open because its socket had already gone. The tab
 * outlives the socket, so the record of it has to as well.
 */
const ownedTabs = new Map<string, string>();
/** Which bot a call belongs to. Set per call so the 16 actions need no signature change. */
let currentAgent = "default";
/** Raw CDP event listeners — see onCdpEvent. */
const eventHandlers = new Set<(method: string, params: any) => void>();
let nextId = 0;
const pendingCalls = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();

interface Target { id: string; type: string; title: string; url: string; webSocketDebuggerUrl?: string }

async function listTargets(): Promise<Target[]> {
  const res = await fetch(`${CDP_BASE()}/json/list`, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`CDP /json/list returned ${res.status}`);
  return (await res.json()) as Target[];
}

/**
 * The tab this bot owns, creating one the first time it browses.
 *
 * Falls back to an existing page only when the browser endpoint refuses to open a new tab —
 * better a shared tab than no browser at all.
 */
async function pageTarget(agentId: string): Promise<Target> {
  const pages = (await listTargets()).filter((t) => t.type === "page" && t.webSocketDebuggerUrl);
  const mine = sessions.get(agentId)?.targetId;
  const kept = mine ? pages.find((t) => t.id === mine) : undefined;
  if (kept) return kept;

  const created = await createTab();
  if (created) {
    for (let i = 0; i < 10; i++) {
      const again = (await listTargets()).find((t) => t.id === created && t.webSocketDebuggerUrl);
      if (again) return again;
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  if (pages.length === 0) throw new Error("no page target — is Chrome running on the box?");
  return pages[0]!;
}

/** Open a fresh tab through the browser-level endpoint; null when that is not possible. */
async function createTab(): Promise<string | null> {
  try {
    const res = await fetch(`${CDP_BASE()}/json/new?about:blank`, { method: "PUT", signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const t = (await res.json()) as { id?: string };
    return typeof t.id === "string" ? t.id : null;
  } catch { return null; }
}

async function connect(): Promise<WebSocket> {
  const agentId = currentAgent;
  // Cấp màn hình riêng cho bot này nếu tính năng đang bật. Đặt ở đây vì mọi thao tác browser đều
  // đi qua `connect`, nên không có đường nào lọt. Cờ tắt thì hàm này trả null tức thì, không gọi box.
  if (perBotDisplays()) await ensureDisplay(agentId);
  touchDisplay(agentId);
  const live = sessions.get(agentId);
  if (live != null && live.socket.readyState === WebSocket.OPEN) return live.socket;
  const target = await pageTarget(agentId);
  const url = target.webSocketDebuggerUrl!;
  const ws = new WebSocket(url);
  // A socket that neither opens nor errors would hang every caller forever, so bound the wait.
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      try { ws.close(); } catch { /* already dead */ }
      reject(new Error(`CDP socket at ${url} did not open within 10s`));
    }, 10_000);
    const done = (fn: () => void) => { clearTimeout(timer); fn(); };
    ws.addEventListener("open", () => done(resolve), { once: true });
    ws.addEventListener("error", () => done(() => reject(new Error(`cannot open CDP socket at ${url}`))), { once: true });
  });
  ws.addEventListener("message", (ev: MessageEvent) => {
    let msg: any;
    try { msg = JSON.parse(String(ev.data)); } catch { return; }
    // A CDP frame with no `id` is an EVENT, and this handler used to drop every one of them. Teach
    // recording needs `Runtime.bindingCalled`: steps have to leave the page as they happen, because
    // a navigation replaces `window` and takes any array kept there with it.
    if (msg.id == null) {
      if (typeof msg.method === "string") for (const fn of eventHandlers) { try { fn(msg.method, msg.params); } catch { /* a listener must not kill the socket */ } }
      return;
    }
    const slot = pendingCalls.get(msg.id);
    if (slot == null) return;
    pendingCalls.delete(msg.id);
    if (msg.error) slot.reject(new Error(msg.error.message ?? "CDP error"));
    else slot.resolve(msg.result);
  });
  // A dropped socket must not strand every later call on a dead handle.
  ws.addEventListener("close", () => {
    // Only the socket died; the tab is still open and still this bot's, so `ownedTabs` stays.
    if (sessions.get(agentId)?.socket === ws) sessions.delete(agentId);
    for (const [, slot] of pendingCalls) slot.reject(new Error("CDP socket closed"));
    pendingCalls.clear();
  }, { once: true });
  sessions.set(agentId, { socket: ws, targetId: target.id });
  ownedTabs.set(agentId, target.id);
  return ws;
}

/**
 * Keep the box's Chrome window on screen.
 *
 * CDP renders and screenshots a page whether or not its window is mapped on the X display, so
 * a minimized window produces a perfectly correct screenshot in the chat while the VNC pane
 * shows an empty desktop. That is exactly what happened: `Browser.getWindowForTarget` reported
 * `windowState: "minimized"` while the agent was browsing 24h.com.vn, and X agreed —
 * `Map State: IsUnMapped`. The page was real; only the window was hidden.
 *
 * This runs on the BROWSER-level endpoint. The page session cannot do it: `Browser.*` is not
 * available there, so reusing the existing socket silently fails.
 */
let lastWindowCheckMs = 0;
const WINDOW_CHECK_EVERY_MS = 10_000;

async function ensureWindowVisible(): Promise<void> {
  const now = Date.now();
  if (now - lastWindowCheckMs < WINDOW_CHECK_EVERY_MS) return;
  lastWindowCheckMs = now;

  let ws: WebSocket | null = null;
  try {
    const ver = await (await fetch(`${CDP_BASE()}/json/version`, { signal: AbortSignal.timeout(5000) })).json() as { webSocketDebuggerUrl?: string };
    if (!ver.webSocketDebuggerUrl) return;
    ws = new WebSocket(ver.webSocketDebuggerUrl);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("browser socket timeout")), 5000);
      ws!.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
      ws!.addEventListener("error", () => { clearTimeout(timer); reject(new Error("browser socket error")); }, { once: true });
    });

    let id = 0;
    const waits = new Map<number, { res: (v: any) => void; rej: (e: Error) => void }>();
    ws.addEventListener("message", (ev: MessageEvent) => {
      let m: any; try { m = JSON.parse(String(ev.data)); } catch { return; }
      const w = waits.get(m.id); if (!w) return;
      waits.delete(m.id);
      m.error ? w.rej(new Error(m.error.message ?? "CDP error")) : w.res(m.result);
    });
    const call = (method: string, params: Record<string, unknown> = {}) => new Promise<any>((res, rej) => {
      const n = ++id;
      waits.set(n, { res, rej });
      setTimeout(() => { if (waits.delete(n)) rej(new Error(`${method} timeout`)); }, 5000);
      ws!.send(JSON.stringify({ id: n, method, params }));
    });

    const { targetInfos } = await call("Target.getTargets");
    const page = (targetInfos as { type: string; targetId: string }[]).find((t) => t.type === "page");
    if (!page) return;
    const win = await call("Browser.getWindowForTarget", { targetId: page.targetId });
    if (win?.bounds?.windowState === "normal") return;
    // Two calls on purpose: Chrome rejects a bounds object that sets a state AND a geometry.
    await call("Browser.setWindowBounds", { windowId: win.windowId, bounds: { windowState: "normal" } });
    await call("Browser.setWindowBounds", { windowId: win.windowId, bounds: { left: 120, top: 60, width: 1400, height: 900 } });
    console.log("[grokbot2] [browser] box window was", win.bounds.windowState, "— restored to normal");
  } catch {
    // Never fail a browser action because the window could not be raised.
  } finally {
    try { ws?.close(); } catch { /* already closed */ }
  }
}

async function send(method: string, params: Record<string, unknown> = {}): Promise<any> {
  const ws = await connect();
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingCalls.delete(id);
      reject(new Error(`${method} timed out after ${CALL_TIMEOUT_MS}ms`));
    }, CALL_TIMEOUT_MS);
    pendingCalls.set(id, {
      resolve: (v) => { clearTimeout(timer); resolve(v); },
      reject: (e) => { clearTimeout(timer); reject(e); },
    });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

/** Run an expression in the page and return its value, surfacing page-side throws. */
async function evaluate<T>(expression: string): Promise<T> {
  const r = await send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (r.exceptionDetails != null) {
    throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text ?? "page threw");
  }
  return r.result?.value as T;
}

// ── argument handling ────────────────────────────────────────────────────────

/**
 * The loop hands tools one raw string. Models write either JSON
 * (`browser_click({"selector":"#go"})`) or a bare value (`browser_click(#go)`), so accept both
 * and map a bare value onto the tool's primary parameter.
 */
function parseArgs(raw: string, primary: string): Record<string, any> {
  const text = (raw ?? "").trim();
  if (text === "") return {};
  if (text.startsWith("{")) {
    try { return JSON.parse(text); } catch { /* fall through to positional */ }
  }
  const unquoted = text.replace(/^['"]|['"]$/g, "");
  return { [primary]: unquoted };
}

const need = (args: Record<string, any>, key: string): string => {
  const v = args[key];
  if (typeof v !== "string" || v.length === 0) throw new Error(`missing "${key}"`);
  return v;
};

/** JS literal for a selector, so quotes in it can't break out of the expression. */
const lit = (s: string): string => JSON.stringify(s);

/** Resolve a selector page-side and fail loudly when it matches nothing. */
const withEl = (selector: string, body: string): string => `
  (() => {
    const el = document.querySelector(${lit(selector)});
    if (!el) throw new Error("no element matches ${selector.replace(/"/g, '\\"')}");
    ${body}
  })()`;

// ── the actions ──────────────────────────────────────────────────────────────

/** Short text view of the page, so the model can act without a screenshot round-trip. */
async function snapshot(): Promise<string> {
  return evaluate<string>(`
    (() => {
      const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      const label = (el) => (el.innerText || el.value || el.getAttribute("aria-label") ||
                             el.getAttribute("placeholder") || el.name || "").trim().replace(/\\s+/g, " ").slice(0, 60);
      const sel = (el) => el.id ? "#" + el.id
        : el.name ? el.tagName.toLowerCase() + "[name=" + JSON.stringify(el.name) + "]"
        : el.tagName.toLowerCase();
      const rows = [...document.querySelectorAll("a,button,input,textarea,select,[role=button],[onclick]")]
        .filter(vis).slice(0, 60)
        .map((el) => "  " + el.tagName.toLowerCase() + " " + sel(el) + "  " + JSON.stringify(label(el)));
      const text = (document.body?.innerText || "").replace(/\\s+/g, " ").trim().slice(0, 1200);
      return "url: " + location.href + "\\ntitle: " + document.title +
             "\\n\\ninteractive:\\n" + rows.join("\\n") + "\\n\\ntext:\\n" + text;
    })()`);
}

type Action = (args: Record<string, any>) => Promise<string>;

const ACTIONS: Record<string, { primary: string; run: Action }> = {
  browser_navigate: {
    primary: "url",
    run: async (a) => {
      await send("Page.enable");
      await send("Page.navigate", { url: need(a, "url") });
      // No load event to await without extra plumbing; settle briefly, then report the page.
      await new Promise((r) => setTimeout(r, 1200));
      return snapshot();
    },
  },
  browser_snapshot: { primary: "", run: () => snapshot() },
  browser_take_screenshot: { primary: "", run: async () => "screenshot attached" },
  browser_click: {
    primary: "selector",
    run: async (a) => {
      await evaluate(withEl(need(a, "selector"), `el.scrollIntoView({block:"center"}); el.click(); return true;`));
      await new Promise((r) => setTimeout(r, 500));
      return snapshot();
    },
  },
  browser_mouse_click_xy: {
    primary: "x",
    run: async (a) => {
      const x = Number(a.x), y = Number(a.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('needs {"x":<n>,"y":<n>}');
      for (const type of ["mousePressed", "mouseReleased"]) {
        await send("Input.dispatchMouseEvent", {
          type, x, y, button: "left", clickCount: 1, buttons: type === "mousePressed" ? 1 : 0,
        });
      }
      return `clicked (${x}, ${y})`;
    },
  },
  browser_type: {
    primary: "text",
    run: async (a) => {
      const text = need(a, "text");
      if (typeof a.selector === "string" && a.selector.length > 0) {
        await evaluate(withEl(a.selector, `el.focus(); return true;`));
      }
      for (const ch of text) await send("Input.dispatchKeyEvent", { type: "char", text: ch });
      return `typed ${JSON.stringify(text)}`;
    },
  },
  browser_fill: {
    primary: "value",
    run: async (a) => {
      const value = need(a, "value");
      // Setting .value alone leaves React/Vue state stale — dispatch the events they listen for.
      await evaluate(withEl(need(a, "selector"), `
        el.focus();
        el.value = ${lit(value)};
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return true;`));
      return `filled ${a.selector} with ${JSON.stringify(value)}`;
    },
  },
  browser_select_option: {
    primary: "value",
    run: async (a) => {
      const value = need(a, "value");
      await evaluate(withEl(need(a, "selector"), `
        el.value = ${lit(value)};
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return true;`));
      return `selected ${JSON.stringify(value)}`;
    },
  },
  browser_press_key: {
    primary: "key",
    run: async (a) => {
      const key = need(a, "key");
      const codes: Record<string, number> = { Enter: 13, Tab: 9, Escape: 27, Backspace: 8, ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39 };
      const vk = codes[key];
      const base = vk != null
        ? { key, code: key, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk }
        : { key, text: key };
      await send("Input.dispatchKeyEvent", { type: "keyDown", ...base });
      await send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
      return `pressed ${key}`;
    },
  },
  browser_scroll: {
    primary: "y",
    run: async (a) => {
      const y = Number(a.y ?? 400), x = Number(a.x ?? 0);
      await evaluate(`window.scrollBy(${Number.isFinite(x) ? x : 0}, ${Number.isFinite(y) ? y : 400}); true`);
      return `scrolled by (${x}, ${y})`;
    },
  },
  browser_drag: {
    primary: "from",
    run: async (a) => {
      const from = await evaluate<{ x: number; y: number }>(withEl(need(a, "from"), `
        const r = el.getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2 };`));
      const to = await evaluate<{ x: number; y: number }>(withEl(need(a, "to"), `
        const r = el.getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2 };`));
      await send("Input.dispatchMouseEvent", { type: "mousePressed", x: from.x, y: from.y, button: "left", clickCount: 1, buttons: 1 });
      await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: to.x, y: to.y, button: "left", buttons: 1 });
      await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: to.x, y: to.y, button: "left", buttons: 0 });
      return `dragged ${a.from} → ${a.to}`;
    },
  },
  browser_get_bounding_box: {
    primary: "selector",
    run: async (a) => {
      const box = await evaluate(withEl(need(a, "selector"), `
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };`));
      return JSON.stringify(box);
    },
  },
  browser_highlight: {
    primary: "selector",
    run: async (a) => {
      await evaluate(withEl(need(a, "selector"), `
        el.style.outline = "3px solid #ff2d55"; el.scrollIntoView({ block: "center" }); return true;`));
      return `highlighted ${a.selector}`;
    },
  },
  browser_evaluate: {
    primary: "expression",
    run: async (a) => {
      const v = await evaluate<unknown>(need(a, "expression"));
      return typeof v === "string" ? v : JSON.stringify(v) ?? String(v);
    },
  },
  browser_tabs: {
    primary: "",
    run: async () => {
      const pages = (await listTargets()).filter((t) => t.type === "page");
      return pages.map((t, i) => `${i}: ${t.title} — ${t.url}`).join("\n") || "(no tabs)";
    },
  },
  browser_cdp: {
    primary: "method",
    run: async (a) => {
      const r = await send(need(a, "method"), (a.params ?? {}) as Record<string, unknown>);
      return JSON.stringify(r).slice(0, 2000);
    },
  },
};

export const BROWSER_TOOL_NAMES = Object.keys(ACTIONS);

/** Anything a tool may do besides return text (mirrors chat.ts ToolCtx, kept local to avoid a cycle). */
export interface BrowserCtx {
  attach(dataUrl: string, fileName: string, alt: string): void;
  /** Show the page to the MODEL, not only to the person watching — see ToolCtx.see. */
  see?(dataUrl: string): void;
  agentId?: string;
}

/**
 * Close the tab a bot owned, when its computer session is released.
 *
 * One tab per bot, reused — which is what the original does too ("By default reuses your tab;
 * set newTab: true to open in a new tab"). What was missing is the other half: nothing ever
 * closed them. After a day of testing the box had 25 open tabs, most belonging to bots that had
 * been deleted, all holding memory in one Chrome.
 */
export async function closeAgentTab(agentId: string): Promise<void> {
  const targetId = ownedTabs.get(agentId);
  const session = sessions.get(agentId);
  ownedTabs.delete(agentId);
  sessions.delete(agentId);
  if (session) { try { session.socket.close(); } catch { /* already closed */ } }
  if (!targetId) return;
  try { await fetch(`${CDP_BASE(agentId)}/json/close/${targetId}`, { signal: AbortSignal.timeout(4000) }); } catch { /* tab already gone */ }
}

/** Bring the current bot's tab to the front of the shared window. */
async function activateOwnTab(): Promise<void> {
  const id = sessions.get(currentAgent)?.targetId;
  if (!id) return;
  try { await fetch(`${CDP_BASE()}/json/activate/${id}`, { signal: AbortSignal.timeout(4000) }); } catch { /* best effort */ }
}

/**
 * Bring one bot's tab forward — for desktop actions, which cannot work any other way.
 *
 * Browser tools deliberately do NOT do this (see the note at the end of runBrowserTool): CDP
 * reaches a tab whether or not it is in front, so raising one only yanked the view away from the
 * bot the user was watching.
 *
 * `computer_use` has no such luxury. It clicks whatever window is frontmost, so a bot whose own
 * tab is behind another's is reading somebody else's screen and clicking into it. Measured exactly
 * that way: the bot reported "tab data:text/html is still open but is not the tab being shown",
 * having just screenshotted another bot's Shopee page.
 *
 * Called once per desktop hold, not per action — a bot that deliberately switches to another
 * window mid-turn is not dragged back to Chrome.
 */
export async function activateTabOf(agentId: string): Promise<boolean> {
  const id = sessions.get(agentId)?.targetId ?? ownedTabs.get(agentId);
  if (!id) return false;
  try {
    await fetch(`${CDP_BASE(agentId)}/json/activate/${id}`, { signal: AbortSignal.timeout(4000) });
    return true;
  } catch { return false; }
}

/** Capture the page as a data: URL — the only URL form the transcript renders without a host. */
async function screenshotDataUrl(): Promise<string | null> {
  try {
    const r = await send("Page.captureScreenshot", { format: "png" });
    return typeof r?.data === "string" ? `data:image/png;base64,${r.data}` : null;
  } catch {
    return null;
  }
}

/** True when a box browser is configured to drive. */
export const isBrowserConfigured = (): boolean => process.env.GROKBOT2_BROWSER_CDP != null;

/**
 * Run one browser action. Errors are returned as text, not thrown: the tool loop shows the
 * result to the model, and "no element matches #foo" is something it can recover from.
 */
export async function runBrowserTool(name: string, rawArg: string, ctx?: BrowserCtx): Promise<string> {
  const action = ACTIONS[name];
  if (action == null) return `(unknown browser tool ${name})`;
  // Route every CDP call in this action to the calling bot's own tab.
  currentAgent = ctx?.agentId ?? "default";
  let text: string;
  try {
    // Before anything else, make sure the user can SEE what is about to happen. The whole point
    // of driving the box's Chrome rather than a headless one is that the VNC pane shows it.
    await ensureWindowVisible();
    // NOTE: this used to call activateOwnTab() here, pulling the acting bot's tab to the front.
    // That is wrong while several bots share one Chrome window: a bot working in the background
    // yanked the view away from the bot the user was actually watching — reported live, with the
    // VNC pane jumping to another bot's page mid-task. Each bot keeps its own tab; nothing steals
    // focus. Bringing a tab forward belongs to whoever knows which bot is on screen, which the
    // backend does not.
    text = await action.run(parseArgs(rawArg, action.primary));
  } catch (e) {
    text = `browser error: ${(e as Error).message}`;
  }
  // The original's browser subagent reminder says every browser tool call already returns a
  // screenshot of the page, so the model never has to ask for one. Match that: attach the page
  // after each action, including failures — seeing the wrong page is how you spot a bad selector.
  if (ctx != null) {
    const shot = await screenshotDataUrl();
    if (shot != null) {
      ctx.attach(shot, `${name}.png`, `${name} — trạng thái trang sau hành động`);
      // …and hand it to the model too. Attaching alone only ever showed the picture to the person:
      // the follow-up turn is built from text, so "the model never has to ask for a screenshot"
      // was true only in the sense that asking would not have helped either.
      ctx.see?.(shot);
    }
  }
  return text;
}

/**
 * Drop the CDP connection. The backend keeps it for its lifetime, but an open socket keeps
 * Node alive, so any script that uses these tools must call this to exit.
 */
export function closeBrowser(): void {
  for (const [, s] of sessions) {
    try { s.socket.close(); } catch { /* already closed */ }
  }
  sessions.clear();
}

/** Reachability check for startup logging — never throws. */
/**
 * Whether the browser answered its last probe.
 *
 * `GROKBOT2_BROWSER_CDP` being SET is not the same as the browser being reachable, and the
 * difference is expensive: with the variable set but the tunnel down, the 16 browser tools
 * are still advertised, so the model picks one, waits out a socket timeout, and the user
 * sees a long silence ending in "fetch failed" — observed live on "mở shopee". A probe at
 * startup turns that into the tool simply not being offered.
 */
let reachable = false;
export const isBrowserReachable = (): boolean => reachable;

export async function browserProbe(): Promise<string> {
  try {
    const pages = (await listTargets()).filter((t) => t.type === "page");
    reachable = true;
    return `reachable, ${pages.length} tab(s)`;
  } catch (e) {
    reachable = false;
    return `unreachable (${(e as Error).message})`;
  }
}

/**
 * Internal seam for teach.ts: one raw CDP call in a given bot's tab.
 *
 * Teach recording needs the SAME tab the browser tools use — that is the tab the VNC pane shows,
 * so it is the one the person is demonstrating in and the one the bot will replay in. Opening a
 * second CDP socket to the same Chrome would work and would also mean two clients racing over one
 * tab's lifecycle; reusing this module's session is the cheaper truth.
 *
 * Not part of the browser TOOL surface: the model cannot reach this, only backend code can.
 */
export async function cdpForAgent(
  agentId: string, method: string, params: Record<string, unknown> = {},
): Promise<any> {
  currentAgent = agentId || "default";
  await ensureWindowVisible();
  return send(method, params);
}

/**
 * Subscribe to raw CDP events on the box's browser session. Returns an unsubscribe.
 *
 * The teach recorder is the reason this exists: steps must leave the page the moment they happen,
 * so it calls a `Runtime.addBinding` function and the step arrives here as `Runtime.bindingCalled`.
 * Keeping the steps in a page variable looked simpler and was wrong — a navigation replaces
 * `window`, and the first version of this lost every click that happened before the page changed.
 */
export function onCdpEvent(handler: (method: string, params: any) => void): () => void {
  eventHandlers.add(handler);
  return () => { eventHandlers.delete(handler); };
}
