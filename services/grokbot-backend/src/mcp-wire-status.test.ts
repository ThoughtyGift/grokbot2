/**
 * The Plugins pane may only ever be sent a status the client has a case for.
 *
 * electron-main's `j7n` switch knows four: connected · needsAuth · loading · error. Its `default`
 * branch is not a neutral "unknown" — it returns `error` with "Not reported by Grok Bot's
 * computer". So sending our own honest word `disconnected` painted three healthy connectors red,
 * every restart, and read as "my plugins disappear every time I open the app".
 *
 * This guards the boundary, not the helper: it drives `listBoxMcpServers` the way the client does
 * and asserts every row came back in the client's vocabulary. A future status added to `mcp.ts`
 * that nobody translates fails here instead of in the pane.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { buildCommands } from "@grokbot2/cursor-acl";

/** The only four `j7n` has a case for — verbatim from dist/electron-main/main.cjs. */
const CLIENT_KNOWS = new Set(["connected", "needsAuth", "loading", "error"]);

/** Every status `mcpServerStatus` can return, so a new one cannot be added untranslated. */
const BACKEND_SAYS = ["connected", "initializing", "needsAuth", "error", "disconnected"] as const;

function rowsFor(status: string, detail: string) {
  const ports = {
    extensions: {
      mcpServers: () => ({ demo: { command: "npx", args: ["-y", "x"] } }),
      mcpServerStatus: () => ({ status, detail, toolCount: 0 }),
      closeMcp: () => {},
    },
  } as unknown as Parameters<typeof buildCommands>[0];
  const out = buildCommands(ports).listBoxMcpServers({ serverIdentifiers: [] }) as
    { servers: { status: string }[] };
  return out.servers;
}

test("every backend status reaches the client as one it has a case for", () => {
  for (const s of BACKEND_SAYS) {
    const [row] = rowsFor(s, "Configured; starts on first use");
    assert.ok(CLIENT_KNOWS.has(row.status), `${s} -> ${row.status} lands in j7n's default = Error`);
  }
});

test("a configured-but-not-yet-spawned server is usable, not broken", () => {
  const [row] = rowsFor("disconnected", "Configured; starts on first use");
  assert.equal(row.status, "connected");
});

test("a remote probe still in flight reads as loading, not connected", () => {
  const [row] = rowsFor("disconnected", "Checking with the server…");
  assert.equal(row.status, "loading");
});

test("a real failure is still a failure", () => {
  const [row] = rowsFor("error", "Not running");
  assert.equal(row.status, "error");
});
