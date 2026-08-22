/**
 * The cron reader behind routines (`parseCron` · `matches` · `describe`).
 *
 * Named in docs/history/execution-roadmap.md as one of the pure functions worth testing first, and it earns
 * the place: every bug it can have is a routine that fires at the wrong time or never fires, and
 * neither shows up as an error. A schedule that silently never matches looks exactly like a user
 * who forgot to enable it.
 *
 * `describe()` is tested too, because the FE indexes that string as a search keyword — a wrong
 * description is a routine the user cannot find.
 *
 *   npx tsx --test src/cron.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCron, matches, describe as describeCron } from "./automations.js";

/**
 * Every schedule under test is pinned to UTC with `CRON_TZ=`.
 *
 * The first version of this file did not, and seven tests failed — correctly. Without a `CRON_TZ`
 * prefix, `fieldsIn()` reads the HOST's local wall clock (`d.getHours()`), and this machine runs at
 * UTC+7, so `2026-08-17T09:00:00Z` is 16:00 locally and `0 9 * * *` rightly did not fire. The code
 * was right and the test was making an unstated assumption. Pinning the zone makes these assertions
 * mean the same thing on any machine; the host-local behaviour gets its own test below.
 */
const at = (iso: string) => new Date(`${iso}Z`);
const fires = (expr: string, iso: string) => {
  const s = parseCron(`CRON_TZ=UTC ${expr}`);
  assert.ok(s, `"${expr}" must parse`);
  return matches(s, at(iso));
};

// ── parsing ───────────────────────────────────────────────────────────────────

test("a plain five-field expression parses", () => {
  assert.ok(parseCron("0 9 * * *"));
});

test("rubbish does not parse, and does not throw", () => {
  for (const bad of ["", "   ", "0 9 * *", "0 9 * * * *", "abc", "99 9 * * *", "0 25 * * *"]) {
    assert.equal(parseCron(bad), null, `"${bad}" must be rejected`);
  }
});

test("aliases parse", () => {
  for (const a of ["@hourly", "@daily", "@midnight", "@weekly", "@monthly", "@yearly", "@annually"]) {
    assert.ok(parseCron(a), `${a} must parse`);
  }
});

test("a CRON_TZ prefix is accepted and kept", () => {
  const s = parseCron("CRON_TZ=Asia/Ho_Chi_Minh 0 9 * * *");
  assert.ok(s);
  assert.equal(s.timeZone, "Asia/Ho_Chi_Minh");
});

// ── matching ──────────────────────────────────────────────────────────────────

test("9am daily fires at 9am and not at 10", () => {
  assert.equal(fires("0 9 * * *", "2026-08-17T09:00:00"), true);
  assert.equal(fires("0 9 * * *", "2026-08-17T10:00:00"), false);
  assert.equal(fires("0 9 * * *", "2026-08-17T09:01:00"), false);
});

test("*/15 fires on the quarter hours only", () => {
  for (const m of ["00", "15", "30", "45"]) {
    assert.equal(fires("*/15 * * * *", `2026-08-17T04:${m}:00`), true, `:${m} must fire`);
  }
  for (const m of ["01", "14", "31"]) {
    assert.equal(fires("*/15 * * * *", `2026-08-17T04:${m}:00`), false, `:${m} must not fire`);
  }
});

test("a range fires inside it and not outside", () => {
  assert.equal(fires("0 9-17 * * *", "2026-08-17T09:00:00"), true);
  assert.equal(fires("0 9-17 * * *", "2026-08-17T17:00:00"), true);
  assert.equal(fires("0 9-17 * * *", "2026-08-17T18:00:00"), false);
});

test("a list fires on each member", () => {
  assert.equal(fires("0 6,12,18 * * *", "2026-08-17T12:00:00"), true);
  assert.equal(fires("0 6,12,18 * * *", "2026-08-17T13:00:00"), false);
});

test("`5/10` means from 5 onwards, a bare `5` means exactly 5", () => {
  // The distinction is implemented explicitly in expand(); it is easy to lose in a refactor.
  assert.equal(fires("5/10 * * * *", "2026-08-17T04:05:00"), true);
  assert.equal(fires("5/10 * * * *", "2026-08-17T04:15:00"), true);
  assert.equal(fires("5 * * * *", "2026-08-17T04:15:00"), false);
});

test("day-of-week works NUMERICALLY (Monday = 1)", () => {
  // 2026-08-17 is a Monday.
  assert.equal(fires("0 9 * * 1", "2026-08-17T09:00:00"), true);
  assert.equal(fires("0 9 * * 2", "2026-08-17T09:00:00"), false);
});

test("⚠ day-of-week NAMES are not accepted — and describe() emits them anyway", () => {
  // Found by this test file, and left as a documented asymmetry rather than silently patched.
  //
  // `expand()` parses day-of-week with Number(), so "Mon" is NaN and the whole expression is
  // rejected. `DAY_NAMES` exists only to turn Intl's formatted weekday back into a number inside
  // fieldsIn() — it is not an input vocabulary. Meanwhile `describe()` renders the weekday as
  // "Mon" via ORDINAL, so the string this module PRINTS is not a string it can READ.
  //
  // Why it matters: `normaliseTrigger()` falls back to "0 9 * * *" for anything unparseable, so a
  // routine created with a named weekday would silently run daily at 9am instead. Whether the
  // client can ever send a name is unverified — automations.ts says the trigger is "exactly what
  // the client's own parser accepts", and that claim has not been checked against the bundle.
  assert.equal(parseCron("0 9 * * Mon"), null, "names are rejected today");
  assert.match(describeCron("0 9 * * 1"), /Mon/, "…yet describe() prints one");
});

test("when BOTH day fields are restricted, EITHER may match", () => {
  // Standard cron's oddest rule, and the one most likely to be 'simplified' by mistake.
  // 2026-08-17 is a Monday (5 = Friday) and the 17th.
  assert.equal(fires("0 9 17 * 5", "2026-08-17T09:00:00"), true, "day-of-month matches");
  assert.equal(fires("0 9 1 * 1", "2026-08-17T09:00:00"), true, "day-of-week matches");
  assert.equal(fires("0 9 1 * 5", "2026-08-17T09:00:00"), false, "neither matches");
});

test("when only ONE day field is restricted, it must match", () => {
  assert.equal(fires("0 9 17 * *", "2026-08-17T09:00:00"), true);
  assert.equal(fires("0 9 18 * *", "2026-08-17T09:00:00"), false);
  assert.equal(fires("0 9 * * 1", "2026-08-17T09:00:00"), true);
  assert.equal(fires("0 9 * * 0", "2026-08-17T09:00:00"), false);
});

test("with NO CRON_TZ the host's own wall clock decides", () => {
  // The behaviour that made the first draft of this file fail. Asserted relative to the host so it
  // holds anywhere: build a time that IS 09:00 locally, and check it fires.
  const local = new Date("2026-08-17T12:00:00Z");
  local.setHours(9, 0, 0, 0);
  const s = parseCron("0 9 * * *");
  assert.ok(s);
  assert.equal(s.timeZone, undefined, "no prefix means no zone recorded");
  assert.equal(matches(s, local), true, "09:00 local fires");
  const other = new Date(local);
  other.setHours(10);
  assert.equal(matches(s, other), false, "10:00 local does not");
});

test("a timezone shifts when the schedule fires", () => {
  // Calls parseCron directly: `fires()` prepends CRON_TZ=UTC, and two prefixes do not parse.
  // 09:00 in Ho Chi Minh (UTC+7) is 02:00 UTC.
  const s = parseCron("CRON_TZ=Asia/Ho_Chi_Minh 0 9 * * *");
  assert.ok(s);
  assert.equal(matches(s, at("2026-08-17T02:00:00")), true, "02:00 UTC is 09:00 in Saigon");
  assert.equal(matches(s, at("2026-08-17T09:00:00")), false, "09:00 UTC is 16:00 there");
});

test("two CRON_TZ prefixes do not parse — the trap this file walked into", () => {
  assert.equal(parseCron("CRON_TZ=UTC CRON_TZ=Asia/Ho_Chi_Minh 0 9 * * *"), null);
});

test("month is respected", () => {
  assert.equal(fires("0 9 17 8 *", "2026-08-17T09:00:00"), true);
  assert.equal(fires("0 9 17 9 *", "2026-08-17T09:00:00"), false);
});

// ── describe ──────────────────────────────────────────────────────────────────

test("describe says something useful, not the raw expression", () => {
  assert.notEqual(describeCron("0 9 * * *"), "0 9 * * *");
  assert.match(describeCron("0 9 * * *"), /9:00/);
  assert.match(describeCron("0 9 * * *"), /daily/);
});

test("describe names the weekday when the schedule is weekly", () => {
  assert.match(describeCron("0 9 * * 1"), /Mon/);
});

test("describe does not stutter on every-minute", () => {
  // "every minute daily" reads badly; the code drops the redundant half on purpose.
  const d = describeCron("* * * * *");
  assert.match(d, /every minute/);
  assert.doesNotMatch(d, /daily/);
});

test("describe carries the timezone when one is set", () => {
  assert.match(describeCron("CRON_TZ=Asia/Ho_Chi_Minh 0 9 * * *"), /Asia\/Ho_Chi_Minh/);
});

test("describe falls back to the raw string when it cannot parse", () => {
  assert.equal(describeCron("not a cron"), "not a cron");
});
