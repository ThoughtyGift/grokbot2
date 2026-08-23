/**
 * Credential placeholders for MCP server specs.
 *
 * A catalog row must not carry a real token. The registry is DATA meant to be shared — published as
 * a community registry, even — and a token written into it would be committed, and then handed
 * verbatim to every tenant who installed that row. So a row declares WHICH credential it needs,
 * `"${GITHUB_PERSONAL_ACCESS_TOKEN}"`, and the value is substituted here, from the machine that
 * actually runs the server.
 *
 * Resolution order, most specific first:
 *   1. `.data/secrets/<authId>.json` — this owner's own credentials (multi-tenant)
 *   2. `process.env`                 — the single-user desktop, or a unit file's EnvironmentFile
 *
 * Substitution happens at SPAWN, not at install: no config file on disk ever holds a secret, and
 * rotating a token does not need a reinstall.
 *
 * Unresolved placeholders are never passed through. The literal string `${GITHUB_...}` reaching a
 * server makes it fail as though the token were wrong, which sends you looking in the wrong place.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Where this module keeps its files.
 *
 * Derived from the module path, so it followed the code and ignored every test-isolation env var —
 * which is how a test that calls clearOAuth(DEFAULT_USER) deleted a REAL sign-in twice in one day.
 * `GROKBOT2_DATA_DIR` lets the test runner point all of it somewhere disposable; unset, nothing
 * changes.
 */
const DATA_DIR = process.env.GROKBOT2_DATA_DIR ?? join(dirname(fileURLToPath(import.meta.url)), "..", ".data");
const PLACEHOLDER = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

const secretsPath = (owner: string): string =>
  join(DATA_DIR, "secrets", `${owner.replace(/[^a-zA-Z0-9._-]/g, "_")}.json`);

/** This owner's credential file, or `{}` — a missing or malformed file must not stop a spawn. */
function ownerSecrets(owner: string): Record<string, string> {
  try {
    const raw = JSON.parse(readFileSync(secretsPath(owner), "utf8"));
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

/** Names already reported, so a server that restarts does not reprint the same warning forever. */
const warned = new Set<string>();

export interface ResolvedSpec {
  args: string[];
  env: Record<string, string>;
  /** HTTP headers for a remote server — where a Bearer token lives, so it needs the same treatment. */
  headers: Record<string, string>;
  /** Credential names a placeholder asked for and nothing supplied. */
  missing: string[];
}

/**
 * Substitute `${NAME}` in a spec's `args` and `env` for one owner.
 *
 * The two halves are treated differently on purpose:
 *
 * - **env**: an unresolved key is DROPPED. Credentials are often optional (n8n-mcp serves its node
 *   documentation with no API key at all), so a missing one should degrade the server, not block it.
 * - **args**: an unresolved value is a hard error, raised by the caller from `missing`. Arguments
 *   are positional — dropping the value after `-a` silently shifts every flag that follows and the
 *   server receives a different command than the one written down. Refusing to start is the honest
 *   outcome, and it can name the credential.
 */
export function resolveSpecSecrets(
  spec: { args?: string[]; env?: Record<string, string>; headers?: Record<string, string> },
  owner: string,
): ResolvedSpec {
  const own = ownerSecrets(owner);
  const missing = new Set<string>();
  const lookup = (name: string): string | undefined => own[name] ?? process.env[name];

  const expand = (value: string): string =>
    value.replace(PLACEHOLDER, (whole, name: string) => {
      const found = lookup(name);
      if (found !== undefined && found !== "") return found;
      missing.add(name);
      return whole;   // left in place; the caller decides to drop the key or refuse the spawn
    });

  const args = (spec.args ?? []).map(expand);

  /** Same rule for both string maps: an unresolved key is dropped, never passed through verbatim. */
  const resolveMap = (src: Record<string, string> = {}): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(src)) {
      const expanded = expand(v);
      const unresolved = PLACEHOLDER.test(expanded);
      PLACEHOLDER.lastIndex = 0;   // the regex is /g and stateful; reset before the next test
      if (!unresolved) out[k] = expanded;
    }
    return out;
  };

  // A missing Authorization header is dropped like a missing env key: the request then fails with the
  // server's own 401, which names the problem better than a literal "${TOKEN}" sent as a credential.
  return { args, env: resolveMap(spec.env), headers: resolveMap(spec.headers), missing: [...missing] };
}

/** Credential names still unresolved in `args` — the ones that must stop a spawn. */
export function missingArgSecrets(resolved: ResolvedSpec): string[] {
  const names = new Set<string>();
  for (const a of resolved.args) {
    for (const m of a.matchAll(PLACEHOLDER)) names.add(m[1]);
  }
  return [...names];
}

/** Warn once per credential name that a server started without it. */
export function warnMissing(server: string, names: readonly string[]): void {
  for (const n of names) {
    const key = `${server}:${n}`;
    if (warned.has(key)) continue;
    warned.add(key);
    console.warn(
      `[grokbot2] [mcp] "${server}" wants ${n} and nothing supplies it — ` +
      `set it in the backend environment, or in .data/secrets/<user>.json`,
    );
  }
}

/**
 * Store credentials this owner typed into a plugin's setup form.
 *
 * Merged, not replaced: two plugins can want different credentials, and installing the second must
 * not wipe the first. An empty string clears a key, which is how the edit form removes one.
 *
 * This file is the ONLY place a real token lands. It sits under `.data/`, one file per owner, and
 * `resolveSpecSecrets` reads it at spawn — so the MCP config keeps holding placeholders.
 */
export function saveSecrets(owner: string, values: Record<string, string>): void {
  const entries = Object.entries(values).map(([k, v]) => [k, v.trim()] as const);
  if (entries.length === 0) return;

  const file = secretsPath(owner);
  const merged = { ...ownerSecrets(owner) };
  for (const [k, v] of entries) {
    if (v.length === 0) delete merged[k];
    else merged[k] = v;
  }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(merged, null, 2)}
`, { mode: 0o600 });
  // `warned` is keyed by server, not owner, so clear every entry naming a credential just supplied —
  // otherwise the "wants X and nothing supplies it" line stays suppressed after X is finally set.
  const supplied = new Set(entries.filter(([, v]) => v.length > 0).map(([k]) => k));
  for (const key of [...warned]) if (supplied.has(key.slice(key.indexOf(":") + 1))) warned.delete(key);
}
