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

/** Points gateway/vnc/exec at the backend itself (stub) — replace host/port for a real VPS box. */
export function ensureSandBox(base = "http://localhost:8788"): Buffer {
  return message(
    pbStr(1, "local"), // cluster
    pbStr(2, "grokbot2"), // tenant_id
    pbStr(3, "local-pod"), // pod_id
    pbStr(4, "net-token"), // network_token
    pbStr(5, "exec-token"), // exec_daemon_auth_token
    pbStr(6, `${base}/exec`), // exec_daemon_url
    pbStr(7, `${base}/vnc`), // vnc_url
    pbStr(8, ""), // terminals_folder
    pbStr(10, `${base}/gw`), // gateway_url
    pbStr(11, "gw-token"), // gateway_token
  );
}
