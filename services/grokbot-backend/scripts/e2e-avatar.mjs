/**
 * Gate B for P2-1 — the avatar route, exercised through every branch the host has.
 *
 * Gate A only proves the route answers. What matters to a person is that the sidebar shows a
 * picture instead of initials, and that needs the bytes, the content type, and the caching
 * headers to all be right. The branches that are easy to get wrong and impossible to see by
 * looking at the UI are the 304 and the version pin, so they are asserted explicitly.
 *
 * Creates a hidden probe bot, sets an avatar, checks the six branches, deletes the bot.
 *
 *   node scripts/e2e-avatar.mjs [--base http://localhost:8788]
 */
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const BASE = arg("--base", "http://localhost:8788");

/** 1x1 transparent PNG — small enough to inline, real enough to have a valid IHDR. */
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const gw = async (methodName, args) => {
  const res = await fetch(`${BASE}/gw/api/${methodName}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(args ?? {}),
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return text; }
};

const results = [];
const check = (name, expected, actual, note) => {
  const pass = JSON.stringify(expected) === JSON.stringify(actual);
  results.push({ name, expected, actual, pass, note });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}`);
  if (!pass) {
    console.log(`        expected ${JSON.stringify(expected)}`);
    console.log(`        actual   ${JSON.stringify(actual)}`);
    if (note) console.log(`        ${note}`);
  }
};

const created = await gw("createAgent", { name: "Avatar Probe" });
const agentId = created?.agent?.id;
if (!agentId) {
  console.error("could not create a probe agent — is the backend up?");
  process.exit(1);
}
// Hidden: a diagnostic must not leave a row in someone's sidebar.
await gw("setAgentHiddenFromSidebar", { id: agentId, hidden: true });

try {
  // ── no avatar yet ──────────────────────────────────────────────────────────
  const before = await fetch(`${BASE}/gw/avatars/${agentId}`);
  check("no avatar yet -> 404", 404, before.status);

  // ── set one, then read it back ─────────────────────────────────────────────
  const rec = await gw("setAgentAvatarBytes", { id: agentId, pngBase64: PNG_B64 });
  const version = rec?.avatarVersion;
  check("setAgentAvatarBytes returns a version", true, typeof version === "string" && version.length > 0);

  const ok = await fetch(`${BASE}/gw/avatars/${agentId}`);
  const bytes = Buffer.from(await ok.arrayBuffer());
  const etag = ok.headers.get("etag");
  check("serves the image", 200, ok.status);
  check("content-type is the image's own", "image/png", ok.headers.get("content-type"));
  check("content-length matches the bytes", Buffer.from(PNG_B64, "base64").byteLength, bytes.byteLength);
  check("etag quotes the version", `"${version}"`, etag);
  check("unpinned reads are not cached", "no-store", ok.headers.get("cache-control"));
  // The three hardening headers: an avatar is untrusted bytes and must never render as a document.
  check("content-disposition: attachment", "attachment", ok.headers.get("content-disposition"));
  check("x-content-type-options: nosniff", "nosniff", ok.headers.get("x-content-type-options"));
  check("content-security-policy is locked down", "default-src 'none'; sandbox", ok.headers.get("content-security-policy"));
  // The bytes must survive the base64 round trip intact, or the renderer draws a broken frame.
  check("bytes round-trip unchanged", PNG_B64, bytes.toString("base64"));

  // ── conditional request ────────────────────────────────────────────────────
  const notModified = await fetch(`${BASE}/gw/avatars/${agentId}`, { headers: { "if-none-match": etag } });
  check("if-none-match -> 304", 304, notModified.status);
  check("304 carries no body", 0, (await notModified.arrayBuffer()).byteLength);

  // ── version pin ────────────────────────────────────────────────────────────
  const pinned = await fetch(`${BASE}/gw/avatars/${agentId}?v=${version}`);
  check("matching ?v= -> 200", 200, pinned.status);
  check("pinned reads are immutable", "private, max-age=31536000, immutable", pinned.headers.get("cache-control"));
  const stale = await fetch(`${BASE}/gw/avatars/${agentId}?v=not-the-version`);
  check("stale ?v= -> 404", 404, stale.status,
    "serving the new image under an old pin would poison an immutable cache");

  // ── refusals ───────────────────────────────────────────────────────────────
  const cross = await fetch(`${BASE}/gw/avatars/${agentId}`, { headers: { "sec-fetch-site": "cross-site" } });
  check("cross-site -> 403", 403, cross.status);
  const missing = await fetch(`${BASE}/gw/avatars/`);
  check("missing agent id -> 404", 404, missing.status);
  const unknown = await fetch(`${BASE}/gw/avatars/agent-does-not-exist`);
  check("unknown agent -> 404", 404, unknown.status);
} finally {
  await gw("deleteAgents", { ids: [agentId] });
  console.log(`\ncleaned up ${agentId}`);
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
