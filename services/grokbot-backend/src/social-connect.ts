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
import { readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { callMcpTool, callUnlistedTool } from "./mcp.js";
import { config } from "./config.js";
import { catalog } from "./plugin-catalog.js";
import { installedIds } from "./plugins.js";

/**
 * Where a finished connect flow lands.
 *
 * Served by this backend rather than pointing back at the client's OAuth loopback on purpose: that
 * listener is waiting for an authorization `code` it issued a verifier for, and handing it somebody
 * else's callback would fail an exchange that never needed to happen. The connector's own token is
 * already in place; the pane notices the new account on its next poll. This page exists only so the
 * person is not left staring at the vendor's dashboard wondering what happened.
 */
export const CONNECT_DONE_PATH = "/connect/done";

/** Beside the other per-owner state. `GROKBOT2_DATA_DIR` is what the test runner redirects. */
const DATA_DIR = process.env.GROKBOT2_DATA_DIR ?? join(dirname(fileURLToPath(import.meta.url)), "..", ".data");

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
  const rows = platforms.map((platform) => ({ key: keyFor(serverName, platform, owner), hasToken: live.has(platform) }));
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
export function socialConnectUrl(serverName: string, key: string, owner: string): string | undefined {
  // The pane sends whatever key it was shown; the connector only knows platform names.
  const platform = platformForKey(serverName, key, owner);
  const k = `${owner}::${serverName}::${platform}`;
  const hit = urls.get(k);
  if (hit && Date.now() - hit.atMs < URL_TTL_MS) return hit.value;

  const profileId = profileFor(serverName, owner);
  if (profileId) refresh(k, async () => {
    const out = await tool(serverName, "connect_get_connect_url", {
      platform, profile_id: profileId,
      // Where the person lands when they are done. Without it the vendor picks, and it picks its own
      // dashboard: authorizing TikTok from inside the app ended on zernio.com/dashboard/connections,
      // which reads like the flow went somewhere it should not have. The value is carried inside the
      // authorize `state`, so this is the only chance to say it.
      redirect_url: `http://127.0.0.1:${config.port}${CONNECT_DONE_PATH}`,
    }, owner);
    const url = out && (/'authUrl':\s*'([^']+)'/.exec(out)?.[1] ?? /"authUrl":\s*"([^"]+)"/.exec(out)?.[1]);
    if (url) urls.set(k, { value: url, atMs: Date.now() });
  });
  return hit?.value;
}

/** Test seam: the caches outlive a config change otherwise. */
export function resetSocialCache(): void {
  connected.clear(); profiles.clear(); urls.clear(); inFlight.clear();
}

/**
 * One synthesized connector per installed platform plugin, so its own pane can offer the button.
 *
 * The pane shows an Accounts section only for the plugin that OWNS a connector — electron-main's
 * `ot()` matches `server.pluginId === plugin.id`, and a connector carries exactly one plugin id. Six
 * plugin rows sharing one Zernio endpoint meant five of them owned nothing, so adding TikTok and
 * looking for somewhere to sign in found an empty pane. Twice reported, and reasonably so: the row
 * you added is the row you expect to connect from.
 *
 * These rows exist only in the RPC answer. They are NOT written to the MCP config, so nothing here
 * opens a second connection to the same endpoint or repeats 51 tools into the model's prompt — the
 * canonical server stays the only one that does any work. `canonical` is what a tool call resolves
 * back to.
 */
export function aliasServers(
  owner: string,
  statusOf: (serverName: string) => string,
  urlOf: (serverName: string) => string | undefined,
): { name: string; url: string; status: string; hasToken: boolean; pluginId: number; accounts: { key: string; hasToken: boolean }[] }[] {
  const mine = new Set(installedIds(owner));
  const rows: ReturnType<typeof aliasServers> = [];
  for (const p of catalog()) {
    const canonical = p.mcp?.name;
    if (!p.platform || !canonical || !mine.has(p.id)) continue;
    // A platform row whose plugin IS the connector's owner needs no alias — it already has the pane.
    if (catalog().find((q) => q.mcp?.name === canonical)?.id === p.id) continue;
    const url = urlOf(canonical);
    if (!url) continue;                       // stdio connectors have no account surface at all
    const hasToken = connectedFor(canonical, owner).has(p.platform);
    if (!hasToken) socialConnectUrl(canonical, p.platform, owner);
    rows.push({
      name: p.name, url, status: statusOf(canonical), hasToken, pluginId: p.id,
      accounts: [{ key: keyFor(canonical, p.platform, owner), hasToken }],
    });
  }
  return rows;
}

/**
 * Renaming a platform account.
 *
 * The pane offers "Edit <key> account" with a Save button, and Save reverted a second later: the
 * client called `RenameMcpOAuthAccount`, we answered the empty message its contract asks for, and
 * then kept sending the old key — the optimistic rename held until the next poll and vanished. A
 * button that appears to work and then undoes itself is worse than one that is missing.
 *
 * It cannot be a display label: the pane prints the account KEY, and the key is also what the
 * connector is matched on. So a rename has to be a real alias — the key we send changes, and every
 * lookup that used to use the platform name resolves through here first.
 */
const ALIAS_DIR = join(DATA_DIR, "social-aliases");

type AliasMap = Record<string, Record<string, string>>;   // server -> platform -> alias

function aliasFile(owner: string): string {
  return join(ALIAS_DIR, `${owner.replace(/[^a-zA-Z0-9._-]/g, "_")}.json`);
}

function loadAliases(owner: string): AliasMap {
  try { return JSON.parse(readFileSync(aliasFile(owner), "utf8")) as AliasMap; } catch { return {}; }
}

function saveAliases(owner: string, map: AliasMap): void {
  mkdirSync(ALIAS_DIR, { recursive: true });
  const f = aliasFile(owner);
  // Written through a temp file: the pane reads this on every refresh, and a torn read once cost a
  // real OAuth token in this project.
  const tmp = `${f}.tmp`;
  writeFileSync(tmp, JSON.stringify(map, null, 2), { mode: 0o600 });
  renameSync(tmp, f);
}

/** The key to show for a platform — its alias if it has one. */
function keyFor(server: string, platform: string, owner: string): string {
  return loadAliases(owner)[server]?.[platform] ?? platform;
}

/** The platform behind a key, which is what the connector actually understands. */
export function platformForKey(server: string, key: string, owner: string): string {
  const forServer = loadAliases(owner)[server] ?? {};
  for (const [platform, alias] of Object.entries(forServer)) if (alias === key) return platform;
  return key;
}

/**
 * Give one platform account a new key, or drop the alias when the new key is the platform itself.
 * Returns false when the name is unusable — empty, or already taken by another account on the same
 * connector, which would make two rows collide and the status lookup ambiguous.
 */
export function renameSocialAccount(server: string, fromKey: string, toKey: string, owner: string): boolean {
  const next = toKey.trim();
  if (!next) return false;
  const platform = platformForKey(server, fromKey, owner);
  if (next === fromKey) return true;

  const map = loadAliases(owner);
  const forServer = { ...(map[server] ?? {}) };
  const taken = new Set(platformsFor(server, owner).map((p) => (p === platform ? null : keyFor(server, p, owner))).filter(Boolean));
  if (taken.has(next)) return false;

  if (next === platform) delete forServer[platform];
  else forServer[platform] = next;
  saveAliases(owner, { ...map, [server]: forServer });
  resetSocialCache();
  return true;
}

/** Forget an alias, putting the row back to the platform's own name. */
export function clearSocialAlias(server: string, key: string, owner: string): void {
  const map = loadAliases(owner);
  const platform = platformForKey(server, key, owner);
  if (map[server]?.[platform] == null) return;
  const forServer = { ...map[server] };
  delete forServer[platform];
  saveAliases(owner, { ...map, [server]: forServer });
  resetSocialCache();
}
