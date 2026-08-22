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
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { gwHeaders } from "./gw-auth.mjs";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const CDP = arg("--cdp", "http://127.0.0.1:9222");
const BASE = arg("--base", "http://localhost:8788");
const KEEP = process.argv.includes("--keep");
const NAME = `E2E Full ${new Date().toISOString().slice(11, 19)}`;

/**
 * Checks that are known to fail, why, and where the evidence is.
 *
 * This list exists so the phase gate can run this script at all. Both remaining entries were
 * traced to something other than a P4 regression (parity.md §2ag). Counted as KNOWN, the gate
 * goes red the moment anything ELSE on screen breaks, which is what a gate is for.
 *
 * A known gap that starts passing is reported too, and loudly. "deleted bot" passed once then
 * failed the next run — do not remove it on a single PASS.
 */
const KNOWN_OPEN = {
  // Passes whenever the window happens to be in the FOREGROUND, which is why the "now passes,
  // remove me" hint below fires on most local runs. Do not act on it: the entry is about a
  // backgrounded window, and removing it makes the gate red the first time Gate B runs with the
  // window behind something else. Foreground passes are not evidence the gap is closed.
  "presence animates during the turn":
    "measurement, not push: a backgrounded Electron window returns one composited frame (parity.md §2ag)",
  "deleted bot leaves the sidebar":
    "no per-agent delete event; wholesale {agents} list is flaky in the stock client (parity.md §2ag)",
};

const results = [];
const step = (name, pass, detail) => {
  const known = !pass && Object.hasOwn(KNOWN_OPEN, name);
  results.push({ name, pass, detail, known });
  const label = pass ? "PASS" : known ? "KNOWN" : "FAIL";
  const why = known ? `  — ${detail ? `${detail}; ` : ""}known: ${KNOWN_OPEN[name]}` : detail ? `  — ${detail}` : "";
  console.log(`${label}  ${name}${why}`);
  if (pass && Object.hasOwn(KNOWN_OPEN, name)) {
    console.log(`  ^ this is on the KNOWN_OPEN list and just PASSED — remove it from the list.`);
  }
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

const entryCount = async (id) => ((await gw("getAgentTranscriptTail", { agentId: id }))?.entries ?? []).length;

/**
 * Type into the composer and confirm the backend actually received the turn.
 *
 * The naive version — click, type, press Enter — worked for the first prompt of a session and
 * silently did nothing for the second, with identical code. Every downstream check then failed
 * (no tool ran, the answer on screen was the PREVIOUS turn's), so one dropped keystroke read as four
 * separate system faults. Returning what happened at each stage keeps the blame local: whether the
 * text landed in the composer at all, and whether the transcript grew.
 */
const sendViaUi = async (page, agentId, text) => {
  const before = await entryCount(agentId);
  const composer = page.locator('[contenteditable="true"]').last();
  await composer.click({ timeout: 5000 });
  await page.keyboard.type(text, { delay: 12 });

  const typed = (await composer.innerText().catch(() => "")).includes(text.slice(0, 24));
  await page.keyboard.press("Enter");

  let arrived = await until(async () => (await entryCount(agentId)) > before, 20_000);
  // One retry, and only after re-focusing: the observed failure is a lost focus/keystroke, not a
  // backend refusal, and a second Enter into an unfocused document would fail the same way.
  if (!arrived) {
    await composer.click({ timeout: 5000 }).catch(() => {});
    await page.keyboard.press("Enter");
    arrived = await until(async () => (await entryCount(agentId)) > before, 15_000);
  }
  return { typed, arrived: Boolean(arrived), before };
};

/**
 * Click the sidebar label, not an ancestor whose textContent also contains the name.
 *
 * `getByText(...).first()` is document order, so it can hit the app shell (click "succeeds",
 * conversation never switches). The row we want is the element that owns a text node with the
 * name, or the button/listitem wrapping it.
 */
const clickSidebarRow = async (page, name) => {
  // New bots append at the bottom of a crowded list. innerText still contains the name
  // (so "appears on screen" passes) while the row sits below the fold — a click at the
  // pre-scroll coordinates hits nothing useful. Scroll the row's overflow parent first.
  const box = await page.evaluate((n) => {
    const btn = [...document.querySelectorAll("button")].find((el) => (el.textContent || "").includes(n));
    if (!btn) return null;
    let scroller = btn.parentElement;
    while (scroller) {
      const s = getComputedStyle(scroller);
      if (/(auto|scroll)/.test(s.overflowY) && scroller.scrollHeight > scroller.clientHeight + 8) break;
      scroller = scroller.parentElement;
    }
    if (scroller) {
      const br = btn.getBoundingClientRect();
      const sr = scroller.getBoundingClientRect();
      scroller.scrollTop += br.top - sr.top - Math.min(80, sr.height / 4);
    } else {
      btn.scrollIntoView({ block: "center" });
    }
    const r = btn.getBoundingClientRect();
    if (r.width < 4 || r.height < 4 || r.top < 0 || r.top > window.innerHeight) return null;
    return { x: r.x + Math.min(40, r.width / 2), y: r.y + r.height / 2 };
  }, name);
  if (!box) return false;
  await page.mouse.click(box.x, box.y);
  return true;
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
  // Opening is proven by THIS agent's transcript growing. A Playwright click that does not
  // throw can still have hit an ancestor; "12" on the page can be some other conversation.
  await page.keyboard.press("Escape").catch(() => {});
  let clicked = false;
  let openErr = "";
  try {
    clicked = await clickSidebarRow(page, NAME);
  } catch (e) {
    openErr = String(e?.message ?? e).split("\n")[0].slice(0, 160);
  }

  let opened = false;
  if (clicked) {
    const first = await sendViaUi(page, agentId, "In ra dung hai chu so roi dung: 12");
    opened = first.arrived;
    step("the bot's conversation opens on click", opened,
      opened ? "prompt reached this agent" : first.typed
        ? `clicked, text typed, but this agent still has ${first.before} entries`
        : `clicked but keystrokes missed the composer (${openErr || "no locator error"})`);
    step("message accepted by the composer", first.typed);

    let replied = null;
    if (opened) {
      await waitIdle(agentId);
      const tail = await gw("getAgentTranscriptTail", { agentId, limit: 50 });
      const spoken = (tail?.entries ?? [])
        .filter((e) => e.kind === "send-message" && e.message?.type === "text")
        .map((e) => String(e.message?.content ?? "")).join("\n");
      const inTranscript = /(^|[^\d])12([^\d]|$)/.test(spoken);
      replied = inTranscript
        ? await until(async () => {
            const txt = await page.evaluate(() => document.body.innerText || "");
            return /(^|[^\d])12([^\d]|$)/.test(txt) ? "12 rendered" : null;
          }, 20_000)
        : null;
      step("the reply RENDERS in the transcript", Boolean(replied),
        replied ?? (inTranscript ? "in transcript but not rendered" : `model did not say 12 (${spoken.slice(0, 80) || "empty"})`));
    }
  } else {
    step("the bot's conversation opens on click", false, openErr || "sidebar row not clickable");
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
    // Count the transcript BEFORE typing, so we can tell "the prompt never arrived" apart from "the
    // prompt arrived and no tool ran". Without this the step reported `no completed tool-call in 60s`
    // for both, which points the blame at the model or the box when the actual failure was that Enter
    // did not submit — a harness fault reported as a system fault. Driving the same prompt straight
    // through `sendPrompt` on the gateway completed `list_dir_v2` against the box in 6.1s, which is
    // how we know the difference matters.
    const sent = await sendViaUi(page, agentId, "Dung cong cu list_dir_v2 xem thu muc . cua box, roi noi co bao nhieu muc.");
    step("the typed prompt reaches the backend", sent.arrived,
      sent.arrived ? `${sent.before} → grew` : sent.typed
        ? `text is in the composer but Enter never submitted (still ${sent.before} entries)`
        : `the keystrokes never reached the composer (still ${sent.before} entries)`);

    // Assert on the BACKEND transcript for the tool step (tool-call entries are deliberately not
    // rendered as bubbles — the client skips them, see chat.ts), and on the SCREEN for the answer.
    /*
     * Cùng lý do như bước trên: một thông điệp thất bại gộp hai nguyên nhân là thước đo chỉ đúng
     * một nửa. "no completed tool-call in 60s" đúng cả khi model KHÔNG GỌI tool (lỗi prompt/model)
     * và khi box CHẠY CHẬM (lỗi hạ tầng) — hai thứ sửa ở hai nơi khác nhau. Nên khi thất bại thì
     * báo lại đã thấy những tool-call nào ở trạng thái nào, còn khi thành công thì báo thời gian
     * thật, để ngưỡng dưới đây được đặt bằng số đo chứ không phải bằng cảm giác.
     *
     * Ngưỡng 60s làm gate đỏ 1/3 lần (3 lượt chạy ngày 2026-08-22: xanh / đỏ / xanh, cùng máy,
     * cùng patch). Một lượt là hai vòng model cộng một lần exec trên box, nên 60s là sát.
     */
    const TOOL_BUDGET_MS = 150_000;
    const toolStartedAt = Date.now();
    let lastSeen = "0 tool-call";
    const toolRan = await until(async () => {
      const t = await gw("getAgentTranscriptTail", { agentId });
      const calls = (t?.entries ?? []).filter((e) => e.kind === "tool-call");
      lastSeen = calls.length
        ? `${calls.length} tool-call: ${calls.map((c) => `${c.name}=${c.status}`).join(", ")}`
        : "0 tool-call — model không gọi tool nào";
      const done = calls.find((c) => c.status === "done");
      return done ? `${done.name} → ${String(done.result ?? "").split("\n")[0].slice(0, 40)}` : null;
    }, TOOL_BUDGET_MS);
    const toolMs = Date.now() - toolStartedAt;
    step("a tool actually ran against the box", Boolean(toolRan),
      toolRan
        ? `${toolRan}  [${(toolMs / 1000).toFixed(1)}s of ${TOOL_BUDGET_MS / 1000}s budget]`
        : `chờ ${(toolMs / 1000).toFixed(1)}s, thấy: ${lastSeen}`);

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
    //
    // Compared with markdown punctuation removed from BOTH sides, because the renderer legitimately
    // consumes it: an answer beginning ``Thư mục `.` có 24 mục`` reaches the screen as a code span
    // with no backticks in `innerText`, so a raw slice of the transcript text can never match and
    // the check reported "in transcript but not rendered" about a paragraph a human could read
    // (parity.md §2ag). Whitespace is collapsed for the same reason — wrapping is the renderer's.
    const plain = (s) => s.replace(/[`*_~#>]/g, "").replace(/\s+/g, " ").trim();
    const needle = plain(answered).slice(8, 34);
    const onScreen = needle
      ? await until(() => page.evaluate(
          ([s, src]) => {
            const flat = (document.body.innerText || "").replace(new RegExp(src, "g"), "").replace(/\s+/g, " ");
            return flat.includes(s);
          },
          [needle, "[`*_~#>]"],
        ), 20_000)
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
    await gw("deleteAgents", { ids: [agentId] }).catch(() => {});
    let gone = null;
    try {
      if (!page.isClosed()) {
        gone = await until(
          async () => !(await page.evaluate((n) => (document.body.innerText || "").includes(n), NAME)),
          15_000,
        );
      }
    } catch { /* CDP dropped; HTTP delete already went out */ }
    step("deleted bot leaves the sidebar", Boolean(gone) || page.isClosed(),
      gone ? "≤15s" : page.isClosed() ? "page closed after HTTP delete" : "still listed after 15s");
  }
  // Connected over CDP to the user's running app — browser.close() would kill it.
}

const failed = results.filter((r) => !r.pass && !r.known);
const known = results.filter((r) => r.known);
const fixed = results.filter((r) => r.pass && Object.hasOwn(KNOWN_OPEN, r.name));
console.log(`\n${results.filter((r) => r.pass).length}/${results.length} checks passed`);
if (known.length) {
  console.log(`\n${known.length} known-open (recorded, not counted as regressions):`);
  for (const k of known) console.log(`  ${k.name}  — ${KNOWN_OPEN[k.name]}`);
}
if (fixed.length) {
  console.log(`\n${fixed.length} known gap(s) now pass — take them off KNOWN_OPEN:`);
  for (const f of fixed) console.log(`  ${f.name}`);
}
if (failed.length) {
  console.log("\nfailed:");
  for (const f of failed) console.log(`  ${f.name}${f.detail ? `  — ${f.detail}` : ""}`);
}
/**
 * Mỗi lượt chạy để lại một dòng, KHÔNG ghi đè.
 *
 * Ngày 2026-08-22 check `a tool actually ran against the box` đỏ một lần giữa hai lượt xanh, và
 * nguyên nhân không truy được: gate chỉ lưu pass/fail mức script, còn chi tiết từng bước thì chỉ
 * có ở stdout của lượt đó và lượt xanh sau đã ghi đè bản ghi. Đây đúng là cái bẫy đã làm mất bằng
 * chứng vụ sáu bot bị ẩn — nên phần đo phải tự lưu vết, dạng nối thêm, không phải dạng ảnh chụp.
 *
 * Chỉ ghi tên + pass + detail. Không ghi nội dung hội thoại: file này nằm trong repo.
 */
const LOG = join(resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", ".."), "docs", "parity-runs", "gateB-history.jsonl");
try {
  mkdirSync(dirname(LOG), { recursive: true });
  appendFileSync(LOG, `${JSON.stringify({
    at: new Date().toISOString(),
    pass: failed.length === 0,
    passed: results.filter((r) => r.pass).length,
    total: results.length,
    steps: results.map((r) => ({ name: r.name, pass: r.pass, ...(r.known ? { known: true } : {}), ...(r.detail ? { detail: String(r.detail).slice(0, 160) } : {}) })),
  })}\n`);
} catch (e) {
  // Không để việc ghi log làm đỏ một lượt chạy vốn đã xanh.
  console.log(`(không ghi được gateB-history.jsonl: ${e instanceof Error ? e.message : e})`);
}

process.exit(failed.length === 0 ? 0 : 1);
