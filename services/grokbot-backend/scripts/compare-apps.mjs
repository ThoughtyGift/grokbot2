/**
 * Side-by-side capability diff between the two running instances.
 *
 * Reads the live DOM of each window rather than trusting the method table:
 * a method can be "implemented" and still leave its feature dead in the UI.
 */
import { chromium } from "playwright-core";

const TARGETS = [
  { tag: "LOCAL", cdp: process.env.CDP_LOCAL ?? "http://127.0.0.1:9222" },
  { tag: "GOC", cdp: process.env.CDP_GOC ?? "http://127.0.0.1:9333" },
];

/** Runs inside the renderer: describe what the user can actually see and click. */
const PROBE = () => {
  const txt = (document.body.innerText || "").replace(/\s+/g, " ");
  const norm = (s) => (s || "").trim().replace(/\s+/g, " ").slice(0, 60);

  const clickable = [...document.querySelectorAll("button,[role=button],[role=tab],[role=menuitem]")]
    .filter((e) => e.offsetParent !== null)
    .map((e) => ({
      label: norm(e.innerText) || norm(e.getAttribute("aria-label")) || norm(e.title),
      disabled: e.disabled === true || e.getAttribute("aria-disabled") === "true",
    }))
    .filter((b) => b.label);

  return {
    title: document.title,
    url: location.href,
    // Blocking states the app puts in front of the workspace.
    blockers: [
      ["needs-ultra", /needs an Ultra plan|upgrade to Ultra/i],
      ["signed-out", /sign in|log in to continue|sign-in expired/i],
      ["unreachable", /can'?t reach|unreachable|reconnect/i],
      ["error", /something went wrong|failed to load/i],
    ].filter(([, re]) => re.test(txt)).map(([k]) => k),
    // Feature surfaces, detected by the controls the FE renders for them.
    surfaces: Object.fromEntries(
      Object.entries({
        roster: /new bot|new agent|\+ bot/i,
        composer: /message|ask anything|send a message/i,
        computer: /open computer|computer|screen/i,
        skills: /skill/i,
        workflows: /workflow/i,
        automations: /automation|schedule/i,
        channels: /channel|connect/i,
        share: /share|invite/i,
        settings: /settings|preferences/i,
        search: /search/i,
      }).map(([k, re]) => [k, clickable.some((b) => re.test(b.label))])
    ),
    controls: clickable.length,
    disabledControls: clickable.filter((b) => b.disabled).map((b) => b.label),
    textHead: txt.slice(0, 400),
  };
};

const inspect = async ({ tag, cdp }) => {
  try {
    const browser = await chromium.connectOverCDP(cdp, { timeout: 8000 });
    const pages = browser.contexts().flatMap((c) => c.pages());
    const out = [];
    for (const p of pages) {
      const u = p.url();
      if (u.startsWith("devtools://") || u === "about:blank") continue;
      try {
        out.push({ ...(await p.evaluate(PROBE)) });
      } catch (e) {
        out.push({ url: u, error: String(e).slice(0, 120) });
      }
    }
    await browser.close();
    return { tag, cdp, pages: out };
  } catch (e) {
    return { tag, cdp, error: String(e).slice(0, 200) };
  }
};

const results = await Promise.all(TARGETS.map(inspect));
console.log(JSON.stringify(results, null, 2));
