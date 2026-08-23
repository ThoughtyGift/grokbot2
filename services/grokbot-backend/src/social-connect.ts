/**
 * Per-platform connect buttons for a connector that reaches many services through one endpoint.
 *
 * Installing the Instagram plugin left the pane with nothing to press. That was correct as far as
 * the client was concerned: the connector behind it was signed in, so there was no sign-in to
 * offer — and connecting an Instagram ACCOUNT is a thing that happens inside Zernio, which the
 * plugin pane has never heard of.
 *
 * The client can express it, though. `McpAccountInfo` gives a connector several accounts, each with
 * its own `account_key` and its own signed-in flag, and `CheckHttpMcpStatusRequest.account_key`
 * (field 8) asks for the sign-in URL of ONE of them. Send one account per platform and the pane
 * draws a row per platform; answer field 8 with the platform's connect URL and its button sends the
 * person to Instagram. No patched client, one MCP connection, the flow people expect from a
 * publishing tool.
 *
 * Everything here is best-effort and cached: `mcpServerStatus` is read on every pane refresh and is
 * synchronous, so a miss returns nothing now and starts the work that fills it in for the next read.
 */
import { callMcpTool, callUnlistedTool } from "./mcp.js";
import { catalog } from "./plugin-catalog.js";
import { installedIds } from "./plugins.js";

/** How long a platform list stays fresh. The pane polls; asking Zernio each time would be rude. */
const ACCOUNTS_TTL_MS = 30_000;
/** A connect URL is a one-shot authorize link. Long enough to survive the press, short enough to not go stale. */
const URL_TTL_MS = 5 * 60_000;

interface Cached<T> { value: T; atMs: number; }

const connected = new Map<string, Cached<Set<string>>>();
const profiles = new Map<string, Cached<string>>();
const urls = new Map<string, Cached<string>>();
const inFlight = new Set<string>();

/** Ask a tool and hand back its text, or null if anything at all went wrong. */
async function tool(server: string, name: string, args: Record<string, unknown>, owner: string): Promise<string | null> {
  try {
    // `connect_*` is answered but not advertised, so it has to go through the unlisted door.
    const out = String(name.startsWith("connect_")
      ? await callUnlistedTool(server, name, args, owner)
      : await callMcpTool(JSON.stringify({ server, tool_name: name, tool_args: args }), owner));
    return out.startsWith("MCP lỗi") ? null : out;
  } catch { return null; }
}

/**
 * The platforms this connector should show, from the plugin rows the person actually installed.
 *
 * Deliberately not "every platform the vendor supports": the pane would fill with services nobody
 * asked for. Adding Instagram from the Marketplace is the act that means "I want this one".
 */
function platformsFor(serverName: string, owner: string): string[] {
  const mine = new Set(installedIds(owner));
  return catalog()
    .filter((p) => mine.has(p.id) && p.mcp?.name === serverName && p.platform)
    .map((p) => p.platform as string);
}

/** Connected platform keys, refreshed in the background when stale. */
function connectedFor(server: string, owner: string): Set<string> {
  const k = `${owner}::${server}`;
  const hit = connected.get(k);
  if (!hit || Date.now() - hit.atMs > ACCOUNTS_TTL_MS) refresh(k, async () => {
    const out = await tool(server, "accounts_list", {}, owner);
    if (out == null) return;
    // "- facebook: Some Page (ID: 6a8b…)" — one line per connected account.
    const found = new Set([...out.matchAll(/^\s*[-*]\s*([a-z_]+)\s*:/gim)].map((m) => m[1].toLowerCase()));
    connected.set(k, { value: found, atMs: Date.now() });
  });
  return hit?.value ?? new Set();
}

/** The Zernio profile the accounts hang off. One per person here; the first one is theirs. */
function profileFor(server: string, owner: string): string | null {
  const k = `${owner}::${server}`;
  const hit = profiles.get(k);
  if (!hit) refresh(`profile:${k}`, async () => {
    const out = await tool(server, "profiles_list", {}, owner);
    const id = out && /\b([0-9a-f]{24})\b/.exec(out)?.[1];
    if (id) profiles.set(k, { value: id, atMs: Date.now() });
  });
  return hit?.value ?? null;
}

function refresh(key: string, work: () => Promise<void>): void {
  if (inFlight.has(key)) return;
  inFlight.add(key);
  void work().catch(() => { /* the next read tries again */ }).finally(() => inFlight.delete(key));
}

/**
 * The account rows for one connector, or undefined when it has no platforms — in which case the
 * caller keeps sending the single "default" row and nothing about ordinary connectors changes.
 */
export function socialAccounts(serverName: string, owner: string): { key: string; hasToken: boolean }[] | undefined {
  const platforms = platformsFor(serverName, owner);
  if (!platforms.length) return undefined;
  const live = connectedFor(serverName, owner);
  // Lower case throughout: the key is matched against the connector's own platform names and is
  // what electron-main joins on. There is no separate display name — the pane prints the key.
  const rows = platforms.map((key) => ({ key, hasToken: live.has(key) }));
  // Have the links ready before anybody presses anything. Asking only when the button is clicked
  // costs two poll cycles — profile first, then URL — and in between the button does nothing, which
  // is indistinguishable from the bug this whole thing fixes.
  for (const r of rows) if (!r.hasToken) socialConnectUrl(serverName, r.key, owner);
  return rows;
}

/**
 * Where to send somebody to connect ONE platform.
 *
 * Synchronous by necessity — the RPC that asks for it cannot wait — so a first call returns nothing
 * and warms the cache. The pane asks again on its next refresh, which is a second later, and the
 * button has its destination. `connect_get_connect_url` is not in the server's advertised tool list
 * but answers when called, which is why this does not check for it first.
 */
export function socialConnectUrl(serverName: string, platform: string, owner: string): string | undefined {
  const k = `${owner}::${serverName}::${platform}`;
  const hit = urls.get(k);
  if (hit && Date.now() - hit.atMs < URL_TTL_MS) return hit.value;

  const profileId = profileFor(serverName, owner);
  if (profileId) refresh(k, async () => {
    const out = await tool(serverName, "connect_get_connect_url", { platform, profile_id: profileId }, owner);
    const url = out && (/'authUrl':\s*'([^']+)'/.exec(out)?.[1] ?? /"authUrl":\s*"([^"]+)"/.exec(out)?.[1]);
    if (url) urls.set(k, { value: url, atMs: Date.now() });
  });
  return hit?.value;
}

/** Test seam: the caches outlive a config change otherwise. */
export function resetSocialCache(): void {
  connected.clear(); profiles.clear(); urls.clear(); inFlight.clear();
}
