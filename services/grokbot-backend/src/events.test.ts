/**
 * The bus is load-bearing for every frame the UI receives, so the three properties the SSE hub
 * relies on are pinned here: more than one listener, unsubscribe actually unsubscribes, and one
 * bad listener cannot take the publisher down with it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { publish, subscribe, type DomainEvent } from "./events.js";

test("every subscriber sees the event", () => {
  const a: DomainEvent[] = [];
  const b: DomainEvent[] = [];
  const offA = subscribe((e) => a.push(e));
  const offB = subscribe((e) => b.push(e));
  publish({ type: "transcript.append", agentId: "agent-1" });
  offA(); offB();
  assert.deepEqual(a, [{ type: "transcript.append", agentId: "agent-1" }]);
  assert.deepEqual(b, a);
});

test("unsubscribing stops delivery", () => {
  const seen: DomainEvent[] = [];
  const off = subscribe((e) => seen.push(e));
  publish({ type: "agent.upserted", agentId: "agent-1" });
  off();
  publish({ type: "agent.upserted" });
  assert.equal(seen.length, 1);
});

test("a subscriber that throws does not stop the others, or the publisher", () => {
  const seen: DomainEvent[] = [];
  const offBad = subscribe(() => { throw new Error("listener is broken"); });
  const offGood = subscribe((e) => seen.push(e));
  const errors = console.error;
  console.error = () => {};   // the throw is reported; the report is not what is under test
  try {
    publish({ type: "computer.status", agentId: "agent-1" });
  } finally {
    console.error = errors;
    offBad(); offGood();
  }
  assert.equal(seen.length, 1);
});
