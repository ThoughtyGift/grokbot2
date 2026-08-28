/**
 * `removeMcpServer` / `authenticateMcpServer` — hai lệnh cuối của cụm MCP ghi.
 *
 *   npx tsx --test services/grokbot-backend/src/mcp-server-admin.test.ts
 *
 * Bài đáng giá nhất ở đây không phải "xoá được server", mà là **KHÔNG ghi đè file người dùng tự
 * viết**: với danh tính mặc định, cấu hình MCP là `.mcp.json` ở gốc repo — file bạn tự giữ, mang
 * token thật. Một lệnh "xoá server" viết lại file đó là sửa thứ mình không tạo ra.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TMP = mkdtempSync(join(tmpdir(), "gb2-mcpadmin-"));
const SHARED = join(TMP, "shared-mcp.json");
// Cấu hình của danh tính MẶC ĐỊNH = file dùng chung, backend không được viết đè.
writeFileSync(SHARED, JSON.stringify({ mcpServers: { github: { command: "npx", args: ["-y", "x"] } } }, null, 2));
process.env.GROKBOT2_MCP_CONFIG = SHARED;
process.env.GROKBOT2_DATA_DIR = join(TMP, "data");

const { DEFAULT_USER } = await import("./auth.js");
const { removeMcpServer, authenticateMcpServer, mcpServers } = await import("./mcp.js");

const B = "local|nguoi-b@vi-du.vn";
const ownedPath = join(TMP, "data", "mcp", `${B.replace(/[^a-zA-Z0-9._-]/g, "_")}.json`);

function giveB(servers: Record<string, unknown>): void {
  mkdirSync(join(TMP, "data", "mcp"), { recursive: true });
  writeFileSync(ownedPath, JSON.stringify({ mcpServers: servers }, null, 2));
}

test("KHÔNG viết đè cấu hình dùng chung của người dùng — từ chối và nói đường tự sửa", () => {
  const before = readFileSync(SHARED, "utf8");
  const r = removeMcpServer("github", DEFAULT_USER.authId);
  assert.equal(r.ok, false);
  assert.match(String(r.reason), /tự giữ|tự sửa|không viết đè/i);
  assert.equal(readFileSync(SHARED, "utf8"), before, "file dùng chung phải NGUYÊN VẸN từng byte");
});

test("xoá được server trong cấu hình do backend quản", () => {
  giveB({ github: { command: "npx" }, notion: { url: "https://mcp.notion.com/mcp" } });
  assert.equal(removeMcpServer("github", B).ok, true);
  assert.deepEqual(Object.keys(mcpServers(B)), ["notion"], "chỉ mất đúng cái được nêu tên");
});

test("xoá server không tồn tại thì nói không có, không dựng file rỗng", () => {
  giveB({ notion: { url: "https://mcp.notion.com/mcp" } });
  const r = removeMcpServer("khong-co", B);
  assert.equal(r.ok, false);
  assert.match(String(r.reason), /không có server/);
  assert.deepEqual(Object.keys(mcpServers(B)), ["notion"]);
});

test("đăng nhập: server chạy bằng lệnh (stdio) thì KHÔNG có OAuth để mở", () => {
  giveB({ github: { command: "npx", args: ["-y", "x"] } });
  const r = authenticateMcpServer("github", {}, B);
  assert.equal(r.ok, false);
  // Trả một authUrl rỗng cho server stdio là đẩy người dùng vào một trang trắng.
  assert.match(String(r.reason), /stdio|lệnh trên máy/i);
  assert.equal(r.authUrl, undefined);
});

test("đăng nhập: server không tồn tại", () => {
  giveB({});
  assert.equal(authenticateMcpServer("ma", {}, B).ok, false);
});

test("đăng nhập: server http chưa biết redirect URI thì nói rõ, không im lặng", () => {
  giveB({ notion: { url: "https://mcp.notion.com/mcp" } });
  const r = authenticateMcpServer("notion", {}, B);
  // Chưa có redirect URI (client chưa mở pane Plugins lần nào) — phải nói ra lý do.
  assert.equal(r.ok, false);
  assert.match(String(r.reason), /redirect|quay về/i);
});
