/**
 * The OAuth negotiation, which turned out to be ours after all.
 *
 * The split took two wrong guesses to pin down. The app owns the browser and the loopback listener
 * that catches the redirect, and it hands us the redirect URI it is listening on. What it does NOT
 * do is work out where to send the person: `CheckHttpMcpStatusResponse.auth_url` is a field the
 * BACKEND fills, and leaving it empty is why clicking Authenticate did nothing at all — no browser,
 * no error, a silent no-op.
 *
 * So this module does the parts a server has to do:
 *
 *   discover       401 → WWW-Authenticate → resource metadata → authorization server metadata
 *   register       dynamic client registration (RFC 7591), once per (issuer, redirect uri)
 *   authorize      PKCE S256 + a state that IS the pending-state id, so the callback correlates
 *   exchange       the code for tokens, and store them where mcp.ts already looks
 *
 * Nothing here is invented: measured against Zernio, which implements the spec properly —
 * `.well-known/oauth-protected-resource/mcp` names `https://zernio.com/` as its authorization
 * server, that server advertises `registration_endpoint` and S256, and registration answers 201.
 *
 * Preparation is ASYNCHRONOUS and the RPC builders are not, so an authorize URL is built in the
 * background and cached. The first status call after a 401 kicks it off and answers without a URL;
 * the next one has it. The client polls, so this settles on its own.
 */
import { createHash, randomBytes } from "node:crypto";
import { oauthPortFor, type PendingState } from "./mcp-oauth.js";

/** Long enough that a person can finish signing in; short enough that a stale URL is not reused. */
const AUTH_URL_TTL_MS = 10 * 60_000;
const NET_TIMEOUT_MS = 15_000;

interface Discovered {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint?: string;
  scopes: string[];
}

interface Registration { clientId: string; clientSecret?: string }

/** `serverUrl|redirectUri` → the URL to open, once it is ready. */
const prepared = new Map<string, { authUrl: string; at: number }>();
/** In-flight preparations, so a polling client does not start five of them. */
const preparing = new Set<string>();
/** `issuer|redirectUri` → client credentials, so registration happens once. */
const registrations = new Map<string, Registration>();
/** Discovery is stable per server; cache it for the process lifetime. */
const discovered = new Map<string, Discovered>();

const key = (serverUrl: string, redirectUri: string): string => `${serverUrl}|${redirectUri}`;
const base64url = (b: Buffer): string => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const getJson = async (url: string): Promise<any> => {
  const res = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(NET_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${url} answered HTTP ${res.status}`);
  return res.json();
};

/**
 * Find the authorization server for an MCP endpoint.
 *
 * The chain is the MCP Authorization spec's: the server's 401 carries
 * `WWW-Authenticate: Bearer resource_metadata="…"`, that document names its authorization servers,
 * and each of those publishes its own metadata. Falling back to a guessed `.well-known` path on the
 * MCP host itself is deliberate — some servers are their own authorization server — but the header
 * is tried first because it is the only authoritative answer.
 */
async function discover(serverUrl: string): Promise<Discovered> {
  const cached = discovered.get(serverUrl);
  if (cached) return cached;

  let resourceMetadataUrl: string | null = null;
  try {
    const probe = await fetch(serverUrl, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
      signal: AbortSignal.timeout(NET_TIMEOUT_MS),
    });
    const header = probe.headers.get("www-authenticate") ?? "";
    resourceMetadataUrl = /resource_metadata="([^"]+)"/.exec(header)?.[1] ?? null;
  } catch { /* fall through to the well-known guess */ }

  let issuerBase: string;
  if (resourceMetadataUrl) {
    const meta = await getJson(resourceMetadataUrl);
    const servers: string[] = Array.isArray(meta?.authorization_servers) ? meta.authorization_servers : [];
    if (!servers.length) throw new Error("resource metadata names no authorization server");
    issuerBase = servers[0].replace(/\/+$/, "");
  } else {
    issuerBase = new URL(serverUrl).origin;
  }

  // Both spellings are legal and servers differ on which they publish.
  let meta: any = null;
  for (const path of ["/.well-known/oauth-authorization-server", "/.well-known/openid-configuration"]) {
    try { meta = await getJson(issuerBase + path); break; } catch { /* try the next */ }
  }
  if (!meta?.authorization_endpoint || !meta?.token_endpoint) {
    throw new Error(`${issuerBase} publishes no usable authorization server metadata`);
  }

  const out: Discovered = {
    issuer: String(meta.issuer ?? issuerBase),
    authorizationEndpoint: String(meta.authorization_endpoint),
    tokenEndpoint: String(meta.token_endpoint),
    ...(meta.registration_endpoint ? { registrationEndpoint: String(meta.registration_endpoint) } : {}),
    scopes: Array.isArray(meta.scopes_supported) ? meta.scopes_supported.map(String) : [],
  };
  discovered.set(serverUrl, out);
  return out;
}

/**
 * Get client credentials for this authorization server, registering if we have none.
 *
 * Registration is per redirect URI because that is what it binds: the app picks a loopback port, and
 * a client registered for one port cannot be used with another.
 */
async function clientFor(d: Discovered, redirectUri: string): Promise<Registration> {
  const k = `${d.issuer}|${redirectUri}`;
  const have = registrations.get(k);
  if (have) return have;
  if (!d.registrationEndpoint) throw new Error(`${d.issuer} has no registration endpoint and no client is configured`);

  const res = await fetch(d.registrationEndpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "Grok Bot (self-hosted)",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      ...(d.scopes.length ? { scope: d.scopes.join(" ") } : {}),
    }),
    signal: AbortSignal.timeout(NET_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`registration at ${d.registrationEndpoint} answered HTTP ${res.status}`);
  const body = (await res.json()) as Record<string, unknown>;
  if (!body?.client_id) throw new Error("registration returned no client_id");
  const reg: Registration = {
    clientId: String(body.client_id),
    ...(body.client_secret ? { clientSecret: String(body.client_secret) } : {}),
  };
  registrations.set(k, reg);
  return reg;
}

/**
 * The URL to open, if one is ready.
 *
 * Synchronous by necessity — the response builders are — so a miss starts the work and answers
 * nothing. Returning a half-built URL would be worse than returning none: the client would open a
 * page that cannot complete.
 */
export function authUrlFor(serverUrl: string, redirectUri: string, owner: string): string | undefined {
  const k = key(serverUrl, redirectUri);
  const hit = prepared.get(k);
  if (hit && Date.now() - hit.at < AUTH_URL_TTL_MS) return hit.authUrl;
  if (!preparing.has(k)) {
    preparing.add(k);
    void prepareAuthUrl(serverUrl, redirectUri, owner).finally(() => preparing.delete(k));
  }
  return undefined;
}

/** Discover, register, mint PKCE, store the pending state, and cache the authorize URL. */
async function prepareAuthUrl(serverUrl: string, redirectUri: string, owner: string): Promise<void> {
  try {
    const d = await discover(serverUrl);
    const client = await clientFor(d, redirectUri);

    const verifier = base64url(randomBytes(32));
    const challenge = base64url(createHash("sha256").update(verifier).digest());

    const pending: PendingState = {
      serverUrl,
      codeVerifier: verifier,
      clientId: client.clientId,
      ...(client.clientSecret ? { clientSecret: client.clientSecret } : {}),
      redirectUri,
      accountKey: "default",
    };
    // The state IS the pending-state id: the loopback callback comes back with `state`, and the
    // client hands exactly that to CompleteMcpOAuth. Any other correlation would have to be guessed.
    const stateId = oauthPortFor(owner).storePending(pending);

    const u = new URL(d.authorizationEndpoint);
    u.searchParams.set("response_type", "code");
    u.searchParams.set("client_id", client.clientId);
    u.searchParams.set("redirect_uri", redirectUri);
    u.searchParams.set("state", stateId);
    u.searchParams.set("code_challenge", challenge);
    u.searchParams.set("code_challenge_method", "S256");
    // RFC 8707: name the MCP endpoint the token is for, so the authorization server can scope it.
    u.searchParams.set("resource", serverUrl);
    if (d.scopes.length) u.searchParams.set("scope", d.scopes.join(" "));

    prepared.set(key(serverUrl, redirectUri), { authUrl: u.toString(), at: Date.now() });
  } catch (e) {
    // Named, not swallowed: without this line a sign-in that cannot even be started looks identical
    // to one nobody attempted. The URL and the reason are safe to log; no credential is.
    console.warn(`[grokbot2] [oauth] cannot prepare a sign-in for ${serverUrl}: ${(e as Error).message}`);
  }
}

/**
 * Exchange the authorization code for tokens and store them.
 *
 * Called when the client reports the callback. Fire-and-forget from the RPC's point of view: the
 * response has no field for a token, and the client learns it worked by seeing
 * `user_has_access_token` flip on the next status read.
 */
export async function completeAuthorization(stateId: string, code: string, owner: string): Promise<void> {
  const port = oauthPortFor(owner);
  const pending = port.getPending(stateId);
  if (!pending) {
    console.warn("[grokbot2] [oauth] a callback arrived for a sign-in nobody started (or one that expired)");
    return;
  }
  try {
    const d = await discover(pending.serverUrl);
    const form = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: pending.redirectUri ?? "",
      client_id: pending.clientId ?? "",
      code_verifier: pending.codeVerifier,
    });
    if (pending.clientSecret) form.set("client_secret", pending.clientSecret);

    const res = await fetch(d.tokenEndpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: form,
      signal: AbortSignal.timeout(NET_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`token endpoint answered HTTP ${res.status}`);
    const body = (await res.json()) as Record<string, unknown>;
    if (!body?.access_token) throw new Error("token endpoint returned no access_token");

    port.storeToken(pending.serverUrl, pending.accountKey || "default", {
      clientId: pending.clientId ?? "",
      ...(pending.clientSecret ? { clientSecret: pending.clientSecret } : {}),
      ...(pending.redirectUri ? { redirectUris: [pending.redirectUri] } : {}),
      accessToken: String(body.access_token),
      ...(body.refresh_token ? { refreshToken: String(body.refresh_token) } : {}),
    });
    // Only now is the flow finished, so only now is the verifier spent.
    port.complete(stateId, code);
    prepared.delete(key(pending.serverUrl, pending.redirectUri ?? ""));
    console.log(`[grokbot2] [oauth] signed in to ${pending.serverUrl}`);
  } catch (e) {
    console.warn(`[grokbot2] [oauth] exchange failed for ${pending.serverUrl}: ${(e as Error).message}`);
  }
}
