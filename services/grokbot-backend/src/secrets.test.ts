/**
 * `resolveSpecSecrets` — credential placeholders in an MCP server spec.
 *
 * The bug this prevents: a catalog row is shared data. Ship it with a real token and the token is
 * committed, published, and handed to every tenant who installs the row. Ship it with `${NAME}` and
 * each machine supplies its own — but only if the substitution is right about the two cases that
 * differ, which is what these cover:
 *
 *   an unresolved env key must be DROPPED   →  a missing optional credential still lets the server run
 *   an unresolved arg must be REPORTED      →  dropping it would shift every positional flag after it
 *
 *   npx tsx --test src/secrets.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveSpecSecrets, missingArgSecrets } from "./secrets.js";

const OWNER = "auth0|test-secrets";

/** Set env vars for one call and always put the environment back. */
function withEnv<T>(vars: Record<string, string | undefined>, fn: () => T): T {
  const before = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) v === undefined ? delete process.env[k] : (process.env[k] = v);
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(before)) v === undefined ? delete process.env[k] : (process.env[k] = v);
  }
}

// ── substitution ──────────────────────────────────────────────────────────────

test("an env placeholder is filled from the backend environment", () => {
  const r = withEnv({ GITHUB_PERSONAL_ACCESS_TOKEN: "ghp_real" }, () =>
    resolveSpecSecrets({ env: { GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_PERSONAL_ACCESS_TOKEN}" } }, OWNER));
  assert.equal(r.env.GITHUB_PERSONAL_ACCESS_TOKEN, "ghp_real");
  assert.deepEqual(r.missing, []);
});

test("an arg placeholder is filled too — Lark takes its credentials as -a/-s, not as env", () => {
  const r = withEnv({ LARK_APP_ID: "cli_x", LARK_APP_SECRET: "s3cr3t" }, () =>
    resolveSpecSecrets({ args: ["mcp", "-a", "${LARK_APP_ID}", "-s", "${LARK_APP_SECRET}"] }, OWNER));
  assert.deepEqual(r.args, ["mcp", "-a", "cli_x", "-s", "s3cr3t"]);
  assert.deepEqual(missingArgSecrets(r), []);
});

test("a placeholder embedded in a longer string is substituted in place", () => {
  const r = withEnv({ TOK: "abc" }, () => resolveSpecSecrets({ env: { AUTH: "Bearer ${TOK}" } }, OWNER));
  assert.equal(r.env.AUTH, "Bearer abc");
});

// ── the two failure modes, which differ on purpose ────────────────────────────

test("an unresolved env key is dropped, never passed through as the literal ${NAME}", () => {
  const r = withEnv({ N8N_API_KEY: undefined }, () =>
    resolveSpecSecrets({ env: { N8N_API_KEY: "${N8N_API_KEY}" } }, OWNER));
  assert.equal("N8N_API_KEY" in r.env, false, "the key must be absent, not set to the placeholder");
  assert.deepEqual(r.missing, ["N8N_API_KEY"]);
});

test("dropping one env key leaves the resolved keys beside it intact", () => {
  const r = withEnv({ N8N_API_URL: "http://localhost:5678", N8N_API_KEY: undefined }, () =>
    resolveSpecSecrets({ env: { N8N_API_URL: "${N8N_API_URL}", N8N_API_KEY: "${N8N_API_KEY}" } }, OWNER));
  assert.deepEqual(r.env, { N8N_API_URL: "http://localhost:5678" });
});

test("an unresolved ARG is reported instead of dropped — dropping shifts the flags after it", () => {
  const r = withEnv({ LARK_APP_ID: undefined, LARK_APP_SECRET: undefined }, () =>
    resolveSpecSecrets({ args: ["mcp", "-a", "${LARK_APP_ID}", "-s", "${LARK_APP_SECRET}"] }, OWNER));
  assert.equal(r.args.length, 5, "the argument list keeps its shape");
  assert.deepEqual(missingArgSecrets(r).sort(), ["LARK_APP_ID", "LARK_APP_SECRET"]);
});

test("an empty environment value counts as missing, not as a credential", () => {
  const r = withEnv({ NOTION_TOKEN: "" }, () =>
    resolveSpecSecrets({ env: { NOTION_TOKEN: "${NOTION_TOKEN}" } }, OWNER));
  assert.equal("NOTION_TOKEN" in r.env, false);
  assert.deepEqual(r.missing, ["NOTION_TOKEN"]);
});

// ── specs with nothing to substitute must come through untouched ──────────────

test("a literal value is left alone — a hand-written .mcp.json keeps working", () => {
  const r = resolveSpecSecrets({ args: ["-y", "pkg"], env: { TOKEN: "a-real-literal-token" } }, OWNER);
  assert.deepEqual(r.args, ["-y", "pkg"]);
  assert.deepEqual(r.env, { TOKEN: "a-real-literal-token" });
  assert.deepEqual(r.missing, []);
});

test("a spec with no args and no env resolves to empty, not undefined", () => {
  const r = resolveSpecSecrets({}, OWNER);
  assert.deepEqual(r.args, []);
  assert.deepEqual(r.env, {});
});

test("two placeholders of the same name in one spec are both filled", () => {
  const r = withEnv({ T: "v" }, () => resolveSpecSecrets({ args: ["${T}", "x${T}y"] }, OWNER));
  assert.deepEqual(r.args, ["v", "xvy"]);
});

// ── headers: where a remote server's Bearer token lives ───────────────────────

test("a header placeholder is filled — this is how a remote MCP server is authorised", () => {
  const r = withEnv({ ZERNIO_API_KEY: "zk_live_1" }, () =>
    resolveSpecSecrets({ headers: { Authorization: "Bearer ${ZERNIO_API_KEY}" } }, OWNER));
  assert.deepEqual(r.headers, { Authorization: "Bearer zk_live_1" });
  assert.deepEqual(r.missing, []);
});

test("an unresolved header is dropped, so the server answers its own 401", () => {
  const r = withEnv({ ZERNIO_API_KEY: undefined }, () =>
    resolveSpecSecrets({ headers: { Authorization: "Bearer ${ZERNIO_API_KEY}" } }, OWNER));
  assert.equal("Authorization" in r.headers, false, "sending a literal ${…} would read as a bad token");
  assert.deepEqual(r.missing, ["ZERNIO_API_KEY"]);
});

test("headers do not disturb args and env, and a spec with none still resolves to {}", () => {
  const both = withEnv({ A: "1", B: "2", C: "3" }, () =>
    resolveSpecSecrets({ args: ["${A}"], env: { E: "${B}" }, headers: { H: "${C}" } }, OWNER));
  assert.deepEqual(both, { args: ["1"], env: { E: "2" }, headers: { H: "3" }, missing: [] });
  assert.deepEqual(resolveSpecSecrets({}, OWNER).headers, {});
});
