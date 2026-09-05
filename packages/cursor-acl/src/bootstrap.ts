/**
 * The ConnectRPC bootstrap gates — the protobuf half of the Cursor dialect.
 *
 * This and `@grokbot2/proto` are the only places protobuf is allowed to appear: the domain
 * speaks grokbot2 terms. The dialect stays on the wire forever (ADR-F0-1); keeping protobuf
 * out of the domain is so tests do not need Electron, not so this package can be deleted.
 */
import { bootstrapResponses, bootstrapJsonResponses, connectStreamEnd, connectStreamError, ConnectRpcError, CONNECT_HTTP_STATUS, type RpcCtx } from "@grokbot2/proto";
import type { ObservePort } from "./ports.js";

/** `/<package>.v1.<Service>/<Method>` — how the client addresses a bootstrap RPC. */
export const RPC_PATH = /\/([a-z0-9_.]+\.v\d+\.[A-Za-z]+)\/([A-Za-z]+)/i;

export interface RpcReply { status: number; contentType: string; body: Buffer | string }

/**
 * Answer one bootstrap RPC, or `null` if the URL is not one.
 *
 * Content type decides framing AND codec. `application/connect+json` is JSON-in-frames, not proto
 * — checking `connect+` first and stuffing proto bytes into those frames is how Marketplace
 * decoded `plugins: []` / threw (EuTQUZ) while GetMe (bare proto, tiny varints) still worked.
 */
export async function handleBootstrapRpc(
  url: string,
  contentType: string,
  observe: ObservePort,
  ctx: RpcCtx = { user: null },
): Promise<RpcReply | null> {
  const rpc = RPC_PATH.exec(url);
  if (!rpc) return null;
  const method = rpc[2];
  observe.recordRpc(method);
  const json = contentType.includes("json");
  const framed = contentType.includes("connect+") || contentType.includes("grpc");
  if (json) {
    const body = Object.hasOwn(bootstrapJsonResponses, method) ? bootstrapJsonResponses[method](ctx) : "{}";
    if (framed) {
      return { status: 200, contentType, body: connectStreamEnd(Buffer.from(body)) };
    }
    return { status: 200, contentType: "application/json", body };
  }
  const build = Object.hasOwn(bootstrapResponses, method) ? bootstrapResponses[method] : undefined;
  // One builder answers asynchronously (transcription waits for a model). Awaiting an ordinary
  // Buffer costs a microtask and keeps every other builder synchronous.
  let payload: Buffer | undefined;
  try {
    payload = build ? await build(ctx) : undefined;
  } catch (e) {
    /*
     * Lỗi có MÃ của Connect (`not_found`, `permission_denied`…) — client 0.43 phân biệt hai mã này ở
     * `getPublicTemplate`: NotFound ⇒ trả `null` (Marketplace nói "không có mẫu"), PermissionDenied ⇒
     * lỗi "access denied". Trả 200 rỗng thay cho chúng là biến cả hai thành "recipe hỏng".
     * Unary: HTTP status tương ứng + JSON `{code,message}`; đường khung: khung end-stream mang `error`.
     */
    if (!(e instanceof ConnectRpcError)) throw e;
    if (framed) return { status: 200, contentType, body: connectStreamError(e.code, e.message) };
    return { status: CONNECT_HTTP_STATUS[e.code], contentType: "application/json", body: JSON.stringify({ code: e.code, message: e.message }) };
  }
  if (framed) {
    return { status: 200, contentType, body: connectStreamEnd(payload) };
  }
  return { status: 200, contentType: "application/proto", body: payload ?? Buffer.alloc(0) };
}
