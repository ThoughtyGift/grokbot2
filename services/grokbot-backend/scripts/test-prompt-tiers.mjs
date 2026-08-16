/**
 * Prompt tier tests.
 *
 * The point of the tiering is cache stability, and that is exactly the property that
 * breaks silently: nothing errors when a timestamp leaks into the stable tier, the bill
 * and the latency just go up. So the load-bearing assertions here are about the PREFIX,
 * not about wording.
 */
import { buildSystemPrompt, stableTier, contextTier, volatileTier } from "../src/prompt.ts";

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? "  ok  " : "  FAIL"} ${name}${ok ? "" : `  got=${JSON.stringify(got)?.slice(0, 120)} want=${JSON.stringify(want)?.slice(0, 120)}`}`);
};
const TP = "\n\nTOOLS: none";
/** Longest shared prefix — what a provider can actually reuse between two turns. */
const sharedPrefix = (a, b) => {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  return i;
};

const t1 = new Date("2026-08-16T10:00:00Z");
const t2 = new Date("2026-08-16T11:47:00Z");
const base = { agentName: "Alpha", boxOn: false, browserOn: false, timeZone: "Asia/Ho_Chi_Minh" };

console.log("tier order");
const full = buildSystemPrompt(TP, { ...base, now: t1 });
check("stable comes first", full.startsWith(stableTier(TP).trim().slice(0, 60)), true);
check("volatile comes last", full.trim().endsWith(volatileTier({ ...base, now: t1 }).trim()), true);
check("context sits between", full.indexOf("Alpha") > 0 && full.indexOf("Alpha") < full.lastIndexOf("Bây giờ"), true);

console.log("\ncache stability — the reason the tiers exist");
const later = buildSystemPrompt(TP, { ...base, now: t2 });
check("only the tail differs when time moves", sharedPrefix(full, later) > full.length - 120, true);
check("the two prompts are not identical", full === later, false);
check("no timestamp leaks into the stable tier", /Bây giờ|\d{4}/.test(stableTier(TP)), false);
check("stable tier is identical across turns", stableTier(TP) === stableTier(TP), true);

console.log("\ncontext tier states the real workspace");
check("no box: says so plainly", /chưa nối box|KHÔNG chạy được lệnh/.test(contextTier({ boxOn: false })), true);
check("no box: does not promise a shell", /Bạn có: shell/.test(contextTier({ boxOn: false })), false);
check("box on: names the shell", /shell và file trong box/.test(contextTier({ boxOn: true })), true);
check("browser on: names the browser", /trình duyệt trong box/.test(contextTier({ boxOn: true, browserOn: true })), true);
check("agent name is used", contextTier({ agentName: "Beta" }).includes('"Beta"'), true);
check("no agent name: no empty quotes", contextTier({}).includes('""'), false);

console.log("\nvolatile tier");
check("renders the zone it was given", volatileTier({ timeZone: "Asia/Ho_Chi_Minh", now: t1 }).includes("Asia/Ho_Chi_Minh"), true);
// 10:00 UTC is 17:00 in Ho Chi Minh — proves the zone is applied, not just printed.
check("applies the zone to the clock", /17:00/.test(volatileTier({ timeZone: "Asia/Ho_Chi_Minh", now: t1 })), true);
check("falls back to UTC when unset", volatileTier({ now: t1 }).includes("UTC"), true);
check("bad zone falls back instead of throwing", volatileTier({ timeZone: "Not/AZone", now: t1 }).includes("UTC"), true);
check("volatile tier stays small", volatileTier({ ...base, now: t1 }).length < 120, true);

console.log("\nassembly");
check("no blank block between tiers", /\n{3,}/.test(buildSystemPrompt(TP, base)), false);
check("tool protocol is inside the stable tier", stableTier(TP).endsWith(TP), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
