/**
 * The synthesized per-platform connectors — see social-connect.ts `aliasServers`.
 *
 * Reported twice from the app, in the same words both times: you add the TikTok plugin, open it, and
 * there is nowhere to sign in. The pane draws its Accounts section only for the plugin that OWNS a
 * connector, and six rows sharing one endpoint left five owning nothing. These rows give each of
 * them one to own, and they must stay confined to the RPC answer: the moment one reaches the MCP
 * config it becomes a second connection to the same endpoint and a second copy of 51 tools in the
 * model's prompt.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const OWNER = "auth0|alias-test";
const DATA = process.env.GROKBOT2_DATA_DIR ?? join(import.meta.dirname, "..", ".data");
// Same mangling the modules use, so the test looks where they actually write.
const safe = OWNER.replace(/[^a-zA-Z0-9._-]/g, "_");
const cfgFile = join(DATA, "mcp", `${safe}.json`);
const installFile = join(DATA, "plugin-installs", `${safe}.json`);

let plugins: typeof import("./plugins.js");
let social: typeof import("./social-connect.js");

/** The connector every platform row here shares, as the real Zernio rows do. */
const HUB = { name: "hub", description: "one endpoint, many services", url: "http://127.0.0.1:1/mcp" };
const statusOf = () => "connected";
const urlOf = (n: string) => (n === "hub" ? HUB.url : undefined);

before(async () => {
  const dir = mkdtempSync(join(tmpdir(), "gb2-alias-"));
  const reg = join(dir, "registry.json");
  writeFileSync(reg, JSON.stringify({ plugins: [
    { id: 201, name: "hub", displayName: "Hub (all platforms)", description: "", mcp: HUB },
    { id: 202, name: "hub-facebook", displayName: "Facebook", description: "", platform: "facebook", mcp: HUB },
    { id: 203, name: "hub-tiktok", displayName: "TikTok", description: "", platform: "tiktok", mcp: HUB },
    { id: 204, name: "plain", displayName: "Plain", description: "",
      mcp: { name: "plain", description: "stdio", command: "node", args: ["-e", ""] } },
  ] }));
  process.env.GROKBOT2_PLUGIN_REGISTRY = reg;
  for (const f of [cfgFile, installFile]) rmSync(f, { force: true });
  plugins = await import("./plugins.js");
  social = await import("./social-connect.js");
});

after(() => { for (const f of [cfgFile, installFile]) rmSync(f, { force: true }); });

test("nothing installed, nothing synthesized — the answer is unchanged for everyone else", () => {
  assert.deepEqual(social.aliasServers(OWNER, statusOf, urlOf), []);
});

test("installing a platform row gives that plugin a connector of its own to own", () => {
  assert.equal(plugins.installPlugin(203, OWNER), true);
  social.resetSocialCache();
  const rows = social.aliasServers(OWNER, statusOf, urlOf);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, "hub-tiktok");
  assert.equal(rows[0].pluginId, 203, "the pane matches server.pluginId against the plugin's own id");
  assert.equal(rows[0].url, HUB.url, "same endpoint — this is a handle, not a second server");
  assert.deepEqual(rows[0].accounts, [{ key: "tiktok", hasToken: false }], "one account: its own platform");
});

test("the row that already owns the connector gets no duplicate", () => {
  assert.equal(plugins.installPlugin(201, OWNER), true);
  social.resetSocialCache();
  const names = social.aliasServers(OWNER, statusOf, urlOf).map((r) => r.name);
  assert.ok(!names.includes("hub"), "plugin 201 owns `hub` already and needs no alias");
});

test("a plugin with no platform is not given one", () => {
  assert.equal(plugins.installPlugin(204, OWNER), true);
  social.resetSocialCache();
  const names = social.aliasServers(OWNER, statusOf, urlOf).map((r) => r.name);
  assert.ok(!names.includes("plain"));
});

/**
 * The cost this whole design exists to avoid. If an alias ever reaches the config, the backend opens
 * a second session to the same endpoint and the model is handed the same tools twice.
 */
test("no alias is ever written to the MCP config", () => {
  assert.equal(plugins.installPlugin(202, OWNER), true);
  const servers = existsSync(cfgFile) ? Object.keys(JSON.parse(readFileSync(cfgFile, "utf8")).mcpServers ?? {}) : [];
  assert.deepEqual(servers.sort(), ["hub", "plain"], "one entry per real connector, aliases nowhere near it");
});

test("a stdio connector has no account surface, so it is never aliased", () => {
  social.resetSocialCache();
  const rows = social.aliasServers(OWNER, statusOf, () => undefined);
  assert.deepEqual(rows, [], "no url means the pane cannot offer a sign-in at all");
});

/**
 * Renaming an account row. The pane's Save button called the RPC, we acked it, and the row reverted
 * on the next poll — the rename has to be a real alias because the pane prints the KEY, and the key
 * is also what the connector is matched on.
 */
test("a renamed platform account keeps its new key, and still resolves to the platform", () => {
  assert.equal(social.renameSocialAccount("hub", "tiktok", "kenh-chinh", OWNER), true);
  const rows = social.aliasServers(OWNER, statusOf, urlOf);
  const tiktok = rows.find((r) => r.pluginId === 203);
  assert.deepEqual(tiktok?.accounts, [{ key: "kenh-chinh", hasToken: false }], "the pane sees the new key");
  assert.equal(social.platformForKey("hub", "kenh-chinh", OWNER), "tiktok", "the connector still sees tiktok");
});

test("an empty name is refused rather than stored", () => {
  assert.equal(social.renameSocialAccount("hub", "kenh-chinh", "   ", OWNER), false);
  assert.equal(social.platformForKey("hub", "kenh-chinh", OWNER), "tiktok", "unchanged");
});

test("a name already used by another account on the same connector is refused", () => {
  // 202 (facebook) is installed by the earlier test, so `facebook` is taken.
  assert.equal(social.renameSocialAccount("hub", "kenh-chinh", "facebook", OWNER), false,
    "two rows with the same key would make the status lookup ambiguous");
});

test("renaming back to the platform name drops the alias instead of storing a no-op", () => {
  assert.equal(social.renameSocialAccount("hub", "kenh-chinh", "tiktok", OWNER), true);
  assert.equal(social.platformForKey("hub", "tiktok", OWNER), "tiktok");
  const rows = social.aliasServers(OWNER, statusOf, urlOf);
  assert.deepEqual(rows.find((r) => r.pluginId === 203)?.accounts, [{ key: "tiktok", hasToken: false }]);
});

test("Remove clears the alias and leaves the account itself alone", () => {
  assert.equal(social.renameSocialAccount("hub", "tiktok", "tam-thoi", OWNER), true);
  social.clearSocialAlias("hub", "tam-thoi", OWNER);
  assert.equal(social.platformForKey("hub", "tiktok", OWNER), "tiktok");
  assert.deepEqual(
    social.aliasServers(OWNER, statusOf, urlOf).find((r) => r.pluginId === 203)?.accounts,
    [{ key: "tiktok", hasToken: false }],
  );
});

test("an unknown key resolves to itself — no alias is invented", () => {
  assert.equal(social.platformForKey("hub", "never-seen", OWNER), "never-seen");
});
