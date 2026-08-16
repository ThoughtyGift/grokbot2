/**
 * Which affordances exist in the original app but not in the local build?
 *
 * The control diff is the honest capability gap: a feature the FE hides when the
 * backend answers "no" leaves no button behind, so a missing label is a missing feature.
 */
import { chromium } from "playwright-core";

const LABELS = () => {
  const norm = (s) => (s || "").trim().replace(/\s+/g, " ");
  const seen = new Map();
  for (const e of document.querySelectorAll("button,[role=button],[role=tab],[role=menuitem],[role=switch]")) {
    if (e.offsetParent === null) continue;
    const label = norm(e.innerText) || norm(e.getAttribute("aria-label")) || norm(e.title);
    if (!label || label.length > 48) continue;
    seen.set(label, (seen.get(label) ?? 0) + 1);
  }
  // Panels/regions the FE only mounts when the backend supports them.
  const regions = [...document.querySelectorAll("[data-testid],[aria-label]")]
    .filter((e) => e.offsetParent !== null)
    .map((e) => e.getAttribute("data-testid") || e.getAttribute("aria-label"))
    .filter((s) => s && s.length < 40);
  return { labels: [...seen.keys()].sort(), regions: [...new Set(regions)].sort() };
};

const grab = async (cdp) => {
  const b = await chromium.connectOverCDP(cdp, { timeout: 8000 });
  const p = b.contexts().flatMap((c) => c.pages()).find((x) => x.url().includes("renderer"));
  const r = await p.evaluate(LABELS);
  await b.close();
  return r;
};

const [local, goc] = await Promise.all([grab("http://127.0.0.1:9222"), grab("http://127.0.0.1:9333")]);
const only = (a, b) => a.filter((x) => !b.includes(x));

console.log("### ONLY IN GOC (original) — capability we do not offer");
for (const l of only(goc.labels, local.labels)) console.log("  +", l);
console.log("\n### ONLY IN LOCAL");
for (const l of only(local.labels, goc.labels)) console.log("  -", l);
console.log("\n### SHARED:", local.labels.filter((x) => goc.labels.includes(x)).length, "controls");
console.log("\n### REGIONS only in GOC");
for (const r of only(goc.regions, local.regions)) console.log("  +", r);
