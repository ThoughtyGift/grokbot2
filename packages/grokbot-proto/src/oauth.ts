/**
 * The MCP OAuth family — what lets somebody sign in with an account instead of pasting a token.
 *
 * The client already owns the hard half. Its main process carries a full OAuth client: PKCE
 * (`code_challenge`), dynamic client registration, the token endpoint, and a loopback listener it
 * binds itself. What it does NOT own is memory. It persists every step through these RPCs, and this
 * backend answered none of them — and an unhandled RPC here replies 200 with an empty body, so the
 * app would have reported a successful sign-in while nothing was saved.
 *
 * Field numbers are verbatim from the vendor descriptors in `electron-main/main.cjs`. The wire types
 * there resolve as T9=string, T3=int64, T8=bool, T5=int32.
 *
 * The shape of the flow, in the order the client drives it:
 *
 *   ProbeMcpUrl                 is this URL an MCP server, and does it want auth?
 *   StoreMcpOAuthPendingState   remember the PKCE verifier before opening the browser  → state_id
 *   GetMcpOAuthPendingState     the loopback callback fired; give me back what I stored
 *   CompleteMcpOAuth            the code is exchanged; close the pending state
 *   StoreMcpOAuthToken          keep the access/refresh token
 *   GetMcpOAuthTokens           hand them back on the next start
 *   ValidateMcpOAuthTokens      which of these servers am I actually signed in to?
 *   DeleteMcpOAuthToken         sign out
 *   McpOAuthRefreshLockBegin    /Release — a lease so two clients do not refresh at once
 *   CheckHttpMcpStatus          per-server view for the Plugins pane
 */
import { message, pbStr, pbVar, pbBool, pbMsg } from "./encode.js";

/** One stored credential set. `aiserver.v1.McpOAuthStoredData`. */
export interface StoredToken {
  refreshToken?: string;
  clientId: string;
  clientSecret?: string;
  redirectUris?: string[];
  accessToken?: string;
}

/** What a pending flow remembers between opening the browser and the callback coming back. */
export interface PendingState {
  serverUrl: string;
  codeVerifier: string;
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
  serviceAccountId?: string;
  postAuthReturnUrl?: string;
  accountKey: string;
}

/** The port the backend supplies. Every method is owner-scoped by whoever builds the port. */
export interface OAuthPort {
  storePending(s: PendingState): string;
  getPending(stateId: string): PendingState | null;
  complete(stateId: string, authorizationCode: string): { postAuthReturnUrl: string; accountKey: string } | null;
  storeToken(serverUrl: string, accountKey: string, data: StoredToken, clientTokenCreatedAtMs?: number): { updatedAtMs: number; applied: boolean; skipped: boolean };
  getTokens(serverUrls: string[], accountKey: string): { serverUrl: string; accountKey: string; updatedAtMs: number; data: StoredToken }[];
  validate(targets: { serverUrl: string; accountKey: string }[]): { serverUrl: string; accountKey: string; hasValidToken: boolean }[];
  deleteToken(serverUrl: string, accountKey: string): void;
}

/** `McpOAuthStoredData`: 1 refresh_token · 2 client_id · 3 client_secret · 4 redirect_uris · 5 access_token */
const storedData = (d: StoredToken): Buffer =>
  message(
    d.refreshToken ? pbStr(1, d.refreshToken) : null,
    pbStr(2, d.clientId),
    d.clientSecret ? pbStr(3, d.clientSecret) : null,
    ...(d.redirectUris ?? []).map((u) => pbStr(4, u)),
    d.accessToken ? pbStr(5, d.accessToken) : null,
  );

/** `StoreMcpOAuthPendingStateResponse`: 1 state_id */
export const storePendingStateResponse = (stateId: string): Buffer => message(pbStr(1, stateId));

/**
 * `GetMcpOAuthPendingStateResponse`: 1 server_url · 2 code_verifier · 3 client_id · 4 client_secret ·
 * 5 redirect_uri · 6 service_account_id · 7 post_auth_return_url · 8 account_key
 *
 * An unknown state id answers an EMPTY message rather than a made-up one: the client checks the
 * verifier before exchanging a code, and inventing one would turn "this callback is stale" into a
 * token exchange that fails for an unexplained reason.
 */
export function getPendingStateResponse(s: PendingState | null): Buffer {
  if (!s) return message();
  return message(
    pbStr(1, s.serverUrl),
    pbStr(2, s.codeVerifier),
    s.clientId ? pbStr(3, s.clientId) : null,
    s.clientSecret ? pbStr(4, s.clientSecret) : null,
    s.redirectUri ? pbStr(5, s.redirectUri) : null,
    s.serviceAccountId ? pbStr(6, s.serviceAccountId) : null,
    s.postAuthReturnUrl ? pbStr(7, s.postAuthReturnUrl) : null,
    pbStr(8, s.accountKey),
  );
}

/** `CompleteMcpOAuthResponse`: 1 post_auth_return_url · 2 account_key */
export const completeResponse = (r: { postAuthReturnUrl: string; accountKey: string } | null): Buffer =>
  r ? message(pbStr(1, r.postAuthReturnUrl), pbStr(2, r.accountKey)) : message();

/**
 * `StoreMcpOAuthTokenResponse`: 1 updated_at_ms · 2 applied · 3 skipped_because_backend_newer
 *
 * `applied` is the field that matters. Returning an empty message — which is what an unhandled RPC
 * did — reads as applied:false, and the client would keep retrying a store that never happened.
 */
export const storeTokenResponse = (r: { updatedAtMs: number; applied: boolean; skipped: boolean }): Buffer =>
  message(pbVar(1, Math.round(r.updatedAtMs)), pbBool(2, r.applied), pbBool(3, r.skipped));

/** `GetMcpOAuthTokensResponse`: 1 entries — Entry{1 server_url · 2 token_data · 3 updated_at_ms · 4 account_key} */
export const getTokensResponse = (
  rows: { serverUrl: string; accountKey: string; updatedAtMs: number; data: StoredToken }[],
): Buffer =>
  message(...rows.map((r) => pbMsg(1, message(
    pbStr(1, r.serverUrl),
    pbMsg(2, storedData(r.data)),
    pbVar(3, Math.round(r.updatedAtMs)),
    pbStr(4, r.accountKey),
  ))));

/** `ValidateMcpOAuthTokensResponse`: 1 results — Result{1 server_url · 2 has_valid_token · 3 account_key} */
export const validateTokensResponse = (
  rows: { serverUrl: string; accountKey: string; hasValidToken: boolean }[],
): Buffer =>
  message(...rows.map((r) => pbMsg(1, message(
    pbStr(1, r.serverUrl),
    pbBool(2, r.hasValidToken),
    pbStr(3, r.accountKey),
  ))));

/**
 * `McpOAuthRefreshLockBeginResponse`: 1 outcome · 2 lease_handle · 3 should_enforce
 *
 * The lease exists so two clients do not refresh one token at the same time and race each other into
 * revoking it. Upstream backs it with Redis across many machines; this is one process serving one
 * install, so the honest answer is always "go ahead": outcome WOULD_ACQUIRE (2), and
 * `should_enforce` false because there is no shared lock here to enforce against. Pretending
 * otherwise would make the client wait on a lock nobody holds.
 */
export const refreshLockBeginResponse = (leaseHandle: string): Buffer =>
  message(pbVar(1, 2), pbStr(2, leaseHandle), pbBool(3, false));

/**
 * `ProbeMcpUrlResponse`: 1 is_available · 2 requires_auth · 3 auth_url · 4 error
 *
 * `requires_auth` is what turns into the Authenticate button, and it is answered from the server's
 * own 401 — never guessed from a URL that merely looks like it needs a key.
 */
export const probeUrlResponse = (r: { isAvailable: boolean; requiresAuth: boolean; authUrl?: string; error?: string }): Buffer =>
  message(
    pbBool(1, r.isAvailable),
    pbBool(2, r.requiresAuth),
    r.authUrl ? pbStr(3, r.authUrl) : null,
    r.error ? pbStr(4, r.error) : null,
  );

/**
 * `CheckHttpMcpStatusResponse`: 1 statuses —
 * ServerStatus{1 id · 2 is_available · 3 requires_auth · 4 auth_url · 5 error · 6 has_valid_token}
 */
export const httpMcpStatusResponse = (
  rows: { id: number; isAvailable: boolean; requiresAuth: boolean; authUrl?: string; error?: string; hasValidToken: boolean }[],
): Buffer =>
  message(...rows.map((r) => pbMsg(1, message(
    pbVar(1, r.id),
    pbBool(2, r.isAvailable),
    pbBool(3, r.requiresAuth),
    r.authUrl ? pbStr(4, r.authUrl) : null,
    r.error ? pbStr(5, r.error) : null,
    pbBool(6, r.hasValidToken),
  ))));
