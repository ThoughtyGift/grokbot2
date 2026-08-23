/**
 * Several catalog rows, one MCP server.
 *
 * Zernio covers seventeen social platforms behind a single connector. Listing it as one row means
 * nobody looking for "Instagram" finds it, so the platforms are separate rows that all install the
 * SAME server — and that is exactly where the sharp edge is: uninstalling TikTok used to delete the
 * shared server and silently disconnect Facebook with it, because uninstall removed whatever server
 * its own row named without asking whether anything else still needed it.
 *
 *   npx tsx --test src/plugin-share.test.ts
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const OWNER = "local|share-test@grok.test";
const safe = OWNER.replace(/[^a-zA-Z0-9._-]/g, "_");
const DATA = join(import.meta.dirname, "..", ".data");
const cfgFile = join(DATA, "mcp", `${safe}.json`);
const installFile = join(DATA, "plugin-installs", `${safe}.json`);
const secretFile = join(DATA, "secrets", `${safe}.json`);

let plugins: typeof import("./plugins.js");
const serversIn = (): Record<string, unknown> =>
  existsSync(cfgFile) ? (JSON.parse(readFileSync(cfgFile, "utf8")).mcpServers ?? {}) : {};

before(async () => {
  // A registry of our own, so the test does not depend on which rows ship today.
  const dir = mkdtempSync(join(tmpdir(), "gb2-share-"));
  const reg = join(dir, "registry.json");
  const shared = {
    name: "shared", description: "one connector",
    url: "http://127.0.0.1:1/mcp", headers: { Authorization: "Bearer ${SHARE_KEY}" },
  };
  writeFileSync(reg, JSON.stringify({ plugins: [
    { id: 101, name: "alpha", displayName: "Alpha", description: "", mcp: shared },
    { id: 102, name: "beta", displayName: "Beta", description: "", mcp: shared },
    { id: 103, name: "solo", displayName: "Solo", description: "",
      mcp: { name: "solo", description: "its own", command: "node", args: ["-e", ""] } },
  ] }));
  process.env.GROKBOT2_PLUGIN_REGISTRY = reg;
  for (const f of [cfgFile, installFile, secretFile]) rmSync(f, { force: true });
  plugins = await import("./plugins.js");
});

after(() => { for (const f of [cfgFile, installFile, secretFile]) rmSync(f, { force: true }); });

test("two rows that name the same server install one connection, not two", () => {
  assert.equal(plugins.installPlugin(101, OWNER, { SHARE_KEY: "k" }), true);
  assert.equal(plugins.installPlugin(102, OWNER, {}), true);
  assert.deepEqual(Object.keys(serversIn()), ["shared"]);
  assert.deepEqual(plugins.installedIds(OWNER).sort(), [101, 102]);
});

test("uninstalling one of them leaves the shared server standing for the other", () => {
  assert.equal(plugins.uninstallPlugin(101, OWNER), true);
  assert.equal("shared" in serversIn(), true, "Beta still needs it");
  assert.deepEqual(plugins.installedIds(OWNER), [102]);
});

test("uninstalling the last one finally removes it", () => {
  assert.equal(plugins.uninstallPlugin(102, OWNER), true);
  assert.equal("shared" in serversIn(), false);
  assert.deepEqual(plugins.installedIds(OWNER), []);
});

test("a row with a server of its own is still removed on its own uninstall", () => {
  plugins.installPlugin(103, OWNER, {});
  assert.equal("solo" in serversIn(), true);
  plugins.uninstallPlugin(103, OWNER);
  assert.equal("solo" in serversIn(), false);
});

test("a hand-configured server is never touched by any of this", () => {
  plugins.installPlugin(101, OWNER, {});
  const cfg = JSON.parse(readFileSync(cfgFile, "utf8"));
  cfg.mcpServers.byHand = { command: "whatever" };
  writeFileSync(cfgFile, JSON.stringify(cfg));
  plugins.uninstallPlugin(101, OWNER);
  assert.deepEqual(Object.keys(serversIn()), ["byHand"]);
});
