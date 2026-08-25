/**
 * Thứ mà `mcp.ts` và hai file vận chuyển đều cần — không hơn.
 *
 * File này tồn tại để **cắt vòng import**: `mcp.ts` gọi transport, transport cần hằng và kiểu của
 * `mcp.ts`. Đặt phần chung ra một chỗ thì cả hai cùng nhìn xuống, không ai nhìn vòng lại.
 */

/**
 * Phiên bản giao thức gửi trong `initialize`.
 *
 * Streamable HTTP chỉ tồn tại từ 2025-03-26 trở đi, nên bản 2024-11-05 cũ sẽ khiến một server ở xa
 * rơi về transport SSE hai-đầu-mối. Đã đo trên stdio: handshake xong với cả 2024-11-05, 2025-06-18
 * lẫn 2026-07-28 — nên nâng lên không mất gì ở đó, mà ở đây thì bắt buộc.
 */
export const MCP_PROTOCOL_VERSION = "2025-06-18";

/** Một server không chịu trả lời thì không được treo cả lượt chat phía sau nó. */
export const START_TIMEOUT_MS = 60_000;
export const CALL_TIMEOUT_MS = 60_000;

/**
 * Một đường nói chuyện với MCP server — ống của tiến trình con, hoặc HTTP.
 *
 * `send` là bắn-rồi-quên: câu trả lời tới sau qua `deliver`, đúng như hồi transport duy nhất là cái
 * ống. Chính điều đó giữ cho `rpc()` không phải biết mình đang đi đường nào.
 */
export interface Transport {
  kind: "stdio" | "http";
  send(msg: unknown): void;
  close(): void;
  /** `null` khi còn dùng được; một câu người đọc hiểu được khi không còn. */
  dead(): string | null;
}
