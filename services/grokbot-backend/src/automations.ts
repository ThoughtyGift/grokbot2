/**
 * Routines (the FE calls them automations) — CRUD plus the scheduler that fires them.
 *
 * The wire contract was read off the client bundle rather than guessed:
 *   getAgentAutomations({id})                          -> Automation[]
 *   createAgentAutomation({id, spec})                  -> Automation[]
 *   updateAgentAutomation({id, automationId, spec})    -> Automation[]
 *   deleteAgentAutomation({id, automationId})          -> Automation[]
 *   setAgentAutomationEnabled({id, automationId, isEnabled}) -> Automation[]
 *   runAgentAutomationNow({id, automationId})          -> void
 * Every mutating call answers with the agent's **full list**, because the FE stores
 * the reply as the new list rather than re-fetching. Returning `[]` (the old stub)
 * therefore looked like "created, then vanished".
 *
 * `spec.trigger` is a 5-field cron string with an optional `CRON_TZ=`/`TZ=` prefix,
 * exactly what the client's own parser accepts.
 */
import { sendPrompt, persistState, bindAutomationsSnapshot, isAgentRunning } from "./chat.js";
import { loadState } from "./store.js";

export interface Automation {
  id: string;
  agentId: string;
  name: string;
  prompt: string;
  trigger: string;
  isEnabled: boolean;
  createdAt: number;
  lastRunAt: number | null;
  triggerDescription: string;
  /**
   * Run history. Never omit it: the row's status icon reads `automation.runs[0]?.status`
   * with no guard, so a record without `runs` throws during render and the error boundary
   * takes down the whole right rail — including the computer pane next to it.
   * (The box host always sends it; `nextRunAt` and `filePath` it also sends are never read.)
   */
  runs: AutomationRun[];
}

/**
 * One firing. `trigger: "manual"` matters: after Run now the FE looks for a manual run
 * whose id differs from the one it saw before, and waits on that to leave "running".
 * Newest first — the row icon reads `runs[0]`.
 */
export interface AutomationRun {
  id: string;
  status: "running" | "completed" | "failed";
  trigger: "manual" | "schedule";
  startedAt: number;
}

/** spec is what the editor sends; everything else is ours to assign. */
interface Spec { name?: string; prompt?: string; trigger?: unknown; isEnabled?: boolean }

const DEFAULT_TRIGGER = "0 9 * * *";

/**
 * The editor builds its spec only once a trigger exists, so an unreadable trigger means
 * we are misreading the shape — not that the user left it blank. Falling back silently is
 * how a wrong-key bug hides, so anything unrecognised is logged loudly with the raw value.
 */
function normaliseTrigger(raw: unknown): string {
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  if (raw && typeof raw === "object") {
    // Tolerate a wrapper around the cron expression rather than dropping the user's choice.
    for (const key of ["cron", "expression", "schedule", "value", "trigger"]) {
      const v = (raw as Record<string, unknown>)[key];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
  }
  if (raw !== undefined) {
    console.warn(`[grokbot2] routine trigger not understood, defaulting to "${DEFAULT_TRIGGER}": ${JSON.stringify(raw)}`);
  }
  return DEFAULT_TRIGGER;
}

/** Enough history for the UI without letting state.json grow without bound. */
const MAX_RUNS = 20;
let runSeq = 1;

const byAgent = new Map<string, Automation[]>();
let seq = 1;

// ── cron ──────────────────────────────────────────────────────────────────────

const ALIASES: Record<string, string> = {
  "@hourly": "0 * * * *", "@daily": "0 0 * * *", "@midnight": "0 0 * * *",
  "@weekly": "0 0 * * 0", "@monthly": "0 0 1 * *", "@yearly": "0 0 1 1 *", "@annually": "0 0 1 1 *",
};
const TZ_PREFIX = /^(?:CRON_TZ|TZ)=(\S+)\s+/;
const DAY_NAMES: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/**
 * Expand one cron field into the set of values it matches.
 * Handles `*`, `a`, `a-b`, `a,b`, `*&#47;n` and `a-b&#47;n` — the same grammar the client accepts.
 */
function expand(field: string, min: number, max: number): Set<number> | null {
  const out = new Set<number>();
  for (const part of field.split(",")) {
    const bits = part.split("/");
    if (bits.length > 2) return null;
    const range = bits[0] ?? "";
    const step = bits.length === 2 ? Number(bits[1]) : 1;
    if (!Number.isInteger(step) || step <= 0) return null;

    let lo: number, hi: number;
    if (range === "*" || range === "") {
      lo = min; hi = max;
    } else if (range.includes("-")) {
      const [a, b] = range.split("-");
      lo = Number(a); hi = Number(b);
    } else {
      lo = Number(range);
      // `5/10` means "from 5 onwards"; a bare `5` means exactly 5.
      hi = bits.length === 2 ? max : lo;
    }
    if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo < min || hi > max || lo > hi) return null;
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out.size ? out : null;
}

interface Schedule {
  minute: Set<number>; hour: Set<number>; dayOfMonth: Set<number>; month: Set<number>; dayOfWeek: Set<number>;
  domRestricted: boolean; dowRestricted: boolean; timeZone?: string;
}

export function parseCron(raw: string): Schedule | null {
  const text = (raw ?? "").trim().replace(/\s+/g, " ");
  if (!text) return null;
  const tzMatch = TZ_PREFIX.exec(text);
  const timeZone = tzMatch?.[1];
  const body = tzMatch ? text.slice(tzMatch[0].length) : text;
  const expr = ALIASES[body.toLowerCase()] ?? body;

  const f = expr.split(" ");
  if (f.length !== 5) return null;
  const [mi = "", ho = "", dom = "", mo = "", dow = ""] = f;

  const minute = expand(mi, 0, 59);
  const hour = expand(ho, 0, 23);
  const dayOfMonth = expand(dom, 1, 31);
  const month = expand(mo, 1, 12);
  const rawDow = expand(dow, 0, 7);
  if (!minute || !hour || !dayOfMonth || !month || !rawDow) return null;
  if (timeZone && !isZone(timeZone)) return null;

  // cron allows 7 for Sunday; normalise so matching only ever sees 0.
  const dayOfWeek = new Set([...rawDow].map((d) => (d === 7 ? 0 : d)));
  return {
    minute, hour, dayOfMonth, month, dayOfWeek,
    domRestricted: dom !== "*", dowRestricted: dow !== "*", timeZone,
  };
}

const zoneCache = new Map<string, boolean>();
function isZone(tz: string): boolean {
  const hit = zoneCache.get(tz);
  if (hit !== undefined) return hit;
  let ok = true;
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); } catch { ok = false; }
  zoneCache.set(tz, ok);
  return ok;
}

/** Wall-clock fields for `d` as seen in `tz` (local time when tz is absent). */
function fieldsIn(d: Date, tz?: string) {
  if (!tz) {
    return { minute: d.getMinutes(), hour: d.getHours(), dayOfMonth: d.getDate(), month: d.getMonth() + 1, dayOfWeek: d.getDay() };
  }
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return {
    minute: Number(get("minute")), hour: Number(get("hour")),
    dayOfMonth: Number(get("day")), month: Number(get("month")),
    dayOfWeek: DAY_NAMES[get("weekday")] ?? 0,
  };
}

/**
 * Standard cron day semantics: when BOTH day-of-month and day-of-week are
 * restricted the entry fires if either matches; otherwise the restricted one must.
 */
export function matches(s: Schedule, at: Date): boolean {
  const f = fieldsIn(at, s.timeZone);
  if (!s.minute.has(f.minute) || !s.hour.has(f.hour) || !s.month.has(f.month)) return false;
  const dom = s.dayOfMonth.has(f.dayOfMonth);
  const dow = s.dayOfWeek.has(f.dayOfWeek);
  if (s.domRestricted && s.dowRestricted) return dom || dow;
  if (s.domRestricted) return dom;
  if (s.dowRestricted) return dow;
  return true;
}

const ORDINAL = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Short human summary — the FE indexes this as a search keyword. */
export function describe(trigger: string): string {
  const s = parseCron(trigger);
  if (!s) return trigger;
  const list = (set: Set<number>, total: number) => (set.size >= total ? "*" : [...set].sort((a, b) => a - b).join(","));
  const time = s.hour.size === 24
    ? (s.minute.size === 60 ? "every minute" : `every hour at :${list(s.minute, 60)}`)
    : `${list(s.hour, 24)}:${[...s.minute].sort((a, b) => a - b).map((m) => String(m).padStart(2, "0")).join(",")}`;
  // "every minute daily" reads as a stutter — an unrestricted day is already implied.
  const everyMinute = s.hour.size === 24 && s.minute.size === 60;
  const days = s.dowRestricted ? ` on ${[...s.dayOfWeek].sort().map((d) => ORDINAL[d]).join(",")}`
    : s.domRestricted ? ` on day ${list(s.dayOfMonth, 31)}`
    : everyMinute ? ""
    : " daily";
  return `${time}${days}${s.timeZone ? ` (${s.timeZone})` : ""}`;
}

// ── store ─────────────────────────────────────────────────────────────────────

const listFor = (agentId: string): Automation[] => {
  let l = byAgent.get(agentId);
  if (!l) { l = []; byAgent.set(agentId, l); }
  return l;
};
const all = (): Automation[] => [...byAgent.values()].flat();
const agentIdOf = (a: any): string => a?.id ?? a?.agentId ?? "";

{
  const restored = (loadState() as { automations?: Automation[] }).automations ?? [];
  for (const r of restored) {
    if (!r?.id || !r.agentId) continue;
    // Records written before `runs` existed would crash the routines row on render.
    listFor(r.agentId).push({ ...r, runs: r.runs ?? [] });
    const n = /^automation-(\d+)$/.exec(r.id);
    if (n) seq = Math.max(seq, Number(n[1]) + 1);
  }
  if (restored.length) console.log(`[grokbot2] restored ${restored.length} routine(s)`);
}
bindAutomationsSnapshot(all);

const applySpec = (target: Automation, spec: Spec): Automation => {
  if (typeof spec?.name === "string") target.name = spec.name;
  if (typeof spec?.prompt === "string") target.prompt = spec.prompt;
  if (spec?.trigger !== undefined) {
    target.trigger = normaliseTrigger(spec.trigger);
    target.triggerDescription = describe(target.trigger);
  }
  if (typeof spec?.isEnabled === "boolean") target.isEnabled = spec.isEnabled;
  return target;
};

export function getAgentAutomations(a: { id?: string; agentId?: string }): Automation[] {
  return listFor(agentIdOf(a));
}

export function listAllAutomations(): Automation[] {
  return all();
}

export function createAgentAutomation(a: { id?: string; agentId?: string; spec?: Spec }): Automation[] {
  const agentId = agentIdOf(a);
  if (!agentId) return [];
  const spec = a?.spec ?? {};
  const trigger = normaliseTrigger(spec.trigger);
  const rec: Automation = {
    id: `automation-${seq++}`,
    agentId,
    name: spec.name?.trim() || "Routine",
    prompt: spec.prompt ?? "",
    trigger,
    isEnabled: spec.isEnabled ?? true,
    createdAt: Date.now(),
    lastRunAt: null,
    triggerDescription: describe(trigger),
    runs: [],
  };
  listFor(agentId).push(rec);
  persistState();
  console.log(`[grokbot2] routine created "${rec.name}" (${rec.triggerDescription})`);
  return listFor(agentId);
}

export function updateAgentAutomation(a: { id?: string; agentId?: string; automationId?: string; spec?: Spec }): Automation[] {
  const agentId = agentIdOf(a);
  const rec = listFor(agentId).find((x) => x.id === a?.automationId);
  if (rec) { applySpec(rec, a?.spec ?? {}); persistState(); }
  return listFor(agentId);
}

export function deleteAgentAutomation(a: { id?: string; agentId?: string; automationId?: string }): Automation[] {
  const agentId = agentIdOf(a);
  const l = listFor(agentId);
  const i = l.findIndex((x) => x.id === a?.automationId);
  if (i >= 0) { l.splice(i, 1); persistState(); }
  return l;
}

export function setAgentAutomationEnabled(a: { id?: string; agentId?: string; automationId?: string; isEnabled?: boolean; enabled?: boolean }): Automation[] {
  const agentId = agentIdOf(a);
  const rec = listFor(agentId).find((x) => x.id === a?.automationId);
  if (rec) { rec.isEnabled = a?.isEnabled ?? a?.enabled ?? !rec.isEnabled; persistState(); }
  return listFor(agentId);
}

/** Fire a routine: its prompt goes through the normal chat path, so the model really answers. */
function fire(rec: Automation, trigger: AutomationRun["trigger"]): void {
  rec.lastRunAt = Date.now();
  const run: AutomationRun = { id: `run-${runSeq++}`, status: "running", trigger, startedAt: Date.now() };
  rec.runs.unshift(run);
  rec.runs.length = Math.min(rec.runs.length, MAX_RUNS);
  console.log(`[grokbot2] routine ${trigger}: "${rec.name}" -> ${rec.agentId}`);
  try {
    sendPrompt({ agentId: rec.agentId, content: rec.prompt });
  } catch (e) {
    run.status = "failed";
    console.warn(`[grokbot2] routine "${rec.name}" failed:`, (e as Error).message);
  }
  persistState();
}

/**
 * The chat path is fire-and-forget, so a run leaves "running" only once the agent's
 * turn is no longer in flight. Without this the row spins forever.
 */
function settleRuns(): void {
  let changed = false;
  for (const rec of all()) {
    for (const run of rec.runs) {
      if (run.status !== "running" || isAgentRunning(rec.agentId)) continue;
      run.status = "completed";
      changed = true;
    }
  }
  if (changed) persistState();
}

export function runAgentAutomationNow(a: { id?: string; agentId?: string; automationId?: string }): Record<string, never> {
  const rec = listFor(agentIdOf(a)).find((x) => x.id === a?.automationId);
  if (rec) fire(rec, "manual");
  return {};
}

// ── scheduler ─────────────────────────────────────────────────────────────────

/**
 * Cron granularity is one minute, so a routine must fire at most once per minute —
 * tracking the last minute we fired keeps a 30s tick from double-firing.
 */
const firedAtMinute = new Map<string, number>();
const minuteOf = (d: Date) => Math.floor(d.getTime() / 60_000);

export function tick(now = new Date()): void {
  settleRuns();
  const minute = minuteOf(now);
  for (const rec of all()) {
    if (!rec.isEnabled || !rec.prompt.trim()) continue;
    if (firedAtMinute.get(rec.id) === minute) continue;
    const sched = parseCron(rec.trigger);
    if (!sched || !matches(sched, now)) continue;
    firedAtMinute.set(rec.id, minute);
    fire(rec, "schedule");
  }
}

/** 10s, not 60s: cron only needs minute resolution, but a finished run should stop spinning promptly. */
export function startScheduler(): void {
  setInterval(() => tick(), 10_000).unref?.();
  console.log("[grokbot2] routine scheduler started (10s tick)");
}
