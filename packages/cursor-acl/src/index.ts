/**
 * `@grokbot2/cursor-acl` — the anti-corruption layer.
 *
 * The stock Grok Bot client speaks the Cursor dialect: `/gw/api/<command>` with 130-odd
 * command names, sixteen SSE channels, and a protobuf bootstrap. Everything that knows those
 * names lives in this package; the services behind it are called through the ports in
 * `ports.ts` and only ever see grokbot2 terms.
 *
 * This package is **permanent** (ADR-F0-1 / ROADMAP 2026-08-20). The patched stock client is
 * the production UI, so the dialect stays. `apps/grokbot-web` is fallback/debug only.
 */
import { createGatewayRouter, type GatewayRouter } from "./http.js";
import { handleBootstrapRpc, type RpcReply } from "./bootstrap.js";
import type { AclPorts } from "./ports.js";

export * from "./ports.js";
/** `buildCommands` is exported for the contract tests: enumerating the table beats grepping it. */
export { SHARED_ROOM_COMMANDS, buildCommands } from "./commands.js";
export { WIRE_CHANNELS, PUSHED_CHANNELS, NO_DATA_CHANNELS, type WireChannel } from "./sse.js";
export { RPC_PATH, type RpcReply } from "./bootstrap.js";

export interface CursorAcl {
  /** `/gw/*`. Returns true if it handled the request. */
  handleGateway: GatewayRouter["handle"];
  /** The host's `/health` body, also served at the bare `/health`. */
  hostHealth: GatewayRouter["hostHealth"];
  /** A ConnectRPC bootstrap gate, or `null` if the URL is not one. */
  handleBootstrapRpc(url: string, contentType: string): RpcReply | null;
}

export function createCursorAcl(ports: AclPorts): CursorAcl {
  const router = createGatewayRouter(ports);
  return {
    handleGateway: router.handle,
    hostHealth: router.hostHealth,
    handleBootstrapRpc: (url, contentType) => handleBootstrapRpc(url, contentType, ports.observe),
  };
}
