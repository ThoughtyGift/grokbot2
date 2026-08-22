/**
 * Hợp đồng `/v1` của grokbot2 — nguồn sự thật duy nhất.
 *
 * FE nên `import type { Agent } from "@grokbot2/api-contract"` để không kéo runtime vào bundle.
 * BE import cả schema để validate ở biên.
 */
export * from "./v1.js";
