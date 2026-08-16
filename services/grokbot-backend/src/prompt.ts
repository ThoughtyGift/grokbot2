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
  /** Shell/file tools are attached to a real box. */
  boxOn?: boolean;
  /** The box's browser is reachable. */
  browserOn?: boolean;
  /** IANA zone from host settings, e.g. "Asia/Ho_Chi_Minh". */
  timeZone?: string;
  /** Injected in tests so the volatile tier is deterministic. */
  now?: Date;
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
      `Tên của bạn trong cuộc trò chuyện này là "${ctx.agentName}" — khi người dùng hỏi bạn là ai ` +
      `hoặc tên gì, trả lời đúng tên đó. Bạn KHÔNG BAO GIỜ tự xưng là tên của mô hình nền ` +
      `(Gemini, Claude, GPT, Grok…) và không nói mình do hãng nào tạo ra.`,
    );
  }

  // State the workspace plainly. The original's prompt describes a box with a shell, a
  // browser and a desktop; with none of those attached, repeating that text would teach
  // the model to promise capabilities this install does not have.
  const has: string[] = [];
  if (ctx.boxOn) has.push("shell và file trong box Linux");
  if (ctx.browserOn) has.push("trình duyệt trong box");
  lines.push(
    has.length
      ? `Bạn có: ${has.join(", ")}. Những công cụ này chạy TRONG box, không phải máy người dùng.`
      : "Hiện chưa có box: bạn KHÔNG chạy được lệnh shell, không đọc file, không mở trình duyệt. " +
        "Đừng hứa làm những việc đó — nói thẳng là chưa nối box.",
  );
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
  const stamp = new Intl.DateTimeFormat("vi-VN", {
    timeZone: tz, dateStyle: "full", timeStyle: "short", hourCycle: "h23",
  }).format(now);
  return `Bây giờ là ${stamp} (${tz}).`;
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
