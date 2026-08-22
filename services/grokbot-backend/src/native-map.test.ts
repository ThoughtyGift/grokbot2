import { test } from "node:test";
import assert from "node:assert/strict";
import { toNativeEntry, toNativeTranscriptPage } from "./native-map.js";
import type { Entry } from "./conversation/types.js";

test("user message maps to kind message", () => {
  const e: Entry = { id: "e1", seq: 1, kind: "message", role: "user", content: "hi", timestampMs: 1, clientNonce: "n1" };
  const n = toNativeEntry(e);
  assert.equal(n.kind, "message");
  assert.equal(n.role, "user");
  assert.equal(n.content, "hi");
  assert.equal(n.clientNonce, "n1");
});

test("assistant send-message maps to agent-message", () => {
  const e: Entry = {
    id: "e2", seq: 2, kind: "send-message",
    author: { id: "agent-1", name: "Claude" },
    message: { type: "text", content: "hello" },
    timestampMs: 2, streaming: true,
  };
  const n = toNativeEntry(e);
  assert.equal(n.kind, "agent-message");
  assert.equal(n.content, "hello");
  assert.equal(n.isStreaming, true);
  assert.deepEqual(n.author, { id: "agent-1", name: "Claude" });
});

test("tool-call keeps status and rawArgs", () => {
  const e: Entry = {
    id: "e3", seq: 3, kind: "tool-call", toolCallId: "tc1", name: "web_search",
    rawArgs: "{\"q\":\"x\"}", status: "running", timestampMs: 3, summary: "search",
  };
  const n = toNativeEntry(e);
  assert.equal(n.kind, "tool-call");
  assert.equal(n.toolCallId, "tc1");
  assert.equal(n.status, "running");
  assert.equal(n.rawArgs, "{\"q\":\"x\"}");
});

test("permission card maps to pending tool-call", () => {
  const e: Entry = {
    id: "e4", seq: 4, kind: "send-message",
    author: { id: "agent-1", name: "Claude" },
    message: { type: "local-tool-permission", ask: { status: "pending", target: "web_search", requestId: "req-9" } },
    timestampMs: 4,
  };
  const n = toNativeEntry(e);
  assert.equal(n.kind, "tool-call");
  assert.equal(n.toolCallId, "req-9");
  assert.equal(n.requestId, "req-9");
  assert.equal(n.needsApproval, true);
  assert.equal(n.status, "pending");
  assert.equal(n.name, "web_search");
});

test("user attachment maps to href under /v1/attachments", () => {
  const e: Entry = {
    id: "e6", seq: 6, kind: "message", role: "user", content: "",
    timestampMs: 6,
    message: { type: "attachment", url: "/workspace/attachments/1-x.png", file_name: "x.png", alt: "x" },
  };
  const n = toNativeEntry(e);
  assert.equal(n.kind, "message");
  assert.equal(n.attachment?.path, "/workspace/attachments/1-x.png");
  assert.equal(n.attachment?.name, "x.png");
  assert.equal(n.attachment?.href, "/v1/attachments?path=%2Fworkspace%2Fattachments%2F1-x.png");
});

test("ask_question widget keeps options instead of flattening to text", () => {
  const e: Entry = {
    id: "e7", seq: 7, kind: "send-message",
    author: { id: "agent-1", name: "Claude" },
    message: {
      type: "widget",
      widget: {
        prompt: "Chọn phương tiện?",
        helpText: "một lựa chọn",
        options: [
          { label: "Máy bay", value: "plane" },
          { label: "Tàu", value: "train", style: "primary" },
        ],
        allowCustom: true,
      },
    },
    timestampMs: 7,
  };
  const n = toNativeEntry(e);
  assert.equal(n.kind, "widget");
  assert.equal(n.content, "Chọn phương tiện?");
  assert.equal(n.widget?.prompt, "Chọn phương tiện?");
  assert.equal(n.widget?.helpText, "một lựa chọn");
  assert.equal(n.widget?.allowCustom, true);
  assert.deepEqual(n.widget?.options, [
    { label: "Máy bay", value: "plane" },
    { label: "Tàu", value: "train", style: "primary" },
  ]);
  assert.equal(n.respondedValue, undefined);
});

test("answered widget keeps respondedValue", () => {
  const e: Entry = {
    id: "e8", seq: 8, kind: "send-message",
    author: { id: "agent-1", name: "Claude" },
    message: {
      type: "widget",
      widget: { prompt: "Ok?", options: [{ label: "Có", value: "yes" }] },
    },
    timestampMs: 8,
    respondedValue: "yes",
  };
  const n = toNativeEntry(e);
  assert.equal(n.kind, "widget");
  assert.equal(n.respondedValue, "yes");
});

test("name-changed event keeps type", () => {
  const e: Entry = {
    id: "e5", seq: 5, kind: "event",
    event: { type: "name-changed", from: "A", to: "B" },
    timestampMs: 5,
  };
  const n = toNativeEntry(e);
  assert.equal(n.kind, "event");
  assert.equal(n.event?.type, "name-changed");
});

test("permission card folds into the preceding tool-call", () => {
  const tool: Entry = {
    id: "tc1", seq: 1, kind: "tool-call",
    toolCallId: "call-1", name: "create_agent", rawArgs: "{}", status: "pending", timestampMs: 1,
  };
  const perm: Entry = {
    id: "p1", seq: 2, kind: "send-message",
    author: { id: "agent-1", name: "Claude" },
    message: { type: "local-tool-permission", ask: { status: "pending", target: "create_agent", requestId: "req-1" } },
    timestampMs: 2,
  };
  const page = toNativeTranscriptPage([tool, perm], false);
  assert.equal(page.entries.length, 1);
  assert.equal(page.entries[0].kind, "tool-call");
  assert.equal(page.entries[0].toolCallId, "call-1");
  assert.equal(page.entries[0].requestId, "req-1");
  assert.equal(page.entries[0].needsApproval, true);
  assert.equal(page.entries[0].status, "pending");
});
