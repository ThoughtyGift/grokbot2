/**
 * `google.protobuf.Struct` round trip.
 *
 * Two Plugin fields ride on this, and both fail invisibly if the encoding is wrong: a malformed
 * `variables` means the client shows no credential form (and the plugin looks like it needs none),
 * and a misread `InstallUserPluginRequest.variables` means the values someone typed are silently
 * dropped and the server starts unauthenticated. Neither raises an error anywhere — hence a test.
 *
 *   npx tsx --test src/struct.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { struct, pbStruct, parseStruct, readStringMapField } from "./struct.js";
import { message, pbStr } from "./encode.js";

const trip = (o: Record<string, unknown>) => parseStruct(struct(o as never));

test("strings survive, including empty and non-ASCII", () => {
  assert.deepEqual(trip({ a: "x", b: "", c: "Đường dẫn — ✓" }), { a: "x", b: "", c: "Đường dẫn — ✓" });
});

test("the other scalar kinds survive", () => {
  assert.deepEqual(trip({ n: 42, f: 1.5, t: true, f2: false, z: null }),
    { n: 42, f: 1.5, t: true, f2: false, z: null });
});

test("a nested object survives — JSON Schema puts every field under `properties`", () => {
  const schema = {
    properties: { FACEBOOK_ACCESS_TOKEN: { type: "string", title: "Page access token" } },
    required: ["FACEBOOK_ACCESS_TOKEN"],
  };
  assert.deepEqual(trip(schema), schema);
});

test("an array of strings survives — `required` is one", () => {
  assert.deepEqual(trip({ required: ["A", "B"] }), { required: ["A", "B"] });
});

test("an empty object and an empty array are kept, not turned into null", () => {
  assert.deepEqual(trip({ o: {}, a: [] }), { o: {}, a: [] });
});

// ── reading a Struct out of an enclosing message ──────────────────────────────

test("readStringMapField finds the Struct by field number and ignores its neighbours", () => {
  const body = message(pbStr(1, "ignored"), pbStruct(5, { TOKEN: "abc", ID: "42" }), pbStr(9, "also ignored"));
  assert.deepEqual(readStringMapField(body, 5), { TOKEN: "abc", ID: "42" });
});

test("an absent Struct field reads as {} — a plugin with no credentials installs as before", () => {
  assert.deepEqual(readStringMapField(message(pbStr(1, "x")), 5), {});
});

test("field numbers are not confused: variables is 5 on install and 6 on update", () => {
  const install = message(pbStruct(5, { A: "1" }));
  assert.deepEqual(readStringMapField(install, 6), {}, "must not read field 5 as field 6");
  assert.deepEqual(readStringMapField(install, 5), { A: "1" });
});

test("non-string values coerce, so a number typed into the form is not lost", () => {
  assert.deepEqual(readStringMapField(message(pbStruct(5, { N: 7, B: true })), 5), { N: "7", B: "true" });
});

test("garbage decodes to {} rather than throwing — a bad request must not take the RPC down", () => {
  assert.deepEqual(parseStruct(Buffer.from([0xff, 0xff, 0xff])), {});
  assert.deepEqual(readStringMapField(Buffer.from([0x2a, 0x05, 0x01, 0x02]), 5), {});
});
