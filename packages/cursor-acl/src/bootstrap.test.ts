/**
 * `handleBootstrapRpc` — lỗi có MÃ của Connect ra đúng giao thức, không phải reply rỗng 200.
 *
 *   npx tsx --test packages/cursor-acl/src/bootstrap.test.ts
 *
 * Client 0.43 (`getPublicTemplate`) đọc `ConnectError.code`: NotFound ⇒ `null` (Marketplace nói "không có
 * mẫu"), PermissionDenied ⇒ lỗi "access denied". Trước 05/09 mọi RPC lạ đều 200 rỗng — hai mã ấy đều
 * biến thành "recipe hỏng".
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { message, pbStr, type MarketplacePort } from "@grokbot2/proto";

import { handleBootstrapRpc } from "./bootstrap.js";
import type { ObservePort } from "./ports.js";

const observe = { recordRpc: () => {} } as unknown as ObservePort;
const port: MarketplacePort = {
  listListings: () => ({ featured: [], listings: [] }),
  templateImportDetails: (id) => (id === "kin_kin_kin_kin_kin_k" ? "permission_denied" : "not_found"),
  listingBySlug: () => null,
};
const URL = "/aiserver.v1.GrokBotService/GetGrokBotTemplateImportDetails";

test("unary application/proto: not_found → HTTP 404 + JSON {code,message}", async () => {
  const r = await handleBootstrapRpc(URL, "application/proto", observe, { user: null, marketplace: port, body: message(pbStr(1, "khong_co_khong_co_kho")) });
  assert.equal(r?.status, 404);
  assert.equal(r?.contentType, "application/json");
  assert.deepEqual(JSON.parse(String(r?.body)).code, "not_found");
});

test("unary: permission_denied → 403", async () => {
  const r = await handleBootstrapRpc(URL, "application/proto", observe, { user: null, marketplace: port, body: message(pbStr(1, "kin_kin_kin_kin_kin_k")) });
  assert.equal(r?.status, 403);
  assert.equal(JSON.parse(String(r?.body)).code, "permission_denied");
});

test("đường khung connect+proto: 200 + khung end-stream mang error", async () => {
  const r = await handleBootstrapRpc(URL, "application/connect+proto", observe, { user: null, marketplace: port, body: message(pbStr(1, "khong_co_khong_co_kho")) });
  assert.equal(r?.status, 200);
  const b = r!.body as Buffer;
  assert.equal(b[0], 2, "cờ end-of-stream");
  const json = JSON.parse(b.subarray(5).toString("utf8"));
  assert.equal(json.error.code, "not_found");
});

test("RPC không có builder vẫn 200 rỗng như trước (không đổi hành vi cũ)", async () => {
  const r = await handleBootstrapRpc("/aiserver.v1.GrokBotService/WatchSandBoxMigration", "application/proto", observe, { user: null });
  assert.equal(r?.status, 200);
  assert.equal((r!.body as Buffer).length, 0);
});
