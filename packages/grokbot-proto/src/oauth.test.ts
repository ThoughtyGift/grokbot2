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
import { bootstrapResponses } from "./bootstrap.js";
import { message, pbStr, pbVar, pbMsg } from "./encode.js";
import { readString, readVarint, readMessages } from "./decode.js";
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
