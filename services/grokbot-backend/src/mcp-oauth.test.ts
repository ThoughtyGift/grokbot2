/**
 * Where a sign-in is kept — the storage rules, not the wire.
 *
 * The wire half lives in `@grokbot2/proto` (src/oauth.test.ts) because no service module may import
 * protobuf. What is left here is the part that decides whether a credential survives correctly:
 * single-use verifiers, newer-wins on a token, and one owner never seeing another's.
 *
 *   npx tsx --test src/mcp-oauth.test.ts
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { oauthPortFor, oauthAccessToken, clearOAuth, hasAnyOAuth } from "./mcp-oauth.js";

const A = "local|oauth-a@grok.test";
const B = "local|oauth-b@grok.test";
const SERVER = "https://mcp.example.test/mcp";
const ACCOUNT = "default";

const wipe = () => { clearOAuth(A); clearOAuth(B); };
before(wipe);
after(wipe);

test("a pending state comes back exactly as it went in", () => {
  const p = oauthPortFor(A);
  const id = p.storePending({ serverUrl: SERVER, codeVerifier: "v1", clientId: "c1", accountKey: ACCOUNT });
  assert.match(id, /^[0-9a-f]{48}$/, "unguessable: the browser callback is addressed by this alone");
  assert.deepEqual(p.getPending(id), { serverUrl: SERVER, codeVerifier: "v1", clientId: "c1", accountKey: ACCOUNT });
});

test("completing consumes the verifier, so one authorization code cannot be replayed", () => {
  const p = oauthPortFor(A);
  const id = p.storePending({ serverUrl: SERVER, codeVerifier: "v2", accountKey: ACCOUNT });
  assert.deepEqual(p.complete(id, "code"), { postAuthReturnUrl: "", accountKey: ACCOUNT });
  assert.equal(p.getPending(id), null);
  assert.equal(p.complete(id, "code"), null, "a second completion has nothing to complete");
});

test("an unknown state id is null rather than a fabricated state", () => {
  assert.equal(oauthPortFor(A).getPending("0".repeat(48)), null);
});

// ── tokens ────────────────────────────────────────────────────────────────────

test("a stored access token is what mcp.ts will send", () => {
  oauthPortFor(A).storeToken(SERVER, ACCOUNT, { clientId: "c", accessToken: "tok-1" }, 1_000);
  assert.equal(oauthAccessToken(SERVER, A), "tok-1");
});

test("an older write does NOT overwrite a newer token, and says why", () => {
  const p = oauthPortFor(A);
  const r = p.storeToken(SERVER, ACCOUNT, { clientId: "c", accessToken: "tok-OLD" }, 500);
  assert.deepEqual({ applied: r.applied, skipped: r.skipped }, { applied: false, skipped: true });
  assert.equal(oauthAccessToken(SERVER, A), "tok-1", "the newer token survived a stale client");
});

test("a newer write does replace it", () => {
  oauthPortFor(A).storeToken(SERVER, ACCOUNT, { clientId: "c", accessToken: "tok-2" }, 2_000);
  assert.equal(oauthAccessToken(SERVER, A), "tok-2");
});

test("validate reports per target, and false for a server nobody signed into", () => {
  assert.deepEqual(
    oauthPortFor(A).validate([
      { serverUrl: SERVER, accountKey: ACCOUNT },
      { serverUrl: "https://other.test/mcp", accountKey: ACCOUNT },
    ]).map((r) => r.hasValidToken),
    [true, false],
  );
});

test("a token with no access_token does not count as signed in", () => {
  const p = oauthPortFor(B);
  p.storeToken("https://refresh-only.test/mcp", ACCOUNT, { clientId: "c", refreshToken: "r" }, 1);
  assert.equal(p.validate([{ serverUrl: "https://refresh-only.test/mcp", accountKey: ACCOUNT }])[0].hasValidToken, false);
  assert.equal(oauthAccessToken("https://refresh-only.test/mcp", B), null);
});

test("signing out removes it", () => {
  oauthPortFor(A).deleteToken(SERVER, ACCOUNT);
  assert.equal(oauthAccessToken(SERVER, A), null);
  assert.deepEqual(oauthPortFor(A).getTokens([SERVER], ACCOUNT), []);
});

// ── isolation ─────────────────────────────────────────────────────────────────

test("one owner's sign-in is invisible to another", () => {
  oauthPortFor(A).storeToken(SERVER, ACCOUNT, { clientId: "c", accessToken: "mine" }, 1);
  assert.equal(oauthAccessToken(SERVER, A), "mine");
  assert.equal(oauthAccessToken(SERVER, B), null, "credentials are per tenant, like the MCP config");
  assert.equal(hasAnyOAuth(A), true);
});

test("two accounts on the SAME server are kept apart", () => {
  const p = oauthPortFor(A);
  p.storeToken(SERVER, "work", { clientId: "c", accessToken: "tok-work" }, 1);
  p.storeToken(SERVER, "personal", { clientId: "c", accessToken: "tok-personal" }, 1);
  assert.equal(p.getTokens([SERVER], "work")[0]?.data.accessToken, "tok-work");
  assert.equal(p.getTokens([SERVER], "personal")[0]?.data.accessToken, "tok-personal");
  p.deleteToken(SERVER, "work");
  assert.equal(p.getTokens([SERVER], "personal").length, 1, "signing out of one account keeps the other");
});

test("an unreadable store degrades to empty instead of throwing mid-request", () => {
  assert.deepEqual(oauthPortFor("local|never-existed@grok.test").getTokens([SERVER], ACCOUNT), []);
});
