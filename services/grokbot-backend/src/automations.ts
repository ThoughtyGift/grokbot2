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
import { agentExists, sendPrompt, persist, bindAutomationsSnapshot, bindAutomationCreate, bindAutomationCleanup, automationsChanged, isAgentRunning, pushTranscriptEvent, pushListenerConnect } from "./chat.js";
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
  /**
   * Trigger phi-cron, giữ nguyên hình dạng client gửi.
   *
   * Trước đây không có trường này, và hậu quả im lặng: `normaliseTrigger` chỉ hiểu các khoá kiểu
   * cron, nên một trigger `{type:"slack",channel:"#general",keyword:"hoá đơn"}` rơi vào nhánh mặc
   * định và được lưu thành `"0 9 * * *"`. Người dùng chọn "Slack message", bảng hiện "9:00 daily",
   * và cái routine đó chạy mỗi sáng chín giờ thay vì khi có tin nhắn. Đo được đúng như vậy.
   *
   * Tệ hơn nữa: `listenerPlatform` đọc chuỗi trigger để biết routine nghe nền tảng nào, nên sau khi
   * bị hạ cấp thành cron thì **không routine nào khớp Slack hay GitHub được** — hai receiver bên
   * ops có chạy cũng không đánh thức nổi ai.
   */
  triggerSpec?: Record<string, unknown>;
}

/**
 * One firing. `trigger: "manual"` matters: after Run now the FE looks for a manual run
 * whose id differs from the one it saw before, and waits on that to leave "running".
 * Newest first — the row icon reads `runs[0]`.
 */
export interface AutomationRun {
  id: string;
  status: "running" | "completed" | "failed";
  /** `event` is a listener firing (a Slack mention, a webhook), alongside manual and scheduled. */
  trigger: "manual" | "schedule" | "event";
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

/**
 * Trigger có cấu trúc của client, hoặc null nếu đây là một lịch cron.
 *
 * Nhận diện bằng `type`, đúng thứ editor của client đặt ra (`MOi` của nó: mỗi nhánh trả về
 * `{type, …trường riêng}`). Không đoán theo khoá nào khác — đoán sai ở đây là im lặng.
 */
function structuredTrigger(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const type = typeof o.type === "string" ? o.type : "";
  if (!type || type === "cron") return null;
  return { ...o, type };
}

/** Câu mô tả cho một trigger phi-cron — FE dùng chính chuỗi này làm từ khoá tìm kiếm. */
function describeStructured(t: Record<string, unknown>): string {
  const s = (k: string): string => (typeof t[k] === "string" ? (t[k] as string).trim() : "");
  switch (t.type) {
    case "slack": {
      const where = s("channel") ? ` ở ${s("channel")}` : "";
      // Từ khoá nằm TRONG `match`, không nằm cạnh nó. Bắt được từ payload thật của client khi tự
      // chọn "Slack message" trong app rồi đọc lại đối số:
      //   {"type":"slack","channel":"#thu-nghiem","match":{"kind":"keyword","keyword":"hoa don"}}
      // Bản đầu đọc `t.keyword` — hình dạng tôi tự nghĩ ra — nên câu mô tả im lặng bỏ mất từ khoá.
      const m = (t.match && typeof t.match === "object" ? t.match : {}) as Record<string, unknown>;
      const kwRaw = typeof m.keyword === "string" ? m.keyword : (typeof t.keyword === "string" ? t.keyword : "");
      const kw = kwRaw.trim() ? ` chứa "${kwRaw.trim()}"` : "";
      return `khi có tin nhắn Slack${where}${kw}`;
    }
    case "github": {
      const evs = Array.isArray(t.events) ? (t.events as unknown[]).join(", ") : "";
      return `khi có sự kiện GitHub${evs ? ` (${evs})` : ""}${s("repo") ? ` ở ${s("repo")}` : ""}`;
    }
    case "microsoftTeams": return "khi có tin nhắn Teams";
    case "linear": return `khi Linear ${s("event") || "có thay đổi"}`;
    case "sentry": return `khi Sentry ${s("event") || "có sự kiện"}`;
    case "pagerduty": return `khi PagerDuty ${s("event") || "có sự cố"}`;
    default: return String(t.type);
  }
}

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
// Hand chat.ts a creator so `create_routine` can reach this module without importing it — the import
// only ever goes one way, automations -> chat, and closing the loop would be a cycle.
bindAutomationCreate((agentId, spec) => {
  const list = createAgentAutomation({ id: agentId, spec });
  return list[list.length - 1]?.triggerDescription ?? null;
});
// And drop an agent's routines when the agent is deleted, so the scheduler stops trying to fire them.
bindAutomationCleanup((agentId) => { if (byAgent.delete(agentId)) persist(); });

const applySpec = (target: Automation, spec: Spec): Automation => {
  if (typeof spec?.name === "string") target.name = spec.name;
  if (typeof spec?.prompt === "string") target.prompt = spec.prompt;
  if (spec?.trigger !== undefined) {
    const structured = structuredTrigger(spec.trigger);
    if (structured) {
      target.triggerSpec = structured;
      // `trigger` vẫn là chuỗi vì cả `listenerPlatform` lẫn bộ lập lịch đọc nó. Chuỗi giờ mang tên
      // nền tảng, nên một routine Slack thật sự khớp được với sự kiện Slack.
      target.trigger = String(structured.type ?? "");
      target.triggerDescription = describeStructured(structured);
    } else {
      delete target.triggerSpec;
      target.trigger = normaliseTrigger(spec.trigger);
      target.triggerDescription = describe(target.trigger);
    }
  }
  if (typeof spec?.isEnabled === "boolean") target.isEnabled = spec.isEnabled;
  return target;
};

export function getAgentAutomations(a: { id?: string; agentId?: string }): Automation[] {
  return listFor(agentIdOf(a));
}

/**
 * The automation shape the CLIENT reads — different from how we store it, and clicking a routine
 * crashed the editor because of it: "Couldn't render this. This section hit an unexpected error."
 *
 * We store `trigger` as a cron STRING ("0 9 * * *"). The client's editor reads `trigger.type` and
 * `trigger.schedule` — it wants an OBJECT. Its own helper is literally `Bb(t) = {type:"cron",
 * schedule:t}`, and its trigger-chip renderer switches on `trigger.type` ("cron" | "slack" | …). Given
 * a bare string, `trigger.type` is undefined, no case matches, and rendering the chip throws — the
 * section-scoped error boundary is what the user sees. The panel ROW survived because it reads
 * `triggerDescription`, which we do provide; only the editor's "When to run" section crashed.
 *
 * So this maps our internal record to the client's shape: `trigger` as `{type, schedule}` (or the
 * platform object for a listener), plus the top-level `schedule`/`scheduleDescription` the editor also
 * reads. Applied at the gateway boundary only; internally the cron string stays, because parseCron and
 * the scheduler are built on it.
 */
/**
 * The structured trigger object the editor renders, per platform — copied field-for-field from the
 * original's own defaults (its `S3n` switch). The editor reads `trigger.type` and then the
 * platform-specific fields; a missing field renders blank, a wholly missing object throws. So every
 * one of the seven trigger types the "Add another" menu offers gets its full default shape here, even
 * the ones we cannot yet FIRE — the display must not crash regardless of whether a receiver exists.
 */
function triggerObject(rawTrigger: string, spec?: Record<string, unknown>): Record<string, unknown> {
  // Trigger người dùng đã chọn thì trả lại đúng nó — kể cả kênh, từ khoá, repo. Trả về hình dạng
  // rỗng ở đây nghĩa là mở lại routine thì mọi ô lọc trống trơn, và người dùng phải gõ lại.
  if (spec && typeof spec.type === "string" && spec.type !== "cron") return spec;
  const p = listenerPlatform(rawTrigger);
  switch (p) {
    // Hình dạng mặc định lấy theo payload THẬT của client (`match` là object `{kind}`), không phải
    // theo phỏng đoán. Chỉ dùng khi không có bản gốc người dùng đã chọn.
    case "slack": return { type: "slack", channel: "", match: { kind: "any" } };
    case "github": return { type: "github", repo: "", events: ["pr-opened"], userAllowlist: "", ciBranch: "" };
    case "microsoftTeams": return { type: "microsoftTeams", tenantId: "", teamIds: "", channelIds: "", messageContains: "", messageContainsIsRegex: false, blockUnauthenticatedTeamsUsers: false };
    case "linear": return { type: "linear", event: "issueCreated", statusIds: "", cycleIds: "", projectIds: "", teamIds: "" };
    case "sentry": return { type: "sentry", event: "issueCreated", projectIds: "" };
    case "pagerduty": return { type: "pagerduty", event: "incidentTriggered", serviceIds: "" };
    default: return { type: "cron", schedule: rawTrigger };
  }
}

export function toClientAutomation(rec: Automation): Record<string, unknown> {
  const trigger = triggerObject(rec.trigger, rec.triggerSpec);
  return {
    ...rec,
    trigger,
    schedule: rec.trigger,
    scheduleDescription: rec.triggerDescription,
    // `body` alongside `prompt`: the editor's Instruction field has read both across builds, and
    // sending both costs nothing while a wrong single guess leaves the field blank.
    body: rec.prompt,
  };
}

/** Client-facing list — the shape the FE editor and panel expect. */
export function getAgentAutomationsForClient(a: { id?: string; agentId?: string }): Record<string, unknown>[] {
  return listFor(agentIdOf(a)).map(toClientAutomation);
}

export function listAllAutomations(): Automation[] {
  return all();
}

export function createAgentAutomation(a: { id?: string; agentId?: string; spec?: Spec }): Automation[] {
  const agentId = agentIdOf(a);
  if (!agentId) return [];
  const spec = a?.spec ?? {};
  // Cùng một phép đọc trigger với `applySpec`. Bản đầu tạo và sửa dùng hai đường khác nhau, nên
  // sửa một đường là còn nguyên lỗi ở đường kia — và đường "tạo" mới là đường người dùng đi.
  const structured = structuredTrigger(spec.trigger);
  const trigger = structured ? String(structured.type ?? "") : normaliseTrigger(spec.trigger);
  const rec: Automation = {
    id: `automation-${seq++}`,
    agentId,
    name: spec.name?.trim() || "Routine",
    prompt: spec.prompt ?? "",
    trigger,
    isEnabled: spec.isEnabled ?? true,
    createdAt: Date.now(),
    lastRunAt: null,
    triggerDescription: structured ? describeStructured(structured) : describe(trigger),
    runs: [],
    ...(structured ? { triggerSpec: structured } : {}),
  };
  listFor(agentId).push(rec);
  persist();
  console.log(`[grokbot2] routine created "${rec.name}" (${rec.triggerDescription})`);
  // The original writes the change into the bot's own transcript, and then — 10ms later, measured —
  // a card saying the routine cannot fire until its platform is connected. Both are copied from its
  // stored replica; without them a routine appears in the side panel with no trace in the history,
  // and one that can never fire looks identical to one that will.
  pushTranscriptEvent(agentId, {
    type: "automation-changed", action: "created", automationId: rec.id, automationName: rec.name,
  });
  const platform = listenerPlatform(trigger);
  if (platform) pushListenerConnect(agentId, platform);
  automationsChanged(agentId);
  return listFor(agentId);
}

/**
 * Which platform a trigger listens on, when it is not something we can fire ourselves.
 *
 * A cron routine needs nothing — the scheduler in this process runs it. A routine woken by a Slack
 * mention or a Discord message needs a listener on that platform, which this install does not have,
 * so the honest thing is to say so at the moment the routine is created.
 */
function listenerPlatform(trigger: string): string | null {
  const t = trigger.toLowerCase();
  // The original's six non-cron listener platforms, from its own trigger switch — NOT discord/telegram
  // (those are message CONNECTORS, not routine triggers), and "microsoftTeams" spelling matters because
  // the trigger object keys off it.
  const map: Array<[string, string]> = [
    ["slack", "slack"], ["github", "github"], ["git", "github"],
    ["teams", "microsoftTeams"], ["microsoftteams", "microsoftTeams"],
    ["linear", "linear"], ["sentry", "sentry"], ["pagerduty", "pagerduty"], ["pager", "pagerduty"],
  ];
  for (const [needle, platform] of map) if (t.includes(needle)) return platform;
  return null;
}

export function updateAgentAutomation(a: { id?: string; agentId?: string; automationId?: string; spec?: Spec }): Automation[] {
  const agentId = agentIdOf(a);
  const rec = listFor(agentId).find((x) => x.id === a?.automationId);
  if (rec) {
    applySpec(rec, a?.spec ?? {});
    persist();
    pushTranscriptEvent(agentId, {
      type: "automation-changed", action: "updated", automationId: rec.id, automationName: rec.name,
    });
    automationsChanged(agentId);
  }
  return listFor(agentId);
}

export function deleteAgentAutomation(a: { id?: string; agentId?: string; automationId?: string }): Automation[] {
  const agentId = agentIdOf(a);
  const l = listFor(agentId);
  const i = l.findIndex((x) => x.id === a?.automationId);
  if (i >= 0) { l.splice(i, 1); persist(); automationsChanged(agentId); }
  return l;
}

export function setAgentAutomationEnabled(a: { id?: string; agentId?: string; automationId?: string; isEnabled?: boolean; enabled?: boolean }): Automation[] {
  const agentId = agentIdOf(a);
  const rec = listFor(agentId).find((x) => x.id === a?.automationId);
  if (rec) { rec.isEnabled = a?.isEnabled ?? a?.enabled ?? !rec.isEnabled; persist(); automationsChanged(agentId); }
  return listFor(agentId);
}

/**
 * Fire a routine: its prompt goes through the normal chat path, so the model really answers.
 *
 * `context` is prepended for a listener firing — the Slack message that woke it, so the routine's
 * instruction (which the original writes as "A Slack mention just woke you… reply in that thread")
 * has the text, channel and thread to act on. A scheduled run has no context; the prompt stands alone.
 */
function fire(rec: Automation, trigger: AutomationRun["trigger"], context?: string): void {
  rec.lastRunAt = Date.now();
  const run: AutomationRun = { id: `run-${runSeq++}`, status: "running", trigger, startedAt: Date.now() };
  // A routine can outlive its bot: removal does not always reach `bindAutomationCleanup`, and four
  // orphans were found here — one a daily cron prompting a bot nobody could read, spending a pool
  // call on a conversation that no longer exists. The run is recorded as failed rather than dropped
  // silently, so the panel can say why, and the routine is left alone: deleting somebody's routine
  // because a lookup missed once is the worse mistake.
  if (!agentExists(rec.agentId)) {
    run.status = "failed";
    rec.runs.unshift(run);
    rec.runs.length = Math.min(rec.runs.length, MAX_RUNS);
    console.warn(`[grokbot2] routine "${rec.name}" points at ${rec.agentId}, which no longer exists — not firing`);
    persist();
    return;
  }
  rec.runs.unshift(run);
  rec.runs.length = Math.min(rec.runs.length, MAX_RUNS);
  console.log(`[grokbot2] routine ${trigger}: "${rec.name}" -> ${rec.agentId}`);
  try {
    const content = context ? `${context}\n\n---\n\n${rec.prompt}` : rec.prompt;
    sendPrompt({ agentId: rec.agentId, content });
  } catch (e) {
    run.status = "failed";
    console.warn(`[grokbot2] routine "${rec.name}" failed:`, (e as Error).message);
  }
  persist();
  automationsChanged(rec.agentId);   // Run history is part of the panel; a new run should show live.
}

/**
 * Fire every routine listening on a platform — Tầng 1 of the Slack bridge.
 *
 * A routine is a listener for `platform` when its trigger names it (the agent writes triggers like
 * "slack_mention"; `listenerPlatform` reads the platform out). The original's native listeners are
 * only Slack and GitHub, so this is the single path that turns an event-triggered routine from
 * "shown in the panel" into "actually runs". Returns how many fired, so the receiver can report it.
 */
export function fireListeners(platform: string, context: string, ev?: PlatformEvent): number {
  let n = 0, skipped = 0;
  for (const rec of all()) {
    if (!rec.isEnabled || !rec.prompt.trim()) continue;
    if (listenerPlatform(rec.trigger) !== platform) continue;
    if (ev && !matchesEvent(rec, ev)) { skipped += 1; continue; }
    fire(rec, "event", context);
    n += 1;
  }
  // Nói ra số bị lọc: "0 routine chạy" vì không khớp điều kiện và vì không có routine nào là hai
  // chuyện khác nhau, và chỉ một trong hai là lỗi cấu hình cần sửa.
  if (skipped) console.log(`[grokbot2] ${platform}: chạy ${n} routine, bỏ qua ${skipped} vì không khớp điều kiện`);
  return n;
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
  if (changed) persist();
}

export function runAgentAutomationNow(a: { id?: string; agentId?: string; automationId?: string }): Record<string, never> {
  const rec = listFor(agentIdOf(a)).find((x) => x.id === a?.automationId);
  if (rec) fire(rec, "manual");
  return {};
}

/** Fire one row by id — ops POSTs here; CRUD/history stay on this process. */
export function fireById(automationId: string, trigger: AutomationRun["trigger"] = "schedule", context?: string): boolean {
  const rec = all().find((x) => x.id === automationId);
  if (!rec) return false;
  fire(rec, trigger, context);
  return true;
}

/** Enabled routines with a prompt — ops matches cron without reading sqlite. */
export function routinesForOps(): Array<{ id: string; agentId: string; trigger: string; prompt: string }> {
  return all()
    .filter((r) => r.isEnabled && r.prompt.trim())
    .map((r) => ({ id: r.id, agentId: r.agentId, trigger: r.trigger, prompt: r.prompt }));
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

/** Peek due ids without firing. Does not consume firedAtMinute — tick() does that. */
export function dueIds(now = new Date()): string[] {
  const minute = minuteOf(now);
  const ids: string[] = [];
  for (const rec of all()) {
    if (!rec.isEnabled || !rec.prompt.trim()) continue;
    if (firedAtMinute.get(rec.id) === minute) continue;
    const sched = parseCron(rec.trigger);
    if (!sched || !matches(sched, now)) continue;
    ids.push(rec.id);
  }
  return ids;
}

/** 10s, not 60s: cron only needs minute resolution, but a finished run should stop spinning promptly. */
export function startScheduler(): void {
  setInterval(() => tick(), 10_000).unref?.();
  console.log("[grokbot2] routine scheduler started (10s tick)");
}

export async function opsHealth(): Promise<string> {
  const base = (process.env.GROKBOT2_OPS_URL ?? "").replace(/\/$/, "");
  if (!base) return "in-process (GROKBOT2_OPS_URL unset)";
  try {
    const r = await fetch(`${base}/health`, { signal: AbortSignal.timeout(1500) });
    const body = r.ok ? await r.json() as { role?: string } : null;
    if (!r.ok) return `HTTP ${r.status} ${base}`;
    return body?.role === "ops" ? `up ${base}` : `up ${base} (role=${body?.role ?? "?"})`;
  } catch (e) {
    return `DOWN ${base} (${(e as Error).message})`;
  }
}

/**
 * Sự kiện đến từ một nền tảng, dạng có cấu trúc — đủ để đối chiếu với điều kiện người dùng đặt.
 *
 * Trước đây ops chỉ gửi xuống một đoạn văn cho model đọc, nên `fireListeners` đánh thức **mọi**
 * routine của nền tảng đó: chọn kênh `#ke-toan` và từ khoá "hoá đơn" xong vẫn bị gọi dậy vì một
 * tin nhắn trong `#random`. Điều kiện hiện trên màn hình mà không có tác dụng nào là tệ hơn không
 * có ô để điền.
 */
export interface PlatformEvent {
  platform: string;
  /** Slack: id kênh (`C123`) hoặc tên (`#ke-toan`). GitHub: không dùng. */
  channel?: string;
  channelName?: string;
  text?: string;
  user?: string;
  /** GitHub: `owner/repo`. */
  repo?: string;
  /** GitHub: `pr-opened` | `pr-pushed` | `ci-passed` | `ci-failed` | … */
  kind?: string;
  sender?: string;
}

const norm = (s: unknown): string => String(s ?? "").trim().toLowerCase().replace(/^#/, "");

/**
 * Routine này có được đánh thức bởi sự kiện này không.
 *
 * Nguyên tắc: **điều kiện để trống nghĩa là không lọc**, đúng như bản gốc — ô `#channel` trống ở
 * giao diện của họ có chữ gợi ý mờ, không phải một bộ lọc rỗng. Và routine kiểu cũ (trigger là một
 * chuỗi như `"slack_mention"`, không có `triggerSpec`) vẫn nổ như trước: đây là thêm bộ lọc, không
 * phải đổi luật cho những gì đang chạy.
 */
export function matchesEvent(rec: Automation, ev: PlatformEvent): boolean {
  const spec = rec.triggerSpec;
  if (!spec) return true;

  if (spec.type === "slack") {
    const want = norm(spec.channel);
    if (want) {
      const got = [norm(ev.channel), norm(ev.channelName)].filter(Boolean);
      if (got.length && !got.includes(want)) return false;
    }
    const match = (spec.match && typeof spec.match === "object" ? spec.match : {}) as Record<string, unknown>;
    const keyword = typeof match.keyword === "string" ? match.keyword : (typeof spec.keyword === "string" ? spec.keyword : "");
    if (keyword.trim() && !String(ev.text ?? "").toLowerCase().includes(keyword.trim().toLowerCase())) return false;
    return true;
  }

  if (spec.type === "github") {
    const wantRepo = norm(spec.repo);
    if (wantRepo && norm(ev.repo) && norm(ev.repo) !== wantRepo) return false;
    const events = Array.isArray(spec.events) ? (spec.events as unknown[]).map(norm).filter(Boolean) : [];
    if (events.length && ev.kind && !events.includes(norm(ev.kind))) return false;
    // Danh sách người được phép: bỏ trống là mọi người. Một tên trong đó mà người gửi không khớp
    // thì KHÔNG chạy — đây là hàng rào, nên nghi ngờ thì không nổ.
    const allow = String(spec.userAllowlist ?? "").split(/[,\s]+/).map(norm).filter(Boolean);
    if (allow.length && ev.sender && !allow.includes(norm(ev.sender))) return false;
    return true;
  }

  // Bốn nền tảng còn lại chưa có bộ thu ở đây, nên không có gì để lọc.
  return true;
}
