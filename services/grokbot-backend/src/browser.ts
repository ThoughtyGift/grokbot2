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
 * Raw CDP over the built-in WebSocket keeps this dependency-free, matching scripts/e2e-vnc.mjs.
 */

const CDP_BASE = (): string => process.env.GROKBOT2_BROWSER_CDP ?? "http://127.0.0.1:9223";
const CALL_TIMEOUT_MS = 20_000;

/** One CDP connection to the active page, reused across calls and reopened when it drops. */
let socket: WebSocket | null = null;
let socketUrl = "";
let nextId = 0;
const pendingCalls = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();

interface Target { id: string; type: string; title: string; url: string; webSocketDebuggerUrl?: string }

async function listTargets(): Promise<Target[]> {
  const res = await fetch(`${CDP_BASE()}/json/list`, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`CDP /json/list returned ${res.status}`);
  return (await res.json()) as Target[];
}

/** The page we drive: first ordinary page target. */
async function pageTarget(): Promise<Target> {
  const pages = (await listTargets()).filter((t) => t.type === "page" && t.webSocketDebuggerUrl);
  if (pages.length === 0) throw new Error("no page target — is Chrome running on the box?");
  return pages[0]!;
}

async function connect(): Promise<WebSocket> {
  if (socket != null && socket.readyState === WebSocket.OPEN) return socket;
  const target = await pageTarget();
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
    const slot = pendingCalls.get(msg.id);
    if (slot == null) return;
    pendingCalls.delete(msg.id);
    if (msg.error) slot.reject(new Error(msg.error.message ?? "CDP error"));
    else slot.resolve(msg.result);
  });
  // A dropped socket must not strand every later call on a dead handle.
  ws.addEventListener("close", () => {
    if (socket === ws) socket = null;
    for (const [, slot] of pendingCalls) slot.reject(new Error("CDP socket closed"));
    pendingCalls.clear();
  }, { once: true });
  socket = ws;
  socketUrl = url;
  return ws;
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
export interface BrowserCtx { attach(dataUrl: string, fileName: string, alt: string): void }

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
  let text: string;
  try {
    text = await action.run(parseArgs(rawArg, action.primary));
  } catch (e) {
    text = `browser error: ${(e as Error).message}`;
  }
  // The original's browser subagent reminder says every browser tool call already returns a
  // screenshot of the page, so the model never has to ask for one. Match that: attach the page
  // after each action, including failures — seeing the wrong page is how you spot a bad selector.
  if (ctx != null) {
    const shot = await screenshotDataUrl();
    if (shot != null) ctx.attach(shot, `${name}.png`, `${name} — trạng thái trang sau hành động`);
  }
  return text;
}

/**
 * Drop the CDP connection. The backend keeps it for its lifetime, but an open socket keeps
 * Node alive, so any script that uses these tools must call this to exit.
 */
export function closeBrowser(): void {
  try { socket?.close(); } catch { /* already closed */ }
  socket = null;
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
