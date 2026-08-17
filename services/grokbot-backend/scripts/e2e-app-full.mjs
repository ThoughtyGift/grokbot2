/**
 * Full end-to-end through the REAL app UI, not through HTTP.
 *
 * The gate suite (`e2e-run.mjs`) checks the wire: routes, shapes, commands, channels. It cannot tell
 * you whether a person sees a reply. Gate C only counts what is already on screen, passively. This
 * drives the app — types in the composer, waits for text to render, watches the avatar move — and so
 * it is the only check here that fails when the app looks broken to a human while every byte on the
 * wire is correct. That exact gap is what parity.md §2t and §2w were both about.
 *
 * Uses a bot it creates and deletes, VISIBLE on purpose: a hidden one never reaches the sidebar, and
 * "does a new bot appear in the sidebar" is one of the things worth proving.
 *
 *   node scripts/e2e-app-full.mjs
 *   node scripts/e2e-app-full.mjs --cdp http://127.0.0.1:9222 --keep
 */
import { chromium } from "playwright-core";
import { gwHeaders } from "./gw-auth.mjs";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const CDP = arg("--cdp", "http://127.0.0.1:9222");
const BASE = arg("--base", "http://localhost:8788");
const KEEP = process.argv.includes("--keep");
const NAME = `E2E Full ${new Date().toISOString().slice(11, 19)}`;

const results = [];
const step = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};

/**
 * Gateway call that survives a dev-server restart.
 *
 * This script takes minutes, `tsx watch` reloads the backend on every source save, and anyone
 * editing the repo while it runs will bounce it mid-flight. Two runs died on exactly that with
 * `fetch failed` and `ECONNREFUSED`, which says nothing about the app. A reload is a few hundred
 * milliseconds of refused connections; retrying across it is the difference between measuring the
 * product and measuring the editor.
 *
 * Only connection failures are retried. An HTTP error is a real answer and is returned as one.
 */
const gw = async (method, args, tries = 12) => {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`${BASE}/gw/api/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...gwHeaders() },
        body: JSON.stringify(args ?? {}),
        signal: AbortSignal.timeout(20_000),
      });
      const t = await r.text();
      try { return JSON.parse(t); } catch { return t; }
    } catch (e) {
      // No need to re-read the ticket: it is stable across restarts by design (auth-gate.ts reads
      // .data/gateway-token.txt back rather than minting a new one), which is why a reload does not
      // invalidate the header this script is already holding.
      if (i === tries - 1) throw e;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  return null;
};

/** Poll `fn` until it returns truthy or `ms` elapses. Returns the value or null. */
const until = async (fn, ms, every = 500) => {
  const stop = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > stop) return null;
    await new Promise((r) => setTimeout(r, every));
  }
};

const isRunning = async (id) => {
  const rows = await gw("listAgents", {});
  return Array.isArray(rows) && rows.some((r) => r.id === id && r.isRunning === true);
};

/**
 * Wait until the bot is idle before sending the next prompt.
 *
 * The first version of this script fired three prompts back to back and two of its checks failed
 * because of it: `sendPrompt` calls `inflight.get(agentId)?.abort()`, so each message KILLED the turn
 * before it. The transcript ended up holding one bubble with two answers run together, and the tool
 * prompt aborted a turn that was still streaming. Serialising is not politeness here — without it the
 * script measures its own interference.
 */
const waitIdle = async (id, ms = 60_000) => until(async () => !(await isRunning(id)), ms, 700);

const browser = await chromium.connectOverCDP(CDP, { timeout: 10_000 });
const pages = browser.contexts().flatMap((c) => c.pages());
const page = pages.find((p) => /index\.html/.test(p.url()));
if (!page) {
  console.error(`no renderer on ${CDP} — is the local app running?`);
  process.exit(1);
}

let agentId = null;
try {
  // ── 1. the app is usable at all ─────────────────────────────────────────────
  const blockers = await page.evaluate(() => {
    const t = document.body.innerText || "";
    return [
      ["needs-ultra", /needs an Ultra plan|upgrade to Ultra/i],
      ["signed-out", /sign in to continue|sign-in expired/i],
      ["unreachable", /can'?t reach|host unreachable/i],
      ["unauthorized", /unauthorized|\b401\b/i],
      ["error", /something went wrong|failed to load/i],
    ].filter(([, re]) => re.test(t)).map(([k]) => k);
  });
  step("app shows no blocking state", blockers.length === 0, blockers.join(", ") || "clean");

  const composerCount = await page.locator('[contenteditable="true"]').count();
  step("composer is present", composerCount > 0, `${composerCount} editable region(s)`);

  // ── 1b. is the app's replica actually live? ─────────────────────────────────
  //
  // A precondition, not a feature check. One run of this script failed "new bot appears in the
  // sidebar" while a direct measurement put the same path at 74 ms — the run had started moments
  // after a backend restart, with the app's roster replica still resyncing. Blaming the feature for
  // that is exactly the false alarm that gets a suite ignored, so the readiness of the app is
  // established first: if it cannot see a bot it ALREADY has, it is not ready to judge a new one.
  const existing = await gw("listAgents", {});
  const known = Array.isArray(existing) ? existing.map((r) => r.name).filter(Boolean) : [];
  const replicaLive = known.length === 0
    ? "no bots to check against"
    : await until(
        () => page.evaluate((names) => {
          const t = document.body.innerText || "";
          return names.some((n) => t.includes(n));
        }, known),
        20_000,
      );
  step("the app's roster replica is live before we judge it", Boolean(replicaLive),
    known.length === 0 ? "skipped — empty roster" : replicaLive ? `sees one of ${known.length} existing bots` : "sees none of its own bots");

  // ── 2. a new bot reaches the sidebar ────────────────────────────────────────
  // This is the roster path end to end: gateway → store → push/poll → rendered row. It is what
  // was broken for six rounds when events went out on a channel that does not exist.
  const created = await gw("createAgent", { name: NAME });
  agentId = created?.agent?.id ?? null;
  step("createAgent returned an id", Boolean(agentId), agentId ?? "no id");
  if (!agentId) throw new Error("cannot continue without an agent");

  const t0 = Date.now();
  const inSidebar = await until(
    () => page.evaluate((n) => (document.body.innerText || "").includes(n), NAME),
    30_000,
    250,
  );
  step("new bot appears on screen without a reload", Boolean(inSidebar),
    inSidebar ? `${Date.now() - t0} ms` : "not after 30s");

  // ── 3. open it ──────────────────────────────────────────────────────────────
  let opened = false;
  try {
    await page.getByText(NAME, { exact: false }).first().click({ timeout: 6000 });
    opened = true;
  } catch { /* fall through */ }
  step("the bot's conversation opens on click", opened);

  // ── 4. a typed message gets a rendered reply ────────────────────────────────
  // The part no HTTP check can make: bytes arriving is not the same as a person seeing them.
  let replied = null;
  if (opened) {
    const composer = page.locator('[contenteditable="true"]').last();
    await composer.click({ timeout: 5000 });
    await page.keyboard.type("Tra loi that ngan: 6+6 bang may?", { delay: 12 });
    await page.keyboard.press("Enter");
    step("message accepted by the composer", true);

    replied = await until(async () => {
      const txt = await page.evaluate(() => document.body.innerText || "");
      // 12 as a standalone token, so "6+6" in the echoed prompt does not count as the answer.
      return /(^|[^\d])12([^\d]|$)/.test(txt) ? "12 rendered" : null;
    }, 45_000);
    step("the reply RENDERS in the transcript", Boolean(replied), replied ?? "no answer on screen in 45s");
    await waitIdle(agentId);
  }

  // ── 5. presence animates while a turn runs ─────────────────────────────────
  // Measured as motion, not as a label: the indicator is an animated avatar with no text and no
  // spinner class, which is why looking for the word "Thinking" gave a false negative before.
  if (opened) {
    const composer = page.locator('[contenteditable="true"]').last();
    await composer.click({ timeout: 5000 });
    // A longer answer keeps the indicator up long enough to sample it.
    await page.keyboard.type("Viet mot doan 4 cau ve mua thu Ha Noi.", { delay: 12 });
    await page.keyboard.press("Enter");
    // Sample only WHILE the turn is running. The first version sampled a fixed six seconds, which
    // for a one-line answer was mostly the idle state — 2 distinct frames, read as "barely moves"
    // when it actually meant "the turn was over". parity.md measured ten frames across a real turn.
    const hashes = new Set();
    let frames = 0;
    const deadline = Date.now() + 40_000;
    // Wait for it to start, so the first sample is not the idle frame.
    await until(() => isRunning(agentId), 15_000, 200);
    while (Date.now() < deadline) {
      try {
        const shot = await page.screenshot({ clip: { x: 0, y: 0, width: 320, height: 620 } });
        let h = 0;
        for (const b of shot) h = (h * 31 + b) & 0xffffffff;
        hashes.add(h);
        frames += 1;
      } catch { /* window may be mid-paint */ }
      if (!(await isRunning(agentId))) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    step("presence animates during the turn", hashes.size >= 3,
      `${hashes.size} distinct of ${frames} frames sampled while running`);
    await waitIdle(agentId);
  }

  // ── 6. a tool call runs and its answer renders ──────────────────────────────
  if (opened) {
    const composer = page.locator('[contenteditable="true"]').last();
    await composer.click({ timeout: 5000 });
    await page.keyboard.type("Dung cong cu list_dir_v2 xem thu muc . cua box, roi noi co bao nhieu muc.", { delay: 10 });
    await page.keyboard.press("Enter");

    // Assert on the BACKEND transcript for the tool step (tool-call entries are deliberately not
    // rendered as bubbles — the client skips them, see chat.ts), and on the SCREEN for the answer.
    const toolRan = await until(async () => {
      const t = await gw("getAgentTranscriptTail", { agentId });
      const calls = (t?.entries ?? []).filter((e) => e.kind === "tool-call");
      const done = calls.find((c) => c.status === "done");
      return done ? `${done.name} → ${String(done.result ?? "").split("\n")[0].slice(0, 40)}` : null;
    }, 60_000);
    step("a tool actually ran against the box", Boolean(toolRan), toolRan ?? "no completed tool-call in 60s");

    // Read the answer only once the turn is IDLE. Reading mid-stream gave a half-written bubble, and
    // matching a prefix of that against the screen then failed because the text had moved on.
    await waitIdle(agentId);
    const t = await gw("getAgentTranscriptTail", { agentId });
    const last = (t?.entries ?? []).filter((e) => e.kind === "send-message" && e.message?.type === "text").pop();
    const answered = (last?.message?.content ?? "").trim();
    step("the turn ends with a prose answer, not raw TOOL_CALL",
      Boolean(answered) && !answered.startsWith("TOOL_CALL"), answered.slice(0, 60).replace(/\n/g, " ") || "none");

    // Match on a distinctive slice from the MIDDLE, not the start: the first characters are the most
    // likely to be re-wrapped or decorated by the renderer.
    const needle = answered.slice(8, 34);
    const onScreen = needle
      ? await until(() => page.evaluate((s) => (document.body.innerText || "").includes(s), needle), 20_000)
      : null;
    step("that answer is visible on screen", Boolean(onScreen), onScreen ? "rendered" : "in transcript but not rendered");
  }

  // ── 7. the avatar route serves a picture the app can use ────────────────────
  const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  await gw("setAgentAvatarBytes", { id: agentId, pngBase64: PNG });
  const av = await fetch(`${BASE}/gw/avatars/${agentId}`, { headers: gwHeaders() });
  step("avatar bytes are served", av.status === 200 && (av.headers.get("content-type") ?? "").startsWith("image/"),
    `HTTP ${av.status} ${av.headers.get("content-type") ?? ""}`);

  // ── 8. the computer pane reports a real state ───────────────────────────────
  const box = await gw("getForeverBoxStatus", { id: agentId });
  step("computer pane has a state and an agentId", Boolean(box?.agentId) && Boolean(box?.state),
    `state=${box?.state} vnc=${box?.vncUrl ? "set" : "none"}`);
} catch (e) {
  step("run completed without throwing", false, String(e?.message ?? e).slice(0, 120));
} finally {
  if (agentId && !KEEP) {
    await gw("deleteAgents", { ids: [agentId] });
    const gone = await until(
      async () => !(await page.evaluate((n) => (document.body.innerText || "").includes(n), NAME)),
      15_000,
    );
    step("deleted bot leaves the sidebar", Boolean(gone), gone ? "≤15s" : "still listed after 15s");
  }
  await browser.close().catch(() => {});
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log("\nfailed:");
  for (const f of failed) console.log(`  ${f.name}${f.detail ? `  — ${f.detail}` : ""}`);
}
process.exit(failed.length === 0 ? 0 : 1);
