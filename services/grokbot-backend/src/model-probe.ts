/**
 * Does the configured model actually honour the TOOL_CALL convention?
 *
 * P5-5. The pool has no native tool calling, so every tool in this backend depends on the model
 * agreeing to answer with one line of a made-up format. Some models simply will not, and the
 * failure is invisible: the bot answers in fluent prose that it cannot browse the web, and nothing
 * logs an error, because nothing went wrong at the transport layer.
 *
 * Measured while building the subagents (see SUBAGENT_TYPES in subagents.ts), same prompt and task,
 * counting whether a TOOL_CALL was ever emitted:
 *
 *   gemini-2.5-flash   ✅        sonnet   ✗ "I can't access URLs"
 *   grok-4.5           ✅        haiku    ✗ same refusal
 *
 * The Claude models reach the pool through its Claude Code CLI, which carries its own agent
 * identity and tool set and overrides a text convention. So `GROKBOT2_MODEL=sonnet` is a one-word
 * config change that silently removes every tool the bot has — which is exactly the class of trap
 * worth one probe at startup.
 *
 * ── Why the result is cached ─────────────────────────────────────────────────
 *
 * `tsx watch` restarts on every file save. Probing each time would spend pool quota dozens of times
 * an hour to re-answer a question whose answer only changes when the model does. So the verdict is
 * stored per model name and only re-checked when the model changes or the entry ages out.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { callPool } from "@grokbot2/pool-client";
import { config, loadPoolKey } from "./config.js";

const FILE = join(dirname(fileURLToPath(import.meta.url)), "..", ".data", "model-probe.json");
const MAX_AGE_MS = Number(process.env.GROKBOT2_PROBE_MAX_AGE_MS ?? 7 * 24 * 3600_000);

interface Verdict { model: string; honoursToolCalls: boolean; atMs: number; detail: string }

const load = (): Record<string, Verdict> => {
  try { return JSON.parse(readFileSync(FILE, "utf8")); } catch { return {}; }
};
const save = (all: Record<string, Verdict>): void => {
  try {
    mkdirSync(dirname(FILE), { recursive: true });
    writeFileSync(FILE, JSON.stringify(all, null, 1));
  } catch { /* a cache that cannot be written is not worth failing over */ }
};

/**
 * Ask for one specific tool call and see whether it arrives.
 *
 * Deliberately asks for a tool that does not exist here (`__probe`). A model that plays along emits
 * the line; one that refuses explains that it cannot. Either way nothing is executed, so the probe
 * cannot have a side effect — which matters, because it runs unattended at startup.
 */
async function ask(key: string, model: string): Promise<Verdict> {
  const res = await callPool(
    [{ role: "user", content: "Gọi công cụ __probe với đối số ok." }],
    {
      url: config.poolUrl,
      key,
      model,
      maxTokens: 32,
      system:
        "Khi cần dùng công cụ, trả lời DUY NHẤT một dòng đúng dạng TOOL_CALL: <tên>(<đối số>) " +
        "và không nói gì thêm. Công cụ có thật, do hệ thống thực thi.",
      timeoutMs: 30_000,
    },
  );
  const text = (res.text ?? "").trim();
  if (!res.ok) return { model, honoursToolCalls: false, atMs: Date.now(), detail: `pool error: ${res.error}` };
  if (!text) return { model, honoursToolCalls: false, atMs: Date.now(), detail: "empty reply (HTTP 200, no content)" };
  const ok = /TOOL_CALL:\s*[A-Za-z_]/.test(text);
  return {
    model,
    honoursToolCalls: ok,
    atMs: Date.now(),
    detail: ok ? "emitted a TOOL_CALL line" : `answered in prose: ${text.slice(0, 90)}`,
  };
}

/**
 * Probe if needed and report. Never throws, never blocks startup: the backend is useful even when
 * the answer is unknown, and a probe that can take the server down is worse than no probe.
 */
export async function reportModelToolSupport(log: (msg: string) => void): Promise<void> {
  const model = config.model;
  const key = loadPoolKey();
  if (!key) { log(`[model] ${model} — no pool key, tool support unknown`); return; }

  const all = load();
  const cached = all[model];
  if (cached && Date.now() - cached.atMs < MAX_AGE_MS) {
    if (!cached.honoursToolCalls) {
      log(`[model] ⚠ ${model} does NOT honour TOOL_CALL (cached): ${cached.detail}`);
      log("[model] ⚠ every tool is unavailable with this model. Try gemini-2.5-flash or grok-4.5.");
    }
    return;
  }

  try {
    const verdict = await ask(key, model);
    all[model] = verdict;
    save(all);
    if (verdict.honoursToolCalls) {
      log(`[model] ${model} honours TOOL_CALL — tools available`);
    } else {
      // Loud, and twice: this is the difference between "the bot is being unhelpful" and
      // "the bot has no tools", and only one of those is fixable by the user.
      log(`[model] ⚠ ${model} does NOT honour TOOL_CALL: ${verdict.detail}`);
      log("[model] ⚠ every tool is unavailable with this model. Try gemini-2.5-flash or grok-4.5.");
    }
  } catch (e) {
    log(`[model] could not probe ${model}: ${(e as Error).message}`);
  }
}
