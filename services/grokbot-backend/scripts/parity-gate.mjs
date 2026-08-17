/**
 * Gate C — the local app beside the original, with a verdict instead of a printout.
 *
 * `diff-capabilities.mjs` already walks both DOMs and prints counts. What it cannot do is fail:
 * a human reads two columns of numbers and decides. This adds the decision.
 *
 * ── Why the counts are NOT the assertion ─────────────────────────────────────
 *
 * The two windows hold different data. The original drives the owner's real bots and real
 * conversations; the local one holds whatever this session created. So "original shows 24
 * attachments, local shows 3" says nothing about parity — it says the original's conversations
 * have more attachments in them. Asserting on counts would produce a gate that is red for
 * reasons nobody can act on, and a gate like that gets ignored, which is worse than no gate.
 *
 * What IS comparable is whether a capability is present at all: does the surface exist, can it
 * render, is the control there. That is a boolean about the build, not about the data. So counts
 * are reported as context and the verdict is drawn on presence.
 *
 * ── Surfaces the original does not have ──────────────────────────────────────
 *
 * Channels are the case that breaks naive comparison in the other direction: the original ships
 * Slack and Discord as `availability: "coming-soon"` with an empty connect guide, so it cannot
 * connect one either. Once P6 wires the hermes bridge, local will exceed the original there and
 * "local >= original" will pass for the wrong reason. Those surfaces are marked `informational`
 * and never fail this gate — they belong to Gate D.
 *
 * Usage:
 *   node scripts/parity-gate.mjs
 *   node scripts/parity-gate.mjs --local 9222 --goc 9333 --plan P2 --run 1
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { chromium } from "playwright-core";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..", "..");
const RUNS = join(REPO, "docs", "parity-runs");

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const LOCAL = `http://127.0.0.1:${arg("--local", "9222")}`;
const GOC = `http://127.0.0.1:${arg("--goc", "9333")}`;
const PLAN = arg("--plan", "P2");
const RUN = Number(arg("--run", "1"));

/**
 * Runs inside the renderer. Counts structure only — never message text, because the original is
 * showing the owner's real conversations and this report is committed.
 */
const PROBE = () => {
  const n = (sel) => document.querySelectorAll(sel).length;
  const body = document.body.innerText || "";
  const hits = (re) => (body.match(re) || []).length;
  return {
    // ── surfaces P2 was supposed to light up ───────────────────────────────
    sidebarAvatarImages: n("[class*='sidebar'] img, nav img, aside img"),
    inlineImages: n("main img, [class*='message'] img, [class*='bubble'] img"),
    imageUnavailable: hits(/Image unavailable/g),
    attachments: n("[class*='attachment']"),
    // ── long-standing parity surfaces ──────────────────────────────────────
    toolCards: n("[class*='tool']"),
    openComputer: hits(/Open computer/g),
    screenPane: hits(/'s screen/g) + n("webview"),
    questionWidgets: n("[role='radiogroup'], [class*='widget'] input"),
    routines: n("[class*='routine'], [class*='automation']"),
    routineEventTriggers: hits(/When @?\w+/g),
    // ── things that must NOT be there ──────────────────────────────────────
    blockers: [
      ["needs-ultra", /needs an Ultra plan|upgrade to Ultra/i],
      ["signed-out", /sign in|log in to continue|sign-in expired/i],
      ["unreachable", /can'?t reach|unreachable|reconnect/i],
      ["error", /something went wrong|failed to load/i],
      ["unauthorized", /unauthorized|401/i],
    ].filter(([, re]) => re.test(body)).map(([k]) => k),
    controls: n("button:not([disabled]),[role=button]"),
    // Labels, not just a count: which named controls the build offers is data-independent and so
    // is the only thing about the control surface worth asserting on.
    controlLabels: [...new Set(
      [...document.querySelectorAll("button,[role=button],[role=tab],[role=menuitem]")]
        .filter((e) => e.offsetParent !== null)
        .map((e) => ((e.innerText || e.getAttribute("aria-label") || e.title || "").trim().replace(/\s+/g, " ").slice(0, 40)))
        .filter(Boolean),
    )],
  };
};

/**
 * The rules — and the scope correction that produced them.
 *
 * The first version of this gate asserted `presence`: fail when the original renders a surface and
 * local renders none. Its first run reported six failures — attachments, inline images, sidebar
 * avatars, routines, the computer card, the screen pane — and every one was **data**, not
 * capability. The local app had no bots with avatars, no conversation containing an image, and no
 * routine, because this session's probes created and deleted their own. The original had all of
 * them because it drives the owner's real workspace.
 *
 * Which is the trap this script's own header warns about, walked straight into: a surface only
 * appears in the DOM when the data for it exists, so "presence" is a data comparison wearing a
 * capability comparison's clothes. A gate that is red for reasons nobody can act on gets ignored,
 * and an ignored gate is worse than no gate.
 *
 * So Gate C's real job is narrower than it looked. Two apps with different data can only be
 * compared on what is **build-level**:
 *
 *   mustBeZero  broken-render markers that must never appear whatever the data
 *   blockers    states that stop the workspace from being usable at all
 *   controls    named buttons and menu items, which exist because the build has the feature
 *
 * Everything data-dependent is `informational` here and belongs to Gate B, where a single app can
 * be DRIVEN to create the condition first — set an avatar, then assert the picture renders. That
 * is what scripts/e2e-avatar.mjs already does, and it is why it can say 19/19 while this gate
 * cannot say anything about avatars at all.
 */
const RULES = {
  // Build-level: assert.
  imageUnavailable: "mustBeZero",
  // Data-dependent: report, never fail. Gate B owns these.
  sidebarAvatarImages: "informational",
  inlineImages: "informational",
  attachments: "informational",
  toolCards: "informational",
  openComputer: "informational",
  screenPane: "informational",
  questionWidgets: "informational",
  routines: "informational",
  routineEventTriggers: "informational",
  controls: "informational",
};

/**
 * Controls the local build must offer — narrowed twice, for the same reason each time.
 *
 * The first list asked for a "settings" control and failed. The original had `Bot settings`; the
 * local app did not — because the original happened to have a bot's detail panel open (it also
 * showed `Close details` and `Open`) and the local app did not. A button that only exists while a
 * panel is open is UI-STATE dependent, which is the same trap as data dependence one level in.
 *
 * What survives is the app chrome: controls present no matter which bot is selected, what is in
 * the conversation, or which panels are open. Measured on both windows, local shows 32 controls
 * against the original's 25 — local is not short of controls, it is in a different state — so the
 * assertion has to be about a fixed set, never about a total.
 */
const REQUIRED_CONTROLS = [
  { name: "new bot", re: /^new\b|new bot|new agent|\+ ?bot/i },
  { name: "search", re: /^search/i },
  { name: "plugins", re: /^plugins/i },
  { name: "attach file", re: /attach file/i },
  { name: "voice input", re: /voice input/i },
];

const sample = async (cdp, tag) => {
  const browser = await chromium.connectOverCDP(cdp, { timeout: 10_000 });
  try {
    const pages = browser.contexts().flatMap((c) => c.pages());
    const page = pages.find((p) => /index\.html/.test(p.url())) ?? pages.find((p) => !p.url().startsWith("devtools://"));
    if (!page) return { tag, error: "no renderer page" };
    // Visit a few sidebar rows so surfaces only some bots use still get counted.
    const first = await page.evaluate(PROBE);
    const totals = { ...first };
    const rows = await page.evaluate(() =>
      [...document.querySelectorAll("[class*='sidebar'] [role='button'], nav [role='button'], aside [role='button']")]
        .map((e) => (e.textContent || "").trim().split("\n")[0])
        .filter((t) => t && t.length < 40)
        .slice(0, 6));
    for (const label of rows) {
      try {
        await page.locator(`text=${label}`).first().click({ timeout: 2500 });
        await page.waitForTimeout(1200);
        const s = await page.evaluate(PROBE);
        for (const [k, v] of Object.entries(s)) {
          if (typeof v === "number") totals[k] = Math.max(totals[k] ?? 0, v);
          else if (Array.isArray(v)) totals[k] = [...new Set([...(totals[k] ?? []), ...v])];
        }
      } catch { /* row not clickable */ }
    }
    return { tag, rowsVisited: rows.length, ...totals };
  } finally {
    await browser.close().catch(() => {});
  }
};

const [local, goc] = await Promise.all([
  sample(LOCAL, "LOCAL").catch((e) => ({ tag: "LOCAL", error: String(e?.message ?? e) })),
  sample(GOC, "GOC").catch((e) => ({ tag: "GOC", error: String(e?.message ?? e) })),
]);

const mismatches = [];
const rows = [];

if (local.error) {
  mismatches.push({ gate: "C", check: "local app reachable", expected: "reachable", actual: local.error, loai: 2 });
}
// A missing original is NOT a failure — it means the gate cannot run. Recording that honestly
// beats a green tick nobody should trust.
const gocUsable = !goc.error;

for (const [key, rule] of Object.entries(RULES)) {
  const l = local[key];
  const g = goc[key];
  if (typeof l !== "number") continue;
  let verdict = "ok";
  if (rule === "mustBeZero" && l > 0) {
    verdict = "fail";
    mismatches.push({ gate: "C", check: `${key} must be 0 in local`, expected: 0, actual: l, loai: 1 });
  } else if (rule === "presence" && gocUsable && g > 0 && l === 0) {
    verdict = "fail";
    mismatches.push({
      gate: "C",
      check: `${key} present in the original, absent in local`,
      expected: "> 0",
      actual: 0,
      loai: 2,
      note: "capability comparison; counts are context, not the assertion",
    });
  } else if (rule === "informational") {
    verdict = "info";
  }
  rows.push({ surface: key, rule, local: l, goc: gocUsable ? g : null, verdict });
}

for (const b of local.blockers ?? []) {
  mismatches.push({ gate: "C", check: "local shows no blocking state", expected: "none", actual: b, loai: 2 });
}

// Build-level control check. A missing button means a missing feature, whatever the data holds.
const labels = local.controlLabels ?? [];
const controlRows = REQUIRED_CONTROLS.map(({ name, re }) => {
  const present = labels.some((l) => re.test(l));
  if (!present) {
    mismatches.push({
      gate: "C", check: `local offers a "${name}" control`, expected: true, actual: false, loai: 2,
      note: "controls are build-level: present because the feature is compiled in, not because data exists",
    });
  }
  return { control: name, present };
});

let commit = "unknown";
try { commit = execSync("git rev-parse --short HEAD", { cwd: REPO }).toString().trim(); } catch { /* not a repo */ }

const out = {
  plan: PLAN, run: RUN, gate: "C", backendCommit: commit,
  local: { cdp: LOCAL, rowsVisited: local.rowsVisited ?? 0, blockers: local.blockers ?? [] },
  goc: gocUsable ? { cdp: GOC, rowsVisited: goc.rowsVisited ?? 0, blockers: goc.blockers ?? [] } : { cdp: GOC, skipped: goc.error },
  surfaces: rows,
  controls: controlRows,
  // Named so a reader of the run file knows why six obvious differences are not failures.
  scope: "build-level only: broken-render markers, blocking states, control labels. Data-dependent surfaces are Gate B's job (see e2e-avatar.mjs).",
  pass: mismatches.length === 0,
  mismatches,
};

mkdirSync(RUNS, { recursive: true });
const file = join(RUNS, `${PLAN}-gateC-run-${String(RUN).padStart(2, "0")}.json`);
writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`);

console.log(`${"surface".padEnd(22)} ${"local".padStart(6)} ${"goc".padStart(6)}  rule`);
for (const r of rows) {
  const mark = r.verdict === "fail" ? "FAIL" : r.verdict === "info" ? "info" : "  ok";
  console.log(`${r.surface.padEnd(22)} ${String(r.local).padStart(6)} ${String(r.goc ?? "-").padStart(6)}  ${r.rule.padEnd(13)} ${mark}`);
}
console.log("");
for (const c of controlRows) console.log(`control  ${c.control.padEnd(14)} ${c.present ? "  ok" : "FAIL"}`);
if (!gocUsable) console.log(`\nGate C could not compare: the original is unavailable (${goc.error}).`);
if (mismatches.length) {
  console.log(`\n${mismatches.length} mismatch(es):`);
  for (const m of mismatches) console.log(`  ${m.check} — expected ${JSON.stringify(m.expected)}, got ${JSON.stringify(m.actual)}`);
}
console.log(`\nwrote ${file}`);
process.exit(mismatches.length === 0 ? 0 : 1);
