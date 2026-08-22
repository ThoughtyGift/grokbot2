import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { completeTurn, completeTurnPlain } from "./brain.js";

function withRuntimeUrl<T>(url: string, fn: () => Promise<T>): Promise<T> {
  const prev = process.env.GROKBOT2_RUNTIME_URL;
  process.env.GROKBOT2_RUNTIME_URL = url;
  return fn().finally(() => {
    if (prev === undefined) delete process.env.GROKBOT2_RUNTIME_URL;
    else process.env.GROKBOT2_RUNTIME_URL = prev;
  });
}

test("a dead runtime is an error, not an in-process fallback", async () => {
  const r = await withRuntimeUrl("http://127.0.0.1:1", () =>
    completeTurnPlain([{ role: "user", content: "hi" }], { url: "http://example.invalid", key: "k" }),
  );
  assert.equal(r.ok, false);
  assert.match(r.error ?? "", /runtime down/i);
});

test("a reachable runtime returns its PoolResult JSON", async () => {
  const server = createServer((req, res) => {
    if ((req.url?.startsWith("/internal/turns") || req.url?.startsWith("/internal/complete")) && req.method === "POST") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, text: "from-runtime" }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("expected a TCP port");
  try {
    const r = await withRuntimeUrl(`http://127.0.0.1:${addr.port}`, () =>
      completeTurnPlain([{ role: "user", content: "hi" }], { url: "http://example.invalid", key: "k" }),
    );
    assert.equal(r.ok, true);
    assert.equal(r.text, "from-runtime");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("aborting the fetch is reported as aborted", async () => {
  const server = createServer(() => { /* hang until the client drops */ });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("expected a TCP port");
  const ac = new AbortController();
  const pending = withRuntimeUrl(`http://127.0.0.1:${addr.port}`, () =>
    completeTurnPlain([{ role: "user", content: "hi" }], {
      url: "http://example.invalid",
      key: "k",
      signal: ac.signal,
    }),
  );
  await new Promise((resolve) => setTimeout(resolve, 30));
  ac.abort();
  try {
    const r = await pending;
    assert.equal(r.ok, false);
    assert.equal(r.error, "aborted");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("NDJSON deltas from /internal/turns reach onDelta before done", async () => {
  const server = createServer((req, res) => {
    if (!req.url?.startsWith("/internal/turns") || req.method !== "POST") {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { "content-type": "application/x-ndjson" });
    res.write(`${JSON.stringify({ type: "delta", text: "hel" })}\n`);
    res.write(`${JSON.stringify({ type: "delta", text: "lo" })}\n`);
    res.end(`${JSON.stringify({ type: "done", ok: true, text: "hello", calls: [], incomplete: false })}\n`);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("expected a TCP port");
  const chunks: string[] = [];
  try {
    const r = await withRuntimeUrl(`http://127.0.0.1:${addr.port}`, () =>
      completeTurn([{ role: "user", content: "hi" }], { url: "http://example.invalid", key: "k" }, (c) => chunks.push(c)),
    );
    assert.equal(r.ok, true);
    assert.equal(r.text, "hello");
    assert.deepEqual(chunks, ["hel", "lo"]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
