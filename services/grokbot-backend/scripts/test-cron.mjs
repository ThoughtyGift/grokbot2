/**
 * Cron unit tests — the scheduler is the one part that fails silently when wrong
 * (a routine that never fires looks identical to a routine nobody triggered).
 */
import { parseCron, matches, describe as describeCron } from "../src/automations.ts";

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const ok = got === want;
  ok ? pass++ : fail++;
  console.log(`${ok ? "  ok  " : "  FAIL"} ${name}${ok ? "" : `  got=${got} want=${want}`}`);
};
/** Build a UTC instant so timezone-free cases are deterministic on any machine. */
const at = (iso) => new Date(iso);
const fires = (cron, iso) => {
  const s = parseCron(cron);
  return s ? matches(s, at(iso)) : null;
};

console.log("parse");
check("5 fields required", parseCron("0 8 * *"), null);
check("garbage rejected", parseCron("hello"), null);
check("bad range rejected", parseCron("99 * * * *"), null);
check("bad timezone rejected", parseCron("CRON_TZ=Not/AZone 0 8 * * *"), null);
check("alias @daily", parseCron("@daily") !== null, true);
check("alias is case-insensitive", parseCron("@DAILY") !== null, true);
check("TZ= prefix", parseCron("TZ=UTC 0 8 * * *")?.timeZone, "UTC");
check("CRON_TZ= prefix", parseCron("CRON_TZ=Asia/Ho_Chi_Minh 0 8 * * *")?.timeZone, "Asia/Ho_Chi_Minh");
check("extra spaces tolerated", parseCron("  0   8  *  *  * ") !== null, true);

console.log("\nmatch (UTC)");
check("daily 08:00 hits", fires("TZ=UTC 0 8 * * *", "2026-08-17T08:00:00Z"), true);
check("daily 08:00 misses 08:01", fires("TZ=UTC 0 8 * * *", "2026-08-17T08:01:00Z"), false);
check("every minute", fires("TZ=UTC * * * * *", "2026-08-17T13:37:00Z"), true);
check("step */15 hits :30", fires("TZ=UTC */15 * * * *", "2026-08-17T09:30:00Z"), true);
check("step */15 misses :31", fires("TZ=UTC */15 * * * *", "2026-08-17T09:31:00Z"), false);
check("list 0,30 hits :30", fires("TZ=UTC 0,30 * * * *", "2026-08-17T09:30:00Z"), true);
check("range 9-17 hits 14", fires("TZ=UTC 0 9-17 * * *", "2026-08-17T14:00:00Z"), true);
check("range 9-17 misses 18", fires("TZ=UTC 0 9-17 * * *", "2026-08-17T18:00:00Z"), false);
check("from-5-step-10 hits 25", fires("TZ=UTC 5/10 * * * *", "2026-08-17T09:25:00Z"), true);

console.log("\nday semantics");
// 2026-08-17 is a Monday.
check("dow Mon hits", fires("TZ=UTC 0 8 * * 1", "2026-08-17T08:00:00Z"), true);
check("dow Mon misses Tue", fires("TZ=UTC 0 8 * * 1", "2026-08-18T08:00:00Z"), false);
check("dow 7 == Sunday", fires("TZ=UTC 0 8 * * 7", "2026-08-16T08:00:00Z"), true);
check("dom 17 hits", fires("TZ=UTC 0 8 17 * *", "2026-08-17T08:00:00Z"), true);
// Both restricted -> OR, per standard cron.
check("dom OR dow (dom side)", fires("TZ=UTC 0 8 17 * 5", "2026-08-17T08:00:00Z"), true);
check("dom OR dow (dow side)", fires("TZ=UTC 0 8 1 * 1", "2026-08-17T08:00:00Z"), true);
check("dom AND dow both miss", fires("TZ=UTC 0 8 1 * 5", "2026-08-17T08:00:00Z"), false);
check("month restricted misses", fires("TZ=UTC 0 8 * 12 *", "2026-08-17T08:00:00Z"), false);

console.log("\ntimezone");
// 08:00 in Ho Chi Minh (UTC+7) is 01:00 UTC.
check("VN 08:00 == 01:00Z", fires("CRON_TZ=Asia/Ho_Chi_Minh 0 8 * * *", "2026-08-17T01:00:00Z"), true);
check("VN 08:00 != 08:00Z", fires("CRON_TZ=Asia/Ho_Chi_Minh 0 8 * * *", "2026-08-17T08:00:00Z"), false);
// Crossing midnight: 07:00 VN Mon = 00:00Z Mon, but 06:00 VN Mon = 23:00Z Sunday.
check("VN Monday from UTC Sunday", fires("CRON_TZ=Asia/Ho_Chi_Minh 0 6 * * 1", "2026-08-16T23:00:00Z"), true);

console.log("\ndescribe");
check("daily", describeCron("TZ=UTC 0 8 * * *"), "8:00 daily (UTC)");
check("unparsable passes through", describeCron("nonsense"), "nonsense");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
