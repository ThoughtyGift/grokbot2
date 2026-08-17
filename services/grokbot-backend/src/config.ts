import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { BASE_SYSTEM_PROMPT } from "./prompt-base.js";

const here = dirname(fileURLToPath(import.meta.url));
const svcRoot = join(here, "..");
const repoRoot = join(svcRoot, "..", "..");

/**
 * Load the repo-root `.env` (the file `.env.example` tells you to create). Real environment
 * variables win, so `GROKBOT2_VNC_URL=… pnpm backend` still overrides the file. This is where
 * the box URL belongs — it carries a password and must not be committed in a launcher script.
 */
try {
  process.loadEnvFile(join(repoRoot, ".env"));
} catch {
  /* no .env — env vars and defaults only */
}

/**
 * Model choice drives how fast a reply feels. Measured through the pool
 * (same prompt, non-streaming): gemini-2.5-flash ~0.8s · gemini-3.7-flash ~2s ·
 * sonnet ~5.7s · haiku ~6s · grok-4.5 ~12s. Flash is the default so chat stays snappy;
 * set GROKBOT2_MODEL (or CLAUDE_MODEL) to any model the router accepts.
 */
/**
 * The original is English-only and assumes an English-speaking user; it has a "mirror the
 * user" rule for tone but none for language. Without this the ported prompt answers Vietnamese
 * messages in English.
 */
const LANGUAGE_RULE = [
  "",
  "## Language",
  "",
  "Always reply in the language the user wrote in. Match Vietnamese with Vietnamese, English",
  "with English — the tone rules above apply in whatever language you are speaking.",
].join("\n");

export const config = {
  port: Number(process.env.PORT ?? 8788),
  poolUrl: process.env.CLAUDE_POOL_URL ?? "https://admin.halcion.vn/v1/claude",
  model: process.env.GROKBOT2_MODEL ?? process.env.CLAUDE_MODEL ?? "gemini-3.7-flash",
  /**
   * Image generation. Same host, different route — the pool lists it in its own 404 text:
   * `POST /v1/claude|messages|images|videos|music|embeddings`.
   *
   * The model MUST be sent explicitly. Left out, the pool defaults to
   * `imagen-4.0-fast-generate-001` and Vertex answers 404 "not found or your project does not
   * have access". Probed across six candidates, exactly one answered 200 on this account, so
   * this default is measured rather than chosen — and overridable when the account changes.
   */
  imagesUrl: process.env.CLAUDE_IMAGES_URL
    ?? (process.env.CLAUDE_POOL_URL ?? "https://admin.halcion.vn/v1/claude").replace(/\/v1\/claude$/, "/v1/images"),
  imageModel: process.env.GROKBOT2_IMAGE_MODEL ?? "gemini-2.5-flash-image",
  /**
   * The original Grok Bot prompt, ported (src/prompt-base.ts, ~4.9k tokens). It is what makes
   * the app behave like the original — reply-first, its tone, its rules for asking a decision.
   *
   * `GROKBOT2_PROMPT=short` falls back to the small hand-written one, which is worth having:
   * the ported prompt costs ~4.9k tokens on every turn, which is most of the latency on a fast
   * model. `CLAUDE_SYSTEM` still overrides both.
   */
  system:
    process.env.CLAUDE_SYSTEM ??
    (process.env.GROKBOT2_PROMPT === "short"
      ? "Bạn là trợ lý trò chuyện thân thiện, hữu ích bên trong ứng dụng Grok Bot. " +
        "Trả lời tự nhiên, ngắn gọn bằng đúng ngôn ngữ người dùng dùng. " +
        "Bạn KHÔNG phải trợ lý lập trình mặc định — chỉ bàn về code khi được hỏi."
      : BASE_SYSTEM_PROMPT + LANGUAGE_RULE),
};

/**
 * Load the pool key from env or a gitignored file. Never logged.
 *
 * The file is edited by hand, so be forgiving: scan every line for a `hal_…` token and
 * ignore placeholder/comment lines. (Pasting the key *under* the placeholder instead of
 * replacing it is the common mistake, and it used to silently disable chat.)
 */
export function loadPoolKey(): string | null {
  // Real keys are `hal_` + 48 hex (admin-dashboard: 'hal_' + randomBytes(24).toString('hex')).
  // Match that shape so a label prefix ("API-key-x= hal_…") or the placeholder's own
  // "hal_xxx_KEY_HERE" text can't be mistaken for the key.
  const REAL = /hal_[A-Za-z0-9]{24,}/;
  const scan = (text: string): string | null => {
    const usable = text.split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.includes("PASTE_") && !l.startsWith("#") && !l.startsWith("//"));
    for (const line of usable) { const m = line.match(REAL); if (m) return m[0]; }
    // No hal_ token at all — fall back to a lone token-looking line (other pool deployments).
    return usable.find((l) => /^[A-Za-z0-9_\-.]{16,}$/.test(l)) ?? null;
  };
  if (process.env.CLAUDE_POOL_KEY) return scan(process.env.CLAUDE_POOL_KEY) ?? process.env.CLAUDE_POOL_KEY.trim();
  for (const f of ["pool-key.txt", "anthropic-key.txt"]) {
    try { const k = scan(readFileSync(join(svcRoot, f), "utf8")); if (k) return k; } catch { /* not present */ }
  }
  return null;
}
