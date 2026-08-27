/**
 * System prompt assembly, in three ordered tiers: stable → context → volatile.
 *
 * The ordering is the whole point, and it is not cosmetic. Providers cache a prompt by its
 * longest unchanged PREFIX, so anything that changes per turn must come last: put the
 * timestamp first and every turn is a cache miss on the full ~5k-token base prompt. The
 * tiering is borrowed from hermes-agent, which assembles
 * `stable → context → volatile` for exactly this reason.
 *
 *   stable   identity, behaviour, tool guidance      — same every turn for a given config
 *   context  which bot this is, what the box offers  — changes when the workspace changes
 *   volatile date, timezone                          — changes every turn
 *
 * Keeping the boundary explicit also stops the slow drift where a per-turn value gets
 * appended to the base prompt and quietly destroys caching for everything behind it.
 */
import { config } from "./config.js";

export interface PromptContext {
  /** The bot the user is talking to; the original addresses the agent by name. */
  agentName?: string;
  /**
   * The bot's Description — the Settings pane calls it "What this Bot is for", and when one bot
   * creates another (0.29's team flow) this is the SOP the creator writes for it. It steered
   * nothing until 7.4.2: measured in the group E2E, a bot named "Kho" with a warehouse-only
   * description introduced itself as a generic assistant because this text never left the roster.
   */
  description?: string;
  /** Shell/file tools are attached to a real box. */
  boxOn?: boolean;
  /** The box's browser is reachable. */
  browserOn?: boolean;
  /** IANA zone from host settings, e.g. "Asia/Ho_Chi_Minh". */
  timeZone?: string;
  /** Injected in tests so the volatile tier is deterministic. */
  now?: Date;
  /** What this bot has learned about the user, already rendered. */
  memory?: string;
  /**
   * Lát `<available_skills>` — danh sách SOP trên đĩa box, đã dựng sẵn (xem skills.ts).
   *
   * Nằm ở tầng NGỮ CẢNH chứ không ở tầng ổn định: skill đổi khi người dùng thêm file, không đổi
   * theo từng lượt. Bản gốc cũng xếp `skills` thành một lát riêng, ngay sau `rules` và trước `mcp`.
   */
  skills?: string;
}

/** Tier 1 — identity, behaviour and the tool contract. Cacheable. */
export function stableTier(toolProtocol: string): string {
  return config.system + toolProtocol;
}

/** Tier 2 — what this particular workspace is. Changes rarely. */
export function contextTier(ctx: PromptContext): string {
  const lines: string[] = [];
  // The stable tier opens "You are Grok Bot", and each bot also has its own name. Left as
  // two bare statements the model resolved the conflict by naming the model behind the pool
  // ("Mình là Gemini") — which the original never does. So the per-bot name is stated as the
  // answer to give, and the fallback is closed explicitly.
  if (ctx.agentName) {
    lines.push(
      `Your name in this conversation is "${ctx.agentName}" — when the user asks who you are or what ` +
      `you are called, answer with that name. You NEVER introduce yourself by the name of the ` +
      `underlying model (Gemini, Claude, GPT, Grok…) and never say which company made you.`,
    );
  }

  // The persona sits directly after the name, still inside the cacheable context tier: it
  // changes when the user edits the bot, not per turn.
  if (ctx.description?.trim()) {
    lines.push(
      "",
      "## Your role",
      "",
      "The user set this bot up with the following description. It is your job description —",
      "follow it: stay in this role, respect its rules and boundaries, and answer in its voice.",
      "",
      ctx.description.trim(),
    );
  }

  // State the workspace plainly. The original's prompt describes a box with a shell, a
  // browser and a desktop; with none of those attached, repeating that text would teach
  // the model to promise capabilities this install does not have.
  const has: string[] = [];
  // "box" is deliberately absent from the text the model reads. tools.ts already forbids saying it to
  // the user — the original always calls it "my computer" — and these three lines were teaching the
  // opposite word twice in the same prompt, which is how "I'm running on a Linux Box" reached a live
  // reply. Naming it "your computer" here means the vocabulary agrees end to end.
  if (ctx.boxOn) has.push("a shell and files on your own Linux computer");
  if (ctx.browserOn) has.push("a browser on that same computer");
  lines.push(
    has.length
      ? `You have: ${has.join(", ")}. These tools run on YOUR computer, not on the user's machine.`
      : "No computer is attached yet: you CANNOT run shell commands, read files, or open a browser. " +
        "Do not promise any of that — say plainly that no computer is connected.",
  );

  // Memory belongs in THIS tier. It changes as the agent learns but not per turn, so it sits
  // behind the cacheable prefix and ahead of the timestamp. Injecting it every turn is the
  // point: a memory the agent has to remember to go and read is one it usually does not read.
  if (ctx.memory?.trim()) lines.push("", ctx.memory.trim());
  // Skill đứng SAU trí nhớ và trước dấu thời gian, cùng lý do: nó đổi theo đĩa chứ không theo lượt.
  if (ctx.skills?.trim()) lines.push("", ctx.skills.trim());
  return lines.join("\n");
}

/**
 * Tier 3 — the only part that changes per turn.
 *
 * Kept deliberately tiny: every token here is a token that cannot be cached.
 */
export function volatileTier(ctx: PromptContext): string {
  const now = ctx.now ?? new Date();
  const tz = ctx.timeZone && isZone(ctx.timeZone) ? ctx.timeZone : "UTC";
  // Formatted in English like the rest of the prompt. The stamp is read by the model, not shown to
  // the user, and the reply language follows the user's message rather than the prompt's — measured,
  // a Vietnamese question gets a Vietnamese answer 3/3 with an English prompt.
  const stamp = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz, dateStyle: "full", timeStyle: "short", hourCycle: "h23",
  }).format(now);
  return `The current time is ${stamp} (${tz}).`;
}

const zones = new Map<string, boolean>();
function isZone(tz: string): boolean {
  const hit = zones.get(tz);
  if (hit !== undefined) return hit;
  let ok = true;
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); } catch { ok = false; }
  zones.set(tz, ok);
  return ok;
}

/** Join the tiers in cache order. Empty tiers are dropped so no stray blank block appears. */
export function buildSystemPrompt(toolProtocol: string, ctx: PromptContext = {}): string {
  return [stableTier(toolProtocol), contextTier(ctx), volatileTier(ctx)]
    .map((s) => s.trim())
    .filter(Boolean)
    .join("\n\n");
}
