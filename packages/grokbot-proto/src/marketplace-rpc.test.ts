/**
 * Marketplace RPC — khoá bằng BYTE giải ngược, vì client parse bằng schema proto của nó.
 *
 *   npx tsx --test packages/grokbot-proto/src/marketplace-rpc.test.ts
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";

import { listMarketplaceResponse, templateImportDetailsResponse, publicListingResponse, ConnectRpcError, type MarketplacePort, type WireListing } from "./marketplace-rpc.js";
import { readMessages, readString, readStrings, readVarint } from "./decode.js";
import { message, pbStr, pbVar } from "./encode.js";

const listing: WireListing = {
  slug: "ke-toan-abc123", name: "Kế toán", description: "Đọc hoá đơn, đối soát.", avatar: { kind: "default", shape: "gem", color: "green" },
  category: "ops-finance", categories: ["ops-finance", "productivity"], createdAtMs: 1_700_000_000_000, updatedAtMs: 1_700_000_001_000,
  shareId: "XYe7GA280aaI_mS-2ouZc", creator: { name: "Đội E2E", profilePhotoUrl: "https://vi-du.vn/a.png", handles: { x: "@e2e", github: "e2e" } },
};
const port: MarketplacePort = {
  listListings: (category) => ({ featured: category === "ops-finance" ? [] : [{ ...listing, slug: "noi-bat" }], listings: category === "design" ? [] : [listing] }),
  templateImportDetails: (shareId) => shareId === listing.shareId
    ? {
      template: { shareId, name: "Kế toán", description: "Đọc hoá đơn.", avatarShape: "gem", avatarColor: "green", createdAtMs: 1, updatedAtMs: 2, published: true, activeVersion: 3, visibility: "public", imageUrl: null },
      blobGetUrl: "http://localhost:8788/gw/bot-template-blob/XYe7GA280aaI_mS-2ouZc/3.json", expectedActiveVersion: 3, creatorDisplayName: "Đội E2E",
    }
    : shareId === "kin_kin_kin_kin_kin_k" ? "permission_denied" : "not_found",
  listingBySlug: (slug) => slug === listing.slug ? { listing, templateGetUrl: "http://x/blob.json" } : null,
};

test("ListPublicGrokBotMarketplaceListings: featured (1) · listings (2) · next_page_token rỗng (3); listing đủ 11 field", () => {
  const b = listMarketplaceResponse(port, undefined);
  assert.equal(readMessages(b, 1).length, 1, "featured_listings");
  const rows = readMessages(b, 2);
  assert.equal(rows.length, 1);
  assert.equal(readString(b, 3), "");
  const l = rows[0];
  assert.equal(readString(l, 1), "ke-toan-abc123");
  assert.equal(readString(l, 2), "Kế toán");
  assert.equal(readString(l, 3), "Đọc hoá đơn, đối soát.");
  assert.equal(readString(l, 4), "", "không image_url khi avatar mặc định");
  const av = readMessages(l, 5)[0];
  assert.equal(readString(av, 1), "gem");
  assert.equal(readString(av, 2), "green");
  assert.equal(readString(l, 6), "ops-finance");
  assert.equal(readVarint(l, 7), 1_700_000_000_000);
  assert.equal(readString(l, 9), "XYe7GA280aaI_mS-2ouZc");
  const c = readMessages(l, 10)[0];
  assert.equal(readString(c, 1), "Đội E2E");
  assert.equal(readString(c, 2), "https://vi-du.vn/a.png");
  const handles = readMessages(c, 3).map((e) => [readString(e, 1), readString(e, 2)]);
  assert.deepEqual(handles, [["x", "@e2e"], ["github", "e2e"]], "map<string,string> = repeated {1 key, 2 value}");
  assert.deepEqual(readStrings(l, 11), ["ops-finance", "productivity"]);
});

test("lọc theo category đọc từ field 1 của request; avatar ảnh đi field 4", () => {
  const b = listMarketplaceResponse(port, message(pbStr(1, "design"), pbVar(2, 100)));
  assert.equal(readMessages(b, 2).length, 0);
  const anh: MarketplacePort = { ...port, listListings: () => ({ featured: [], listings: [{ ...listing, avatar: { kind: "image", url: "https://vi-du.vn/bot.png" } }] }) };
  const l = readMessages(listMarketplaceResponse(anh, undefined), 2)[0];
  assert.equal(readString(l, 4), "https://vi-du.vn/bot.png");
  assert.equal(readMessages(l, 5).length, 0, "oneof: có image_url thì không default_avatar");
});

test("không có cổng ⇒ danh sách rỗng, không ném", () => {
  const b = listMarketplaceResponse(undefined, undefined);
  assert.equal(readMessages(b, 1).length + readMessages(b, 2).length, 0);
});

test("GetGrokBotTemplateImportDetails: template (1) · blob_get_url (2) · expected_active_version (3) · creator (4)", () => {
  const b = templateImportDetailsResponse(port, message(pbStr(1, listing.shareId)));
  const t = readMessages(b, 1)[0];
  assert.equal(readString(t, 1), listing.shareId);
  assert.equal(readString(t, 2), "Kế toán");
  assert.equal(readString(t, 3), "gem");
  assert.equal(readString(t, 4), "green");
  assert.equal(readVarint(t, 10), 1, "published");
  assert.equal(readVarint(t, 11), 3, "active_version");
  assert.equal(readString(t, 12), "Đọc hoá đơn.");
  assert.equal(readVarint(t, 13), 1, "visibility PUBLIC=1");
  assert.equal(readVarint(t, 14), 1, "owner_type USER=1");
  assert.equal(readString(t, 15), "", "image_url vắng khi null");
  assert.equal(readString(b, 2), "http://localhost:8788/gw/bot-template-blob/XYe7GA280aaI_mS-2ouZc/3.json");
  assert.equal(readVarint(b, 3), 3);
  assert.equal(readString(b, 4), "Đội E2E");
});

test("không có mẫu → ConnectRpcError not_found; có mà không public → permission_denied (client phân biệt hai mã)", () => {
  assert.throws(() => templateImportDetailsResponse(port, message(pbStr(1, "khong_co_khong_co_kho"))), (e: unknown) => e instanceof ConnectRpcError && e.code === "not_found");
  assert.throws(() => templateImportDetailsResponse(port, message(pbStr(1, "kin_kin_kin_kin_kin_k"))), (e: unknown) => e instanceof ConnectRpcError && e.code === "permission_denied");
  assert.throws(() => templateImportDetailsResponse(undefined, message(pbStr(1, listing.shareId))), (e: unknown) => e instanceof ConnectRpcError && e.code === "not_found");
});

test("GetPublicGrokBotMarketplaceListing{slug} → {listing (1), template_get_url (2)}; slug lạ → not_found", () => {
  const b = publicListingResponse(port, message(pbStr(1, listing.slug)));
  assert.equal(readString(readMessages(b, 1)[0], 1), listing.slug);
  assert.equal(readString(b, 2), "http://x/blob.json");
  assert.throws(() => publicListingResponse(port, message(pbStr(1, "khong-co"))), (e: unknown) => e instanceof ConnectRpcError && e.code === "not_found");
});
