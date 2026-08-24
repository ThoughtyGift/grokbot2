/**
 * A routine must not fire into a bot that no longer exists.
 *
 * Found by looking, not by reasoning: four routines were live on this install and none of their bots
 * were in the roster — `agent-256`, `258`, `275`, `276` are all gone. One of them carries the cron
 * `0 9 * * *`, so once a day it sent a prompt into a conversation nobody could read and spent a pool
 * call doing it. `bindAutomationCleanup` is supposed to drop routines with their agent, and these
 * predate it; the scheduler should not depend on that having worked.
 *
 * The routine is NOT deleted here. A lookup that misses once — a restore still in flight, a rename
 * in progress — must not destroy somebody's routine; the run is recorded as failed so the panel can
 * say why, and a human decides whether it should go.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { join } from "node:path";

const DATA = process.env.GROKBOT2_DATA_DIR ?? join(import.meta.dirname, "..", ".data");

let automations: typeof import("./automations.js");
let state: typeof import("./chat/state.js");
let chat: typeof import("./chat.js");

before(async () => {
  state = await import("./chat/state.js");
  chat = await import("./chat.js");
  automations = await import("./automations.js");
});

after(() => {
  // The suite runs against a throwaway store (scripts/run-tests.mjs); this is belt and braces.
  try { rmSync(join(DATA, "orphan-test"), { recursive: true, force: true }); } catch { /* nothing to clean */ }
});

test("agentExists tells the truth about a bot that was never created", () => {
  assert.equal(state.agentExists("agent-does-not-exist"), false);
});

test("firing a routine whose bot is gone records a failed run and sends nothing", () => {
  const created = automations.createAgentAutomation({
    id: "agent-gone-forever",
    spec: { name: "Mồ côi", prompt: "việc gì đó", trigger: "0 9 * * *" },
  });
  const routine = created[created.length - 1];
  assert.ok(routine, "the routine is created even for an unknown agent — that is not this fix");

  // fireById returns true because the ROUTINE exists; what matters is what it did.
  assert.equal(automations.fireById(routine.id, "manual"), true);

  const after = automations.listAllAutomations().find((r) => r.id === routine.id);
  assert.equal(after?.runs[0]?.status, "failed", "the panel has to be able to say why nothing happened");
  assert.ok(after, "and the routine itself is left alone, not deleted behind the user's back");
});

test("a routine on a bot that exists still fires normally", () => {
  const agent = chat.createAgent({ name: "Có thật" });
  assert.equal(state.agentExists(agent.id), true);

  const created = automations.createAgentAutomation({
    id: agent.id,
    spec: { name: "Bình thường", prompt: "chào", trigger: "0 9 * * *" },
  });
  const routine = created[created.length - 1];
  assert.equal(automations.fireById(routine.id, "manual"), true);

  const after = automations.listAllAutomations().find((r) => r.id === routine.id);
  assert.notEqual(after?.runs[0]?.status, "failed", "this is the path the guard must not break");
});
