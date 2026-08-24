/**
 * "Teach a task" — record what somebody demonstrates in the box's browser, save it as a routine.
 *
 * The vendor does this on their own machines; none of it is in the client bundle, which only
 * forwards three calls and expects a state object back. So the recorder is ours to build, and the
 * pieces were already here: the box's Chrome is reachable over CDP (the same tab the VNC pane
 * shows), and routines already store and replay a task. This is the wire between them.
 *
 * The client's contract, read off the bundle rather than guessed:
 *
 *     start({agentId, entryPoint})  -> state
 *     stop({agentId, save})         -> state
 *     status()                      -> state
 *     state = {state: "idle"|"recording", agentId, startedAtMs, maxDurationMs}
 *
 * The REPLY IS THE STATE. The renderer sets an optimistic `recording` and then overwrites it with
 * whatever comes back, so a reply that omits `state` pushes its state machine into a value it has
 * no branch for — which is exactly how this used to leave the pane spinning on "Starting desktop".
 *
 * What it cannot do: only actions inside the box's Chrome are events. A desktop app outside the
 * browser reaches us as pixels over VNC and nothing more, so it cannot be taught this way.
 */
import { cdpForAgent } from "./browser.js";
import { automationCreateRef } from "./chat/state.js";

/** The client's own limit (`600 * 1e3` in the bundle). Sending a different one desynchronises its countdown. */
const MAX_DURATION_MS = 600_000;

export interface TeachState {
  state: "idle" | "recording";
  agentId: string | null;
  startedAtMs: number | null;
  maxDurationMs: number;
}

export const IDLE: TeachState = { state: "idle", agentId: null, startedAtMs: null, maxDurationMs: MAX_DURATION_MS };

export interface Step {
  act: "click" | "fill" | "navigate" | "key";
  sel?: string;
  text?: string;
  value?: string;
  url?: string;
}

/** One recording at a time: the pane is modal and the box has one screen. */
let active: { agentId: string; startedAtMs: number; timer: NodeJS.Timeout } | null = null;

/**
 * The recorder, injected into the page.
 *
 * `Page.addScriptToEvaluateOnNewDocument` re-runs this on every navigation, so the listeners
 * survive a page change — a taught task that starts on a login page and ends on a dashboard would
 * otherwise stop recording at the first click.
 *
 * Selector preference is id → aria-label → name → first class → tag, and it is recorded so a replay
 * can say how much to trust it: `#id` is stable, a bare tag is a guess.
 */
const RECORDER = `(() => {
  if (window.__grokTeach) return;
  const steps = [];
  window.__grokTeach = steps;
  const sel = (el) => {
    if (!el || !el.tagName) return { sel: "?", quality: "none" };
    if (el.id) return { sel: "#" + el.id, quality: "id" };
    const aria = el.getAttribute && el.getAttribute("aria-label");
    if (aria) return { sel: '[aria-label="' + aria.replace(/"/g, '\\\\"') + '"]', quality: "aria" };
    const name = el.getAttribute && el.getAttribute("name");
    if (name) return { sel: el.tagName.toLowerCase() + '[name="' + name + '"]', quality: "name" };
    if (typeof el.className === "string" && el.className.trim()) {
      return { sel: "." + el.className.trim().split(/\\s+/)[0], quality: "class" };
    }
    return { sel: el.tagName.toLowerCase(), quality: "tag" };
  };
  const push = (step) => {
    const last = steps[steps.length - 1];
    // The same field fires change more than once and a click can bubble twice; a repeat of the
    // previous step is noise, not a second action.
    if (last && last.act === step.act && last.sel === step.sel && last.value === step.value) return;
    if (steps.length < 200) steps.push(step);
  };
  document.addEventListener("click", (e) => {
    const s = sel(e.target);
    push({ act: "click", sel: s.sel, quality: s.quality, text: (e.target.textContent || "").trim().slice(0, 60) });
  }, true);
  document.addEventListener("change", (e) => {
    const t = e.target;
    if (t && (t.type === "password")) { const s = sel(t); push({ act: "fill", sel: s.sel, quality: s.quality, value: "***" }); return; }
    const s = sel(t);
    push({ act: "fill", sel: s.sel, quality: s.quality, value: String(t && t.value != null ? t.value : "").slice(0, 120) });
  }, true);
  push({ act: "navigate", url: location.href });
})()`;

/** Begin recording in the bot's own tab. Returns the state the client will adopt verbatim. */
export async function startTeach(agentId: string): Promise<TeachState> {
  if (active) return recordingState();
  const id = agentId || "default";
  try {
    await cdpForAgent(id, "Page.enable");
    // Survive navigations, and also arm the page that is already open.
    await cdpForAgent(id, "Page.addScriptToEvaluateOnNewDocument", { source: RECORDER });
    await cdpForAgent(id, "Runtime.evaluate", { expression: RECORDER, returnByValue: true });
  } catch (e) {
    console.warn(`[grokbot2] [teach] cannot start: ${(e as Error).message}`);
    return IDLE;
  }
  // The client stops itself at ten minutes; this is the backend not being left recording for ever
  // if the app is closed mid-take.
  const timer = setTimeout(() => { void stopTeach(id, false); }, MAX_DURATION_MS + 30_000);
  active = { agentId: id, startedAtMs: Date.now(), timer };
  console.log(`[grokbot2] [teach] recording for ${id}`);
  return recordingState();
}

export function recordingState(): TeachState {
  if (!active) return IDLE;
  return { state: "recording", agentId: active.agentId, startedAtMs: active.startedAtMs, maxDurationMs: MAX_DURATION_MS };
}

/** Read the steps out of the page, dropping the recorder. */
async function collect(agentId: string): Promise<Step[]> {
  try {
    const r = await cdpForAgent(agentId, "Runtime.evaluate", {
      expression: `JSON.stringify(window.__grokTeach || [])`,
      returnByValue: true,
    });
    const raw = String(r?.result?.value ?? "[]");
    return JSON.parse(raw) as Step[];
  } catch (e) {
    console.warn(`[grokbot2] [teach] cannot read steps: ${(e as Error).message}`);
    return [];
  }
}

/**
 * Turn a step list into the prompt a routine runs.
 *
 * Written for the agent that will replay it, not for a machine: the browser tools take a selector
 * and a value, so the steps are given in those terms, and the weak selectors are called out so the
 * agent looks at the page instead of trusting `.btn` blindly.
 */
export function stepsToPrompt(steps: Step[]): string {
  const lines: string[] = [];
  let n = 0;
  for (const s of steps) {
    const q = (s as { quality?: string }).quality;
    const weak = q === "class" || q === "tag" ? "  (selector yếu — kiểm lại trên trang trước khi bấm)" : "";
    if (s.act === "navigate" && s.url) {
      // `about:blank` and `data:` are where a fresh tab happens to be sitting, not a place a replay
      // can navigate back to. Recording one as step 1 buried the real first action under a wall of
      // percent-encoding. A long http URL is truncated instead: the host and path are what identify
      // it, and the agent has the page in front of it.
      if (/^(about:|data:)/i.test(s.url)) continue;
      lines.push(`${++n}. mở ${s.url.length > 120 ? `${s.url.slice(0, 117)}…` : s.url}`);
      continue;
    }
    if (s.act === "click") { lines.push(`${++n}. bấm \`${s.sel}\`${s.text ? ` ("${s.text}")` : ""}${weak}`); continue; }
    if (s.act === "fill") { lines.push(`${++n}. điền \`${s.sel}\` = "${s.value ?? ""}"${weak}`); continue; }
  }
  if (!lines.length) return "";
  return [
    "Làm lại đúng các bước sau trong trình duyệt (dùng các tool browser_*):",
    "",
    ...lines,
    "",
    "Nếu một bước không khớp trang thật thì DỪNG và nói rõ bước nào, đừng đoán bước tiếp theo.",
  ].join("\n");
}

/**
 * Stop, and save when asked.
 *
 * A save with nothing recorded creates nothing: an empty routine would sit in the panel looking
 * like a taught task and do nothing when run. `discardedBecauseEmpty` is what the caller reports.
 */
export async function stopTeach(agentId: string, save: boolean): Promise<TeachState & { saved?: string; steps?: number }> {
  const id = active?.agentId ?? agentId ?? "default";
  const wasActive = active != null;
  if (active) { clearTimeout(active.timer); active = null; }
  if (!wasActive) return IDLE;

  const steps = await collect(id);
  try { await cdpForAgent(id, "Runtime.evaluate", { expression: `delete window.__grokTeach`, returnByValue: true }); } catch { /* tab may be gone */ }
  console.log(`[grokbot2] [teach] stopped for ${id}: ${steps.length} step(s), save=${save}`);

  if (!save) return IDLE;
  const prompt = stepsToPrompt(steps);
  if (!prompt) return { ...IDLE, steps: 0 };
  if (!automationCreateRef) return { ...IDLE, steps: steps.length };

  // "manual" is the trigger for a routine with no schedule: the Routines panel lists it, Run fires
  // it, and the scheduler has nothing to match — which is what a taught task wants until somebody
  // decides it should also run on a clock.
  const name = `Việc đã dạy — ${new Date().toISOString().slice(5, 16).replace("T", " ")}`;
  // The creator answers with the trigger's description ("manual"), which is not what the caller
  // asked; it wants to know WHAT was saved.
  automationCreateRef(id, { name, prompt, trigger: "manual" });
  return { ...IDLE, saved: name, steps: steps.length };
}

/** Shutdown: never leave a recorder armed in the box's browser. */
export function closeTeach(): void {
  if (active) { clearTimeout(active.timer); active = null; }
}
