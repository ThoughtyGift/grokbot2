/**
 * Bootstrap ConnectRPC response builders (aiserver.v1.*) — the minimum set of
 * gate responses that let the Grok Bot frontend pass auth/access checks and render.
 *
 * Field numbers + enum values were extracted from the client bundle's protobuf
 * descriptors (see docs/protocol-reference.md). Gate values:
 *   SandAccessState.GRANTED = 1, SandAccessBlockReason.NONE = 1, SandTrialClaimStatus.NONE = 1.
 */
import { message, pbStr, pbVar, pbBool } from "./encode.js";

export const SPIKE_AUTH_ID = "auth0|grokbot2-user";

/** Map of RPC method name -> bare protobuf response body. */
export const bootstrapResponses: Record<string, () => Buffer> = {
  // DashboardService.GetSandAccessStatus -> state=GRANTED(1), block_reason=NONE(1)
  GetSandAccessStatus: () => message(pbVar(1, 1), pbVar(3, 1)),

  // DashboardService.GetMe
  GetMe: () =>
    message(
      pbStr(1, "grokbot2-user"), // auth_id
      pbVar(2, 1), // user_id
      pbStr(3, "user@localhost"), // email
      pbStr(4, "Grok"), // first_name
      pbStr(5, "Local"), // last_name
      pbBool(9, false), // is_enterprise_user
    ),

  // DashboardService.GetUserPrivacyMode -> NO_STORAGE(1), acknowledged, not enforced
  GetUserPrivacyMode: () =>
    message(pbVar(1, 1), pbVar(2, 0), pbBool(3, false), pbBool(4, false), pbBool(6, true)),

  // DashboardService.GetSandUsageStatus -> usage available
  GetSandUsageStatus: () => message(pbBool(4, false), pbBool(7, true), pbBool(8, true), pbBool(11, false)),

  // DashboardService.GetSandTrialClaimStatus -> NONE(1)
  GetSandTrialClaimStatus: () => message(pbVar(1, 1)),

  // GrokBotService.EnsureSandBox -> descriptor pointing the box gateway/vnc/exec at this backend.
  // Override these URLs in production to point at the real VPS box.
  EnsureSandBox: () => ensureSandBox(),
  EnsureSandBoxWindow: () => ensureSandBox(),
};

/**
 * Box descriptor. Field numbers and the URL shapes match a real box (see
 * docs/box-architecture.md): one pod exposing noVNC, an exec daemon and the gateway.
 *
 * `vnc_url` must be a full noVNC URL — `vnc.html` plus a `path` that reaches websockify —
 * because the app opens it as given. Point GROKBOT2_VNC_URL at a self-hosted box
 * (infra/vps/grok-box-up.sh brings one up); without it the pane stays unreachable.
 */
export function ensureSandBox(base = "http://localhost:8788"): Buffer {
  const vncUrl = process.env.GROKBOT2_VNC_URL ?? `${base}/vnc`;
  const execUrl = process.env.GROKBOT2_EXEC_URL ?? `${base}/exec`;
  const gatewayUrl = process.env.GROKBOT2_GATEWAY_URL ?? `${base}/gw`;
  return message(
    pbStr(1, process.env.GROKBOT2_CLUSTER ?? "local"), // cluster
    pbStr(2, "grokbot2"), // tenant_id
    pbStr(3, process.env.GROKBOT2_POD_ID ?? "local-pod"), // pod_id
    pbStr(4, "net-token"), // network_token
    pbStr(5, "exec-token"), // exec_daemon_auth_token
    pbStr(6, execUrl), // exec_daemon_url
    pbStr(7, vncUrl), // vnc_url
    pbStr(8, process.env.GROKBOT2_TERMINALS_FOLDER ?? "/workspace/terminals"), // terminals_folder
    pbStr(10, gatewayUrl), // gateway_url
    // The ticket the client presents on every /gw/* call. Minted per boot by the backend
    // (services/grokbot-backend/src/auth-gate.ts) — a literal here would be a credential written
    // in the source, which is no credential at all against a process that can read the repo.
    pbStr(11, process.env.GROKBOT2_GATEWAY_TOKEN ?? "gw-token"), // gateway_token
    // The viewer config wants primaryUrl + forkBaseUrl + networkToken together; leaving the
    // fork base empty makes the whole vncProxy block invalid, so default it to the same box.
    pbStr(12, process.env.GROKBOT2_FORK_VNC_URL ?? new URL(vncUrl).origin), // fork_vnc_base_url
  );
}
