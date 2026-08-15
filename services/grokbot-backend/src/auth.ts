import type { ServerResponse } from "node:http";

function b64url(b: string | Buffer): string {
  return Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Mint a structurally-valid (unsigned) JWT. The Grok Bot client decodes the
 * payload for exp/email/sub but does NOT verify the signature locally — so a
 * self-minted token is accepted. (Verified empirically during the spike.)
 */
export function mintJwt(): string {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(
    JSON.stringify({ sub: "auth0|grokbot2-user", email: "user@localhost", iat: now, exp: now + 365 * 86400 }),
  );
  return `${header}.${payload}.${b64url("grokbot2")}`;
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
