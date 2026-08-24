/**
 * Turning a demonstration into a routine prompt — see teach.ts.
 *
 * The recorder itself runs in the box's browser and is proved end to end by hand (start over the
 * gateway, demonstrate in the tab, stop and save, read the routine back). What is worth pinning here
 * is the part that decides what the replaying agent is told, because every mistake in it is silent:
 * a step that reads plausibly and points at the wrong control costs a wrong click on somebody's real
 * account, and a first step made of 900 characters of percent-encoding buries the real one.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { stepsToPrompt, IDLE, type Step } from "./teach.js";

/** The quality flag rides along on a step; the type keeps it optional so tests can be explicit. */
type S = Step & { quality?: string };

test("a demonstration becomes numbered steps an agent can follow", () => {
  const out = stepsToPrompt([
    { act: "navigate", url: "https://shop.test/products" },
    { act: "click", sel: "#search", quality: "id" },
    { act: "fill", sel: "#search", value: "nến thơm", quality: "id" },
    { act: "click", sel: "#add-to-cart", text: "Thêm vào giỏ", quality: "id" },
  ] as S[]);
  assert.match(out, /1\. mở https:\/\/shop\.test\/products/);
  assert.match(out, /2\. bấm `#search`/);
  assert.match(out, /3\. điền `#search` = "nến thơm"/);
  assert.match(out, /4\. bấm `#add-to-cart` \("Thêm vào giỏ"\)/);
  assert.match(out, /DỪNG/, "the agent is told to stop on a mismatch rather than improvise");
});

test("a weak selector is flagged, a strong one is not", () => {
  const out = stepsToPrompt([
    { act: "click", sel: "#pay", quality: "id" },
    { act: "click", sel: ".btn", quality: "class" },
    { act: "click", sel: "button", quality: "tag" },
  ] as S[]);
  const lines = out.split("\n").filter((l) => /^\d\./.test(l));
  assert.ok(!lines[0].includes("selector yếu"), "#id needs no warning");
  assert.ok(lines[1].includes("selector yếu"), ".class does");
  assert.ok(lines[2].includes("selector yếu"), "and a bare tag certainly does");
});

/**
 * A fresh tab sits on `about:blank`, and this project's own test pages are `data:` URLs. Recording
 * either as step 1 is worse than dropping it: it cannot be navigated back to, and a `data:` URL
 * pushed the real first action off the bottom of a wall of percent-encoding.
 */
test("about:blank and data: are not somewhere a replay can navigate back to", () => {
  const out = stepsToPrompt([
    { act: "navigate", url: "about:blank" },
    { act: "navigate", url: "data:text/html;charset=utf-8,%3Ch1%3Ehi%3C%2Fh1%3E" },
    { act: "click", sel: "#go", quality: "id" },
  ] as S[]);
  assert.ok(!out.includes("about:blank"), "not offered as a step");
  assert.ok(!out.includes("data:text/html"), "nor the data URL");
  assert.match(out, /^1\. bấm `#go`/m, "the first real action is numbered 1");
});

test("a long url is truncated so one step cannot swamp the list", () => {
  const long = `https://shop.test/a/${"x".repeat(400)}`;
  const out = stepsToPrompt([{ act: "navigate", url: long }] as S[]);
  const line = out.split("\n").find((l) => l.startsWith("1."))!;
  assert.ok(line.length < 140, `still readable, got ${line.length}`);
  assert.match(line, /…$/, "and says it was cut");
});

test("nothing recorded produces no prompt, so no empty routine is created", () => {
  assert.equal(stepsToPrompt([]), "");
  assert.equal(stepsToPrompt([{ act: "navigate", url: "about:blank" }] as S[]), "",
    "a lone unusable navigate is still nothing to replay");
});

test("the idle state matches the shape the renderer adopts verbatim", () => {
  assert.deepEqual(IDLE, { state: "idle", agentId: null, startedAtMs: null, maxDurationMs: 600_000 });
});
