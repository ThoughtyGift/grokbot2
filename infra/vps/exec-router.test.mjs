/**
 * Dải tài khoản của router — đọc từ passwd, hết dải thì lỗi có MÃ.
 *
 *   node --test infra/vps/exec-router.test.mjs
 *
 * Bài này nạp router như một module: `server.listen` chỉ chạy khi file được CHẠY (guard `LA_CHINH`),
 * nên import ở đây không mở cổng 1337.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "gb2-router-"));
const passwd = join(dir, "passwd");
writeFileSync(passwd, [
  "root:x:0:0:root:/root:/bin/bash",
  "box:x:1001:1001::/home/box:/bin/bash",
  "gb2u003:x:1004:1002::/home/gb2u003:/bin/bash",
  "gb2u001:x:1002:1002::/home/gb2u001:/bin/bash",
  "gb2u010:x:1011:1002::/home/gb2u010:/bin/bash",
  "gb2user:x:1099:1002::/home/gb2user:/bin/bash",
  "",
].join("\n"));
process.env.GROKBOT2_PASSWD_FILE = passwd;
process.env.GROKBOT2_USER_POOL = "";
process.env.GROKBOT2_EXEC_TOKEN = "t";
const { poolAccounts, osUserFor, PoolExhausted } = await import("./exec-router.mjs");

test("dải đọc từ passwd: chỉ gb2uNNN, sắp thứ tự, bỏ tên gần giống", () => {
  assert.deepEqual(poolAccounts(), ["gb2u001", "gb2u003", "gb2u010"]);
});

test("cấp lần lượt, cùng owner ra cùng tài khoản, hết dải thì lỗi có mã + số đếm", () => {
  const map = join(dir, "users.json");
  assert.equal(osUserFor("auth0|a", map), "gb2u001");
  assert.equal(osUserFor("auth0|b", map), "gb2u003");
  assert.equal(osUserFor("auth0|a", map), "gb2u001", "gọi lại phải ra đúng tài khoản cũ");
  assert.equal(osUserFor("auth0|c", map), "gb2u010");
  assert.deepEqual(JSON.parse(readFileSync(map, "utf8")), { "auth0|a": "gb2u001", "auth0|b": "gb2u003", "auth0|c": "gb2u010" });
  let e;
  try { osUserFor("auth0|d", map); } catch (x) { e = x; }
  assert.ok(e instanceof PoolExhausted);
  assert.equal(e.code, "pool-exhausted");
  assert.equal(e.used, 3);
  assert.equal(e.size, 3);
  assert.throws(() => osUserFor("", map), /no owner/);
});

test("tài khoản MỚI thêm vào passwd được thấy ở lượt cấp kế, không cần khởi động lại", () => {
  const map = join(dir, "users2.json");
  writeFileSync(map, JSON.stringify({ x: "gb2u001", y: "gb2u003", z: "gb2u010" }));
  assert.throws(() => osUserFor("auth0|moi", map), PoolExhausted);
  writeFileSync(passwd, readFileSync(passwd, "utf8") + "gb2u011:x:1012:1002::/home/gb2u011:/bin/bash\n");
  assert.equal(osUserFor("auth0|moi", map), "gb2u011");
});
