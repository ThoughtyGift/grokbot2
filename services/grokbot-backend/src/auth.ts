import type { ServerResponse } from "node:http";

function b64url(b: string | Buffer): string {
  return Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Mint a structurally-valid (unsigned) JWT. The Grok Bot client decodes the
 * payload for exp/email/sub but does NOT verify the signature locally — so a
 * self-minted token is accepted. (Verified empirically during the spike.)
 */
export interface TokenUser {
  authId: string;
  email: string;
}

/** The single identity the backend hands out until multi-user login is wired (see billing.ts). */
export const DEFAULT_USER: TokenUser = { authId: "auth0|grokbot2-user", email: "user@localhost" };

export function mintJwt(user: TokenUser = DEFAULT_USER): string {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(
    JSON.stringify({ sub: user.authId, email: user.email, iat: now, exp: now + 365 * 86400 }),
  );
  return `${header}.${payload}.${b64url("grokbot2")}`;
}

/**
 * Who a request belongs to, from its `Authorization: Bearer <jwt>` header.
 *
 * The payload is READ, not verified — this backend minted the token and the client never checks the
 * signature either (see mintJwt), so decoding `sub`/`email` is all the identity there is. Returns
 * null on anything malformed so a caller can fall back to DEFAULT_USER rather than throw.
 */
export function userFromToken(authHeader?: string | string[]): TokenUser | null {
  const raw = Array.isArray(authHeader) ? authHeader[0] : authHeader;
  const jwt = raw?.replace(/^Bearer\s+/i, "").trim();
  const part = jwt?.split(".")[1];
  if (!part) return null;
  try {
    const { sub, email } = JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as {
      sub?: string;
      email?: string;
    };
    return sub ? { authId: sub, email: email ?? "" } : null;
  } catch {
    return null;
  }
}

/** Handle /oauth/token, /auth/* — always hand back a fresh token so login completes. */
export function handleAuth(res: ServerResponse): void {
  const jwt = mintJwt();
  res.writeHead(200, { "content-type": "application/json" });
  res.end(
    JSON.stringify({
      access_token: jwt,
      refresh_token: jwt,
      id_token: jwt,
      token_type: "Bearer",
      expires_in: 365 * 86400,
      accessToken: jwt,
      refreshToken: jwt,
      authId: "auth0|grokbot2-user",
    }),
  );
}
