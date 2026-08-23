/**
 * The MCP OAuth RPCs on the wire.
 *
 * Every failure in this family is silent by construction: the app drives the OAuth itself and only
 * asks the backend to remember things, so a mis-decoded request stores a credential under the wrong
 * key and a mis-encoded reply makes the app believe a sign-in that never persisted. Before these
 * were handled at all, an unhandled RPC answered 200 with an empty body — which reads as
 * applied:false and "not signed in", forever, with nothing in any log.
 *
 * So these go through the real encoders and decoders, in the order the client drives them, against
 * a port kept in memory. The STORAGE rules (single-use verifiers, newer-wins, per-owner isolation)
 * belong to the backend and are tested there — this file is only about what crosses the wire.
 *
 *   npx tsx --test src/oauth.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { bootstrapResponses, availableMcpServers } from "./bootstrap.js";
import { message, pbStr, pbVar, pbMsg } from "./encode.js";
import { readString, readStrings, readVarint, readMessages } from "./decode.js";
import type { OAuthPort, PendingState, StoredToken } from "./oauth.js";

const SERVER = "https://mcp.example.test/mcp";
const ACCOUNT = "default";

/** The smallest port that behaves: enough to tell a right answer from a plausible one. */
function fakePort() {
  const pending = new Map<string, PendingState>();
  const tokens = new Map<string, { serverUrl: string; accountKey: string; updatedAtMs: number; data: StoredToken }>();
  let n = 0;
  const port: OAuthPort = {
    storePending(s) { const id = `state-${++n}`; pending.set(id, s); return id; },
    getPending(id) { return pending.get(id) ?? null; },
    complete(id) {
      const p = pending.get(id);
      if (!p) return null;
      pending.delete(id);
      return { postAuthReturnUrl: p.postAuthReturnUrl ?? "", accountKey: p.accountKey };
    },
    storeToken(serverUrl, accountKey, data, at) {
      const updatedAtMs = at ?? 1;
      tokens.set(`${serverUrl} ${accountKey}`, { serverUrl, accountKey, updatedAtMs, data });
      return { updatedAtMs, applied: true, skipped: false };
    },
    getTokens(urls, accountKey) {
      return [...tokens.values()].filter((r) => urls.includes(r.serverUrl) && (!accountKey || r.accountKey === accountKey));
    },
    validate(targets) {
      return targets.map((t) => ({ ...t, hasValidToken: [...tokens.values()].some((r) => r.serverUrl === t.serverUrl) }));
    },
    deleteToken(serverUrl, accountKey) { tokens.delete(`${serverUrl} ${accountKey}`); },
  };
  return { port, tokens, pending };
}

const call = (method: string, body: Buffer, oauth: OAuthPort): Buffer =>
  bootstrapResponses[method]({ user: null, body, oauth } as never);

// ── the browser round trip ────────────────────────────────────────────────────

test("StoreMcpOAuthPendingState reads every field the client sends and answers a state id", () => {
  const { port, pending } = fakePort();
  const req = message(
    pbStr(1, SERVER), pbStr(2, "verifier-abc"), pbStr(3, "client-1"), pbStr(4, "secret-1"),
    pbStr(5, "http://127.0.0.1:51000/cb"), pbStr(6, "svc-1"), pbStr(7, ACCOUNT),
  );
  assert.equal(readString(call("StoreMcpOAuthPendingState", req, port), 1), "state-1");
  assert.deepEqual(pending.get("state-1"), {
    serverUrl: SERVER, codeVerifier: "verifier-abc", clientId: "client-1", clientSecret: "secret-1",
    redirectUri: "http://127.0.0.1:51000/cb", serviceAccountId: "svc-1", accountKey: ACCOUNT,
  });
});

test("GetMcpOAuthPendingState puts each value back on the field number it came from", () => {
  const { port } = fakePort();
  call("StoreMcpOAuthPendingState", message(pbStr(1, SERVER), pbStr(2, "v"), pbStr(3, "c"), pbStr(7, ACCOUNT)), port);
  const r = call("GetMcpOAuthPendingState", message(pbStr(1, "state-1")), port);
  assert.equal(readString(r, 1), SERVER);
  assert.equal(readString(r, 2), "v");
  assert.equal(readString(r, 3), "c");
  assert.equal(readString(r, 8), ACCOUNT);
});

test("an unknown state id answers empty, not a plausible-looking state", () => {
  const { port } = fakePort();
  assert.equal(call("GetMcpOAuthPendingState", message(pbStr(1, "nope")), port).length, 0);
});

test("CompleteMcpOAuth returns the account and consumes the pending state", () => {
  const { port, pending } = fakePort();
  call("StoreMcpOAuthPendingState", message(pbStr(1, SERVER), pbStr(2, "v"), pbStr(7, ACCOUNT)), port);
  const r = call("CompleteMcpOAuth", message(pbStr(1, "state-1"), pbStr(2, "code-1")), port);
  assert.equal(readString(r, 2), ACCOUNT);
  assert.equal(pending.size, 0);
});

// ── tokens ────────────────────────────────────────────────────────────────────

test("StoreMcpOAuthToken decodes all ten fields and reports applied", () => {
  const { port, tokens } = fakePort();
  const req = message(
    pbStr(1, SERVER), pbStr(2, "refresh-1"), pbStr(3, "client-1"), pbStr(4, "secret-1"),
    pbStr(5, "http://127.0.0.1:51000/cb"), pbStr(6, "access-1"), pbStr(7, "svc"),
    pbVar(8, 1_000), pbStr(9, "ide"), pbStr(10, ACCOUNT),
  );
  const r = call("StoreMcpOAuthToken", req, port);
  assert.equal(readVarint(r, 1), 1_000, "updated_at_ms echoes the client's clock");
  assert.equal(readVarint(r, 2), 1, "applied — an empty reply would read as a failed store");
  assert.equal(readVarint(r, 3), 0, "not skipped");
  assert.deepEqual(tokens.get(`${SERVER} ${ACCOUNT}`)?.data, {
    refreshToken: "refresh-1", clientId: "client-1", clientSecret: "secret-1",
    redirectUris: ["http://127.0.0.1:51000/cb"], accessToken: "access-1",
  });
});

test("GetMcpOAuthTokens nests the token data where the client reads it", () => {
  const { port } = fakePort();
  call("StoreMcpOAuthToken", message(pbStr(1, SERVER), pbStr(3, "c"), pbStr(6, "access-1"), pbStr(10, ACCOUNT)), port);
  const entries = readMessages(call("GetMcpOAuthTokens", message(pbStr(1, SERVER), pbStr(3, ACCOUNT)), port), 1);
  assert.equal(entries.length, 1);
  assert.equal(readString(entries[0], 1), SERVER);
  assert.equal(readString(entries[0], 4), ACCOUNT);
  const data = readMessages(entries[0], 2)[0];
  assert.equal(readString(data, 2), "c");
  assert.equal(readString(data, 5), "access-1");
});

test("ValidateMcpOAuthTokens reads BOTH spellings — targets and bare server_urls", () => {
  const { port } = fakePort();
  call("StoreMcpOAuthToken", message(pbStr(1, SERVER), pbStr(3, "c"), pbStr(6, "a"), pbStr(10, ACCOUNT)), port);

  const byTarget = readMessages(call("ValidateMcpOAuthTokens",
    message(pbMsg(3, message(pbStr(1, SERVER), pbStr(2, ACCOUNT)))), port), 1);
  assert.equal(readVarint(byTarget[0], 2), 1);

  const byUrl = readMessages(call("ValidateMcpOAuthTokens", message(pbStr(1, SERVER)), port), 1);
  assert.equal(readVarint(byUrl[0], 2), 1, "reading only one spelling would report 'not signed in'");

  const unknown = readMessages(call("ValidateMcpOAuthTokens", message(pbStr(1, "https://other.test/mcp")), port), 1);
  assert.equal(readVarint(unknown[0], 2), 0);
});

test("a url named in both spellings is answered once, not twice", () => {
  const { port } = fakePort();
  const req = message(pbStr(1, SERVER), pbMsg(3, message(pbStr(1, SERVER), pbStr(2, ACCOUNT))));
  assert.equal(readMessages(call("ValidateMcpOAuthTokens", req, port), 1).length, 1);
});

test("DeleteMcpOAuthToken removes it and answers the empty response it declares", () => {
  const { port, tokens } = fakePort();
  call("StoreMcpOAuthToken", message(pbStr(1, SERVER), pbStr(3, "c"), pbStr(6, "a"), pbStr(10, ACCOUNT)), port);
  assert.equal(call("DeleteMcpOAuthToken", message(pbStr(1, SERVER), pbStr(4, ACCOUNT)), port).length, 0);
  assert.equal(tokens.size, 0);
});

test("the refresh lease is granted, with nothing to enforce on a single install", () => {
  const { port } = fakePort();
  const r = call("McpOAuthRefreshLockBegin", message(pbStr(1, SERVER), pbStr(3, "exec-1")), port);
  assert.equal(readVarint(r, 1), 2, "WOULD_ACQUIRE");
  assert.equal(readString(r, 2), "lease:exec-1");
  assert.equal(readVarint(r, 3), 0, "should_enforce false — no shared lock exists here");
});

test("with no port at all they answer empty, exactly as before they were handled", () => {
  for (const m of ["StoreMcpOAuthPendingState", "GetMcpOAuthPendingState", "CompleteMcpOAuth",
    "StoreMcpOAuthToken", "GetMcpOAuthTokens", "ValidateMcpOAuthTokens"]) {
    const r = bootstrapResponses[m]({ user: null, body: message(pbStr(1, SERVER)) } as never);
    assert.equal(r.length, 0, `${m} must not invent an answer without a store`);
  }
});

// ── CheckHttpMcpStatus: what the pane reads to decide "Authenticate" or "Error" ──

test("CheckHttpMcpStatus turns a needsAuth server into requires_auth, not an error", () => {
  const ctx = {
    user: null,
    body: message(pbVar(1, 1), pbVar(1, 2)),
    mcpServers: [
      { name: "remote", url: SERVER, status: "needsAuth", hasToken: false },
      { name: "local", command: "node", status: "connected" },
    ],
  };
  const rows = readMessages(bootstrapResponses.CheckHttpMcpStatus(ctx as never), 1);
  assert.equal(rows.length, 1, "a stdio row is not this RPC's business");
  assert.equal(readVarint(rows[0], 1), 1, "id");
  assert.equal(readVarint(rows[0], 2), 1, "is_available — waiting on auth is not broken");
  assert.equal(readVarint(rows[0], 3), 1, "requires_auth — this is what renders Authenticate");
  assert.equal(readVarint(rows[0], 6), 0, "has_valid_token");
});

test("a signed-in server reports a valid token and stops asking", () => {
  const ctx = { user: null, body: message(pbVar(1, 1)), mcpServers: [{ name: "r", url: SERVER, status: "connected", hasToken: true }] };
  const rows = readMessages(bootstrapResponses.CheckHttpMcpStatus(ctx as never), 1);
  assert.equal(readVarint(rows[0], 3), 0, "requires_auth false");
  assert.equal(readVarint(rows[0], 6), 1, "has_valid_token true");
});

test("no auth_url is invented — the client builds it with its own PKCE verifier", () => {
  const ctx = { user: null, body: message(pbVar(1, 1)), mcpServers: [{ name: "r", url: SERVER, status: "needsAuth" }] };
  assert.equal(readString(readMessages(bootstrapResponses.CheckHttpMcpStatus(ctx as never), 1)[0], 4), "");
});

test("an empty request asks about every configured server", () => {
  const ctx = { user: null, body: message(), mcpServers: [{ name: "a", url: SERVER, status: "needsAuth" }, { name: "b", url: "https://x.test/mcp", status: "connected" }] };
  assert.equal(readMessages(bootstrapResponses.CheckHttpMcpStatus(ctx as never), 1).length, 2);
});

// ── GetAvailableMcpServers: where the pane actually reads "signed in" ─────────

test("a remote server with a stored sign-in reports user_has_access_token", () => {
  const r = bootstrapResponses.GetAvailableMcpServers({
    user: null,
    mcpServers: [{ name: "zernio", url: SERVER, hasToken: true, pluginId: 20 }],
  } as never);
  const row = readMessages(r, 1)[0];
  assert.equal(readString(row, 2), "zernio");
  assert.equal(readVarint(row, 9), 20, "plugin_id ties the connector to its plugin row");
  assert.equal(readVarint(row, 11), 1, "user_has_access_token — the field the pane reads");
  const acct = readMessages(row, 17)[0];
  assert.equal(readString(acct, 1), "default");
  assert.equal(readVarint(acct, 3), 1, "per-account hasToken");
});

test("without a sign-in it reports false, rather than leaving the field out", () => {
  const r = bootstrapResponses.GetAvailableMcpServers({
    user: null, mcpServers: [{ name: "zernio", url: SERVER, hasToken: false }],
  } as never);
  const row = readMessages(r, 1)[0];
  assert.equal(readVarint(row, 11), 0);
  assert.equal(readVarint(readMessages(row, 17)[0], 3), 0);
});

test("a stdio server still comes through unchanged", () => {
  const r = bootstrapResponses.GetAvailableMcpServers({
    user: null, mcpServers: [{ name: "memory", command: "npx", args: ["-y", "pkg"] }],
  } as never);
  const row = readMessages(r, 1)[0];
  assert.equal(readString(row, 5), "stdio");
  assert.equal(readString(row, 6), "npx");
  assert.deepEqual(readStrings(row, 7), ["-y", "pkg"]);
});

// ── Per-platform accounts: one connector, a button for each service behind it ────

test("a connector with platforms sends one account row each, not a single default", () => {
  const r = availableMcpServers([{
    name: "zernio", url: SERVER, hasToken: true,
    accounts: [{ key: "facebook", hasToken: true }, { key: "instagram", hasToken: false }],
  }]);
  const accounts = readMessages(readMessages(r, 1)[0], 17);
  assert.deepEqual(accounts.map((a) => readString(a, 1)), ["facebook", "instagram"]);
  assert.deepEqual(accounts.map((a) => readVarint(a, 3)), [1, 0], "signed-in flag is per account");
  assert.equal(readString(accounts[1], 2), "zernio--instagram", "server_identifier stays unique per row");
});

test("a connector with no platforms is unchanged — still the one default account", () => {
  const accounts = readMessages(readMessages(availableMcpServers([{ name: "memory", hasToken: false }]), 1)[0], 17);
  assert.equal(accounts.length, 1);
  assert.equal(readString(accounts[0], 1), "default");
});

/**
 * The reported bug, at the wire: Instagram was installed, the connector was signed in, and the pane
 * offered nothing to press. Asking about that ONE account has to say it still wants a sign-in even
 * though the connector as a whole is fine.
 */
test("account_key asks about one platform, and an unconnected one still requires auth", () => {
  const asked: string[] = [];
  const ctx = {
    user: null,
    body: message(pbVar(1, 1), pbStr(2, "http://127.0.0.1:1/cb"), pbStr(8, "instagram")),
    mcpServers: [{
      name: "zernio", url: SERVER, status: "connected", hasToken: true,
      accounts: [{ key: "facebook", hasToken: true }, { key: "instagram", hasToken: false }],
    }],
    authUrlFor: (_u: string, _r: string, key?: string) => { asked.push(key ?? ""); return "https://instagram.test/authorize"; },
  };
  const rows = readMessages(bootstrapResponses.CheckHttpMcpStatus(ctx as never), 1);
  assert.equal(readVarint(rows[0], 3), 1, "requires_auth — this is the button that was missing");
  assert.equal(readVarint(rows[0], 6), 0, "has_valid_token false for THIS account");
  assert.equal(readString(rows[0], 4), "https://instagram.test/authorize", "and it has somewhere to go");
  assert.deepEqual(asked, ["instagram"], "the platform is passed through, not dropped");
});

test("the same connector answers 'already connected' for the platform that is", () => {
  const ctx = {
    user: null,
    body: message(pbVar(1, 1), pbStr(2, "http://127.0.0.1:1/cb"), pbStr(8, "facebook")),
    mcpServers: [{
      name: "zernio", url: SERVER, status: "connected", hasToken: true,
      accounts: [{ key: "facebook", hasToken: true }, { key: "instagram", hasToken: false }],
    }],
    authUrlFor: () => "https://should-not-be-asked.test",
  };
  const rows = readMessages(bootstrapResponses.CheckHttpMcpStatus(ctx as never), 1);
  assert.equal(readVarint(rows[0], 3), 0, "requires_auth false");
  assert.equal(readString(rows[0], 4), "", "no sign-in is offered for an account that has one");
});

test("without account_key the connector answers for itself, as it always did", () => {
  const ctx = {
    user: null,
    body: message(pbVar(1, 1), pbStr(2, "http://127.0.0.1:1/cb")),
    mcpServers: [{
      name: "zernio", url: SERVER, status: "needsAuth", hasToken: false,
      accounts: [{ key: "instagram", hasToken: false }],
    }],
    authUrlFor: (_u: string, _r: string, key?: string) => (key === undefined ? "https://zernio.test/signin" : "wrong"),
  };
  const rows = readMessages(bootstrapResponses.CheckHttpMcpStatus(ctx as never), 1);
  assert.equal(readString(rows[0], 4), "https://zernio.test/signin");
});

// ── ListSandMcpTools: the status drawn beside each account row ───────────────────

const listTools = (body: Buffer, servers: unknown[]) =>
  readMessages(bootstrapResponses.ListSandMcpTools({ user: null, body, mcpServers: servers } as never), 1);

/** The client asks by connector name; the per-account split has to come back in the ANSWER. */
test("one request for the connector answers one row per account", () => {
  const rows = listTools(
    message(pbStr(1, "zernio")),
    [{
      name: "zernio", url: SERVER, status: "connected",
      accounts: [{ key: "facebook", hasToken: true }, { key: "instagram", hasToken: false }],
    }],
  );
  assert.equal(rows.length, 2);
  assert.equal(readString(rows[0], 2), "connected", "a signed-in account inherits the connector's health");
  assert.equal(readString(rows[0], 4), "facebook", "account_label is the JOIN KEY, not a display name");
  assert.equal(readString(rows[1], 2), "needsAuth", "an account with no sign-in wants one, however healthy the server is");
  
  assert.deepEqual(rows.map((r) => readString(r, 5)), ["zernio", "zernio"], "row_server_identifier groups them");
  assert.deepEqual(rows.map((r) => readString(r, 1)), ["zernio--facebook", "zernio--instagram"]);
});

test("asking for one account narrows the answer to it", () => {
  const rows = listTools(message(pbStr(1, "zernio--instagram")), [{
    name: "zernio", status: "connected",
    accounts: [{ key: "facebook", hasToken: true }, { key: "instagram", hasToken: false }],
  }]);
  assert.equal(rows.length, 1);
  assert.equal(readString(rows[0], 1), "zernio--instagram");
});

test("an identifier with no account is the connector itself", () => {
  const rows = listTools(message(pbStr(1, "memory")), [{ name: "memory", status: "connected" }]);
  assert.equal(readString(rows[0], 1), "memory");
  assert.equal(readString(rows[0], 2), "connected");
  assert.equal(readString(rows[0], 4), "", "no account label for a plain connector");
});

test("an unknown server is skipped, not answered with a guess", () => {
  assert.equal(listTools(message(pbStr(1, "gone--facebook")), [{ name: "zernio" }]).length, 0);
});

test("a server name containing a colon still resolves", () => {
  const rows = listTools(
    message(pbStr(1, "host:8080--facebook")),
    [{ name: "host:8080", status: "connected", accounts: [{ key: "facebook", hasToken: true }] }],
  );
  assert.equal(readString(rows[0], 5), "host:8080");
  assert.equal(readString(rows[0], 4), "facebook");
});
