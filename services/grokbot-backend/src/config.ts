import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const svcRoot = join(here, "..");

export const config = {
  port: Number(process.env.PORT ?? 8788),
  poolUrl: process.env.CLAUDE_POOL_URL ?? "https://admin.halcion.vn/v1/claude",
  model: process.env.CLAUDE_MODEL ?? "sonnet",
  system:
    process.env.CLAUDE_SYSTEM ??
    "Bạn là trợ lý trò chuyện thân thiện, hữu ích bên trong ứng dụng Grok Bot. " +
      "Trả lời tự nhiên, ngắn gọn bằng đúng ngôn ngữ người dùng dùng. " +
      "Bạn KHÔNG phải trợ lý lập trình mặc định — chỉ bàn về code khi được hỏi.",
};

/** Load the hal_xxx pool key from env or a gitignored file. Never logged. */
export function loadPoolKey(): string | null {
  if (process.env.CLAUDE_POOL_KEY) return process.env.CLAUDE_POOL_KEY.trim();
  for (const f of ["pool-key.txt", "anthropic-key.txt"]) {
    try {
      const k = readFileSync(join(svcRoot, f), "utf8").trim();
      if (k && !k.startsWith("PASTE_")) return k;
    } catch {
      /* not present */
    }
  }
  return null;
}
