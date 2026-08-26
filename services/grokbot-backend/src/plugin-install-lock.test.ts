/**
 * Trên máy dùng chung, "cài plugin" phải bị chặn — vì nó là quyền spawn tiến trình.
 *
 * `installPlugin` ghi một dòng `command` vào cấu hình MCP, và lần gọi công cụ sau đó backend chạy
 * đúng dòng đó. Trên máy cá nhân thì vô hại: chủ máy đã toàn quyền rồi. Trên VPS dùng chung thì
 * tiến trình ấy nằm cạnh những dịch vụ khác của người khác — và người bấm "Add" không phải chủ máy.
 *
 * Mặc định phải là **cho phép**: bản cài trên máy cá nhân không được đổi hành vi vì một biến môi
 * trường mà không ai khai.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const withEnv = async <T>(vars: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> => {
  const prev = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  try { return await fn(); } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
};

/** Id thật trong catalog, để bài này đo đúng nhánh chặn chứ không đo nhánh "id không tồn tại". */
async function aRealPluginId(): Promise<number> {
  const { catalog } = await import("./plugin-catalog.js");
  const withServer = catalog().find((p) => p.mcp?.name);
  assert.ok(withServer, "catalog phải có ít nhất một plugin mang MCP server");
  return withServer.id;
}

test("mặc định: vẫn cài được — máy cá nhân không đổi hành vi", async () => {
  const dir = mkdtempSync(join(tmpdir(), "grokbot2-plug-"));
  try {
    await withEnv(
      { GROKBOT2_ALLOW_PLUGIN_INSTALL: undefined, GROKBOT2_DATA_DIR: dir, GROKBOT2_MCP_CONFIG: join(dir, "mcp.json") },
      async () => {
        const { installPlugin, pluginInstallAllowed } = await import(`./plugins.js?mac-dinh=${Date.now()}`);
        assert.equal(pluginInstallAllowed(), true);
        assert.equal(installPlugin(await aRealPluginId(), "auth0|thu"), true);
        // Owner không phải danh tính mặc định thì cấu hình nằm ở `.data/mcp/<owner>.json`,
        // không phải `GROKBOT2_MCP_CONFIG` — xem `configPathFor`.
        assert.ok(existsSync(join(dir, "mcp", "auth0_thu.json")), "phải ghi được server vào cấu hình của owner");
      },
    );
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("tắt: không cài được, và KHÔNG ghi gì vào cấu hình MCP", async () => {
  const dir = mkdtempSync(join(tmpdir(), "grokbot2-plug-"));
  try {
    await withEnv(
      { GROKBOT2_ALLOW_PLUGIN_INSTALL: "0", GROKBOT2_DATA_DIR: dir, GROKBOT2_MCP_CONFIG: join(dir, "mcp.json") },
      async () => {
        const { installPlugin, pluginInstallAllowed } = await import(`./plugins.js?tat=${Date.now()}`);
        assert.equal(pluginInstallAllowed(), false);
        assert.equal(installPlugin(await aRealPluginId(), "auth0|thu"), false);
        // Điều quan trọng nhất: không có dòng `command` nào được ghi ra đĩa.
        assert.equal(existsSync(join(dir, "mcp", "auth0_thu.json")), false, "tắt rồi thì không được ghi cấu hình MCP");
        assert.equal(existsSync(join(dir, "plugin-installs")), false, "cũng không ghi sổ đã-cài");
      },
    );
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
