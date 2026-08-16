/**
 * Context compaction — keep a long conversation inside the model's window.
 *
 * Without this the whole transcript is resent every turn: cost and latency grow with the
 * conversation and it eventually stops working outright. The original ships six prompts
 * for this exact job (`CLAUDE_CODE_COMPACTION_PROMPT`, `XAI_COMPACTION_SUMMARIZE_PROMPT`,
 * `SELF_SUMMARIZATION_PROMPT`, …), so it is load-bearing, not a nicety.
 *
 * Shape follows the original's: an explicit handoff summary written FOR ANOTHER ASSISTANT
 * that will not see the messages it replaces, plus the most recent turns kept verbatim
 * because recency is what a reply actually depends on.
 */
import { callPool, type PoolMessage } from "@grokbot2/pool-client";
import { config } from "./config.js";

/** Where a conversation was compacted, so the work is not redone every turn. */
export interface CompactionState {
  /** Handoff text standing in for everything up to `coveredCount`. */
  summary: string;
  /** How many transcript messages the summary covers. */
  coveredCount: number;
  /** When it was produced — surfaced in logs, not sent to the model. */
  atMs: number;
}

/**
 * Rough token estimate. Deliberately pessimistic: Vietnamese and emoji cost far more
 * tokens per character than English, and under-counting is what silently blows the window.
 */
export const estimateTokens = (text: string): number => Math.ceil(text.length / 2.8);

export const historyTokens = (h: PoolMessage[]): number =>
  h.reduce((n, m) => n + estimateTokens(m.content) + 4, 0);

/** Budget for the conversation portion of a request, in tokens. */
const BUDGET = Number(process.env.GROKBOT2_CONTEXT_BUDGET ?? 12_000);
/** Recent messages always kept word-for-word. */
const KEEP_RECENT = Number(process.env.GROKBOT2_KEEP_RECENT ?? 8);

export const needsCompaction = (h: PoolMessage[]): boolean =>
  h.length > KEEP_RECENT * 2 && historyTokens(h) > BUDGET;

/**
 * The instruction sent to the summarising model.
 *
 * Adapted from the original's compaction prompts, whose common core is: you are writing
 * for an assistant that will NOT see these messages, so preserve intent, decisions,
 * specifics and what is still outstanding — and do not call tools while doing it.
 */
function compactionRequest(previous: string | null): string {
  return [
    "Bạn đang thực hiện CONTEXT CHECKPOINT COMPACTION cho một cuộc trò chuyện.",
    "Bản tóm tắt này sẽ được đưa cho một trợ lý khác để tiếp tục công việc — trợ lý đó KHÔNG",
    "nhìn thấy các tin nhắn bị thay thế, nên mọi thứ cần thiết phải nằm trong tóm tắt.",
    "",
    "Bao gồm:",
    "- Yêu cầu và ý định của người dùng (giữ nguyên văn những câu quan trọng)",
    "- Đã làm được gì, quyết định gì, vì sao",
    "- Dữ liệu cụ thể cần nhớ: tên, số liệu, đường dẫn, mã, đường link",
    "- Sở thích và ràng buộc người dùng đã nêu",
    "- Việc còn dang dở và bước tiếp theo",
    "",
    "Viết cô đọng, có cấu trúc, cùng ngôn ngữ với cuộc trò chuyện. KHÔNG gọi công cụ.",
    ...(previous ? ["", "Tóm tắt của giai đoạn trước (gộp vào, đừng bỏ mất):", previous] : []),
  ].join("\n");
}

/**
 * Summarise everything except the last `KEEP_RECENT` messages.
 *
 * Returns null when compaction is not needed or the summary call fails — the caller then
 * sends the full history, which is worse but still correct. Losing the conversation
 * because a summary failed would be a bad trade.
 */
export async function compact(
  history: PoolMessage[],
  key: string,
  previous: CompactionState | null,
  signal?: AbortSignal,
): Promise<CompactionState | null> {
  if (!needsCompaction(history)) return null;

  const cut = history.length - KEEP_RECENT;
  const older = history.slice(0, cut);
  if (!older.length) return null;

  const transcript = older
    .map((m) => `${m.role === "user" ? "Người dùng" : "Trợ lý"}: ${m.content}`)
    .join("\n\n");

  try {
    const res = await callPool(
      [{ role: "user", content: `${compactionRequest(previous?.summary ?? null)}\n\n---\n\n${transcript}` }],
      {
        url: config.poolUrl,
        key,
        // Summarising is bulk reading, not reasoning: use the cheap fast model regardless
        // of what the conversation itself runs on.
        model: process.env.GROKBOT2_COMPACTION_MODEL ?? "gemini-2.5-flash",
        maxTokens: 1600,
        signal,
      },
    );
    const summary = (res.text ?? "").trim();
    if (!summary) return null;
    console.log(`[grokbot2] compacted ${older.length} messages (~${historyTokens(older)} tok) -> ~${estimateTokens(summary)} tok`);
    return { summary, coveredCount: cut, atMs: Date.now() };
  } catch (e) {
    console.warn("[grokbot2] compaction failed, sending full history:", (e as Error).message);
    return null;
  }
}

/**
 * Build what actually goes on the wire: the handoff, then the untouched recent messages.
 *
 * The summary is sent as a `user` turn because the pool only accepts user/assistant roles;
 * labelling it makes clear to the model that it is context, not something the user said.
 */
export function applyCompaction(history: PoolMessage[], state: CompactionState | null): PoolMessage[] {
  if (!state || state.coveredCount <= 0 || state.coveredCount >= history.length) return history;
  return [
    { role: "user", content: `[Tóm tắt phần trước của cuộc trò chuyện]\n${state.summary}` },
    ...history.slice(state.coveredCount),
  ];
}
