/**
 * Bootstrap ConnectRPC response builders (aiserver.v1.*) — the minimum set of
 * gate responses that let the Grok Bot frontend pass auth/access checks and render.
 *
 * Field numbers + enum values were extracted from the client bundle's protobuf
 * descriptors (see docs/protocol-reference.md). Gate values:
 *   SandAccessState.GRANTED = 1, SandAccessBlockReason.NONE = 1, SandTrialClaimStatus.NONE = 1.
 */
import { message, pbStr, pbVar, pbBool, pbMsg } from "./encode.js";

export const SPIKE_AUTH_ID = "auth0|grokbot2-user";

/**
 * Gate RPCs the stock app hits before the workspace (protocol-reference.md + plugins overlay).
 * `WatchSandBoxMigration` is listed by the client and has no builder here — empty proto 200.
 * F0 baseline `bootstrap.have` is how many of these have an explicit body in `bootstrapResponses`.
 */
export const BOOTSTRAP_GATE_METHODS = [
  "GetSandAccessStatus",
  "GetMe",
  "GetUserPrivacyMode",
  "GetSandUsageStatus",
  "GetSandTrialClaimStatus",
  "EnsureSandBox",
  "EnsureSandBoxWindow",
  "WatchSandBoxMigration",
  "ListMarketplacePlugins",
  "GetEffectiveUserPlugins",
] as const;

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

  // Plugins overlay. Empty proto used to decode as plugins:[] → Marketplace "isn't available".
  // These are local stubs (not Cursor.com). yPa drops a Plugin with no mcp_servers and no skills.
  ListMarketplacePlugins: () => listMarketplacePlugins(),
  GetEffectiveUserPlugins: () => getEffectiveUserPlugins(),
};

/** Connect `application/json` bodies — proto JSON names (camelCase, enums as names, int64 as string). */
export const bootstrapJsonResponses: Record<string, () => string> = {
  ListMarketplacePlugins: () => listMarketplacePluginsJson(),
  GetEffectiveUserPlugins: () => getEffectiveUserPluginsJson(),
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

/** Keep each Plugin message under 127 bytes so every length prefix is a 1-byte varint. */
const LOCAL_PLUGINS = [
  {
    id: 1,
    name: "memory",
    displayName: "Grokbot2 Memory",
    description: "Local MCP test plugin.",
    mcp: { name: "memory", description: "From .mcp.json" },
  },
  {
    id: 2,
    name: "skill",
    displayName: "Grokbot2 Skill",
    description: "Local skill test plugin.",
    skill: { name: "local-skill", description: "Yours Private row" },
  },
] as const;

function mcpDescriptor(name: string, description: string): Buffer {
  return message(pbStr(1, name), pbStr(2, description));
}

function skillDescriptor(name: string, description: string): Buffer {
  return message(pbStr(1, name), pbStr(2, description));
}

/** aiserver.v1.Plugin — only fields the overlay's yPa() reads. No large int64 timestamps. */
function plugin(p: (typeof LOCAL_PLUGINS)[number]): Buffer {
  return message(
    pbVar(1, p.id),
    pbStr(2, p.name),
    pbStr(3, p.displayName),
    pbStr(4, p.description),
    pbVar(6, 3),
    pbBool(12, true),
    pbStr(24, "https://local.test"),
    pbStr(27, "local.test"),
    "skill" in p && p.skill ? pbMsg(28, skillDescriptor(p.skill.name, p.skill.description)) : null,
    "mcp" in p && p.mcp ? pbMsg(32, mcpDescriptor(p.mcp.name, p.mcp.description)) : null,
    pbVar(41, 1),
  );
}

function pluginJson(p: (typeof LOCAL_PLUGINS)[number]): Record<string, unknown> {
  return {
    id: String(p.id),
    name: p.name,
    displayName: p.displayName,
    description: p.description,
    status: "PLUGIN_STATUS_APPROVED",
    isPublished: true,
    gitUrl: "https://local.test",
    fullRef: "local.test",
    ...("skill" in p && p.skill ? { skills: [{ name: p.skill.name, description: p.skill.description }] } : {}),
    ...("mcp" in p && p.mcp ? { mcpServers: [{ name: p.mcp.name, description: p.mcp.description }] } : {}),
    lifecycleState: "PLUGIN_LIFECYCLE_STATE_PUBLIC_LISTED",
  };
}

/** aiserver.v1.ListMarketplacePluginsResponse: plugins (1) repeated, has_more (3). */
export function listMarketplacePlugins(): Buffer {
  return message(...LOCAL_PLUGINS.map((p) => pbMsg(1, plugin(p))), pbBool(3, false));
}

export function listMarketplacePluginsJson(): string {
  return JSON.stringify({ plugins: LOCAL_PLUGINS.map(pluginJson), hasMore: false });
}

/**
 * aiserver.v1.GetEffectiveUserPluginsResponse.
 *
 * Plugin 1 is marked installed+enabled so Yours → Installed has a row to inspect. Plugin 2 stays
 * catalog-only so Marketplace still has an Add button.
 */
export function getEffectiveUserPlugins(): Buffer {
  return message(pbMsg(1, message(pbMsg(1, plugin(LOCAL_PLUGINS[0])), pbBool(4, true))));
}

export function getEffectiveUserPluginsJson(): string {
  return JSON.stringify({
    plugins: [{ plugin: pluginJson(LOCAL_PLUGINS[0]), isEnabled: true }],
  });
}
