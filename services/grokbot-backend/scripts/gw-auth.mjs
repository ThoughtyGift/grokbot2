/**
 * The gateway ticket, for scripts.
 *
 * Once P0-5 enforces authentication, every tool that talks to `/gw/*` needs the ticket the app
 * gets from `EnsureSandBox`. It is minted fresh each boot and cannot be hardcoded — that was the
 * whole point of not leaving a literal in the source — so the backend drops a copy in
 * `.data/gateway-token.txt` and this reads it.
 *
 * Import and spread into headers:
 *
 *   import { gwHeaders } from "./gw-auth.mjs";
 *   fetch(url, { headers: { "content-type": "application/json", ...gwHeaders() } });
 *
 * Returns an empty object when there is no token file, so a script still works against a backend
 * running with GROKBOT2_AUTH=off rather than failing on a missing file.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const TOKEN_FILE = join(dirname(fileURLToPath(import.meta.url)), "..", ".data", "gateway-token.txt");

let cached;

/** The raw token, or null when unavailable. */
export function gwToken() {
  if (cached !== undefined) return cached;
  // An explicit env var wins: the same escape hatch the backend honours.
  const fromEnv = process.env.GROKBOT2_GATEWAY_TOKEN?.trim();
  if (fromEnv) return (cached = fromEnv);
  try {
    const raw = readFileSync(TOKEN_FILE, "utf8").trim();
    cached = raw.length > 0 ? raw : null;
  } catch {
    cached = null;
  }
  return cached;
}

/** `{ authorization: "Bearer …" }`, or `{}` when there is no token to send. */
export function gwHeaders() {
  const t = gwToken();
  return t ? { authorization: `Bearer ${t}` } : {};
}
