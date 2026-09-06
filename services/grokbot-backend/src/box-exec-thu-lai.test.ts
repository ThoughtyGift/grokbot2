/**
 * Backend thử lại MỘT lần khi box vừa thu daemon lúc nghỉ và lời gọi kế rơi vào lúc daemon chưa lên
 * (§8 "khởi động lạnh"). Chỉ thử lại lỗi "chưa TỚI được daemon" — op chưa chạy nên an toàn kể cả với
 * `append`. KHÔNG thử lại: timeout (daemon đang chạy chậm → ghi đôi), pool-exhausted, lỗi daemon thật.
 *
 * Đo bằng một máy chủ HTTP thật đóng vai daemon: đếm số lần nó bị gọi cho từng op.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { boxCall, laLoiKhoiDongLanh, BoxUnavailable } from "./box-exec.js";

type Phanhoi = { status: number; body: unknown };
/** Mỗi op trả một hàng phản hồi theo lần gọi; hết hàng thì lặp lại phản hồi cuối. */
async function moMay(theoOp: Record<string, Phanhoi[]>): Promise<{ url: string; demGoi: Record<string, number>; dong: () => Promise<void>; server: Server }> {
  const demGoi: Record<string, number> = {};
  const server = createServer((req, res) => {
    const op = (req.url ?? "").replace(/^\/+|\?.*$/g, "");
    req.on("data", () => {});
    req.on("end", () => {
      const n = demGoi[op] = (demGoi[op] ?? 0) + 1;
      const hang = theoOp[op] ?? [{ status: 404, body: { error: `unknown op: ${op}` } }];
      const pr = hang[Math.min(n - 1, hang.length - 1)];
      res.writeHead(pr.status, { "content-type": "application/json" });
      res.end(JSON.stringify(pr.body));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("cần cổng TCP");
  return { url: `http://127.0.0.1:${addr.port}`, demGoi, dong: () => new Promise((r) => server.close(() => r())), server };
}

function voiEnv<T>(env: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const cu: Record<string, string | undefined> = {};
  for (const k of Object.keys(env)) { cu[k] = process.env[k]; if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k]!; }
  return fn().finally(() => { for (const k of Object.keys(cu)) { if (cu[k] === undefined) delete process.env[k]; else process.env[k] = cu[k]!; } });
}

test("khởi động lạnh: 520 lần đầu rồi 200 → thử lại một lần, op chạy đúng hai lần", async () => {
  const may = await moMay({
    writeBytes: [
      { status: 520, body: "" },                                  // Cloudflare khi router chưa có phản hồi
      { status: 200, body: { path: "/x", bytes: 6, totalSize: 6 } },
    ],
  });
  try {
    const r = await voiEnv({ GROKBOT2_BOX_EXEC_URL: may.url, GROKBOT2_COMPUTER_URL: undefined, GROKBOT2_BOX_RETRY_MS: "5" }, () =>
      boxCall("writeBytes", { path: "tu-may/a.bin", bytesBase64: "AAAA", append: true }));
    assert.deepEqual(r, { path: "/x", bytes: 6, totalSize: 6 });
    assert.equal(may.demGoi.writeBytes, 2, "gọi đúng hai lần: lần đầu 520, lần hai xanh");
  } finally { await may.dong(); }
});

test("router trả 'daemon con không lên' rồi xanh → thử lại một lần", async () => {
  const may = await moMay({
    readBytes: [
      { status: 200, body: { error: "daemon con không lên sau 8000ms" } },
      { status: 200, body: { bytesBase64: "AAAA", eof: true } },
    ],
  });
  try {
    const r = await voiEnv({ GROKBOT2_BOX_EXEC_URL: may.url, GROKBOT2_COMPUTER_URL: undefined, GROKBOT2_BOX_RETRY_MS: "5" }, () =>
      boxCall("readBytes", { target_file: "x", offset: 0, length: 4 }));
    assert.deepEqual(r, { bytesBase64: "AAAA", eof: true });
    assert.equal(may.demGoi.readBytes, 2);
  } finally { await may.dong(); }
});

test("lỗi daemon THẬT (ngoài root) KHÔNG thử lại — gọi đúng một lần, ném nguyên câu", async () => {
  const may = await moMay({ writeBytes: [{ status: 200, body: { error: "path escapes root" } }] });
  try {
    await voiEnv({ GROKBOT2_BOX_EXEC_URL: may.url, GROKBOT2_COMPUTER_URL: undefined, GROKBOT2_BOX_RETRY_MS: "5" }, async () => {
      await assert.rejects(() => boxCall("writeBytes", { path: "../../etc/x", bytesBase64: "AA" }), /path escapes root/);
    });
    assert.equal(may.demGoi.writeBytes, 1, "lỗi tất định: không thử lại");
  } finally { await may.dong(); }
});

test("pool-exhausted KHÔNG thử lại — hết dải thì thử lại vô ích", async () => {
  const may = await moMay({ exec: [{ status: 200, body: { error: "pool exhausted", code: "pool-exhausted", used: 30, size: 30 } }] });
  try {
    await voiEnv({ GROKBOT2_BOX_EXEC_URL: may.url, GROKBOT2_COMPUTER_URL: undefined, GROKBOT2_BOX_RETRY_MS: "5" }, async () => {
      await assert.rejects(() => boxCall("exec", { command: "ls" }), (e) => e instanceof BoxUnavailable && /báo quản trị viên/.test((e as Error).message));
    });
    assert.equal(may.demGoi.exec, 1);
  } finally { await may.dong(); }
});

test("hai lần 520 liên tiếp → thử lại ĐÚNG một lần rồi bỏ cuộc (gọi hai lần, ném)", async () => {
  const may = await moMay({ writeBytes: [{ status: 520, body: "" }, { status: 520, body: "" }, { status: 200, body: { ok: true } }] });
  try {
    await voiEnv({ GROKBOT2_BOX_EXEC_URL: may.url, GROKBOT2_COMPUTER_URL: undefined, GROKBOT2_BOX_RETRY_MS: "5" }, async () => {
      await assert.rejects(() => boxCall("writeBytes", { path: "a", bytesBase64: "AA", append: true }), /HTTP 520/);
    });
    assert.equal(may.demGoi.writeBytes, 2, "một lần thử lại, không hơn — không để append lặp vô hạn");
  } finally { await may.dong(); }
});

test("GROKBOT2_BOX_RETRY_MS=0 tắt hẳn việc thử lại", async () => {
  const may = await moMay({ writeBytes: [{ status: 520, body: "" }, { status: 200, body: { ok: true } }] });
  try {
    await voiEnv({ GROKBOT2_BOX_EXEC_URL: may.url, GROKBOT2_COMPUTER_URL: undefined, GROKBOT2_BOX_RETRY_MS: "0" }, async () => {
      await assert.rejects(() => boxCall("writeBytes", { path: "a", bytesBase64: "AA" }), /HTTP 520/);
    });
    assert.equal(may.demGoi.writeBytes, 1);
  } finally { await may.dong(); }
});

test("laLoiKhoiDongLanh: chỉ nhận lỗi 'chưa tới được daemon'", () => {
  for (const m of ["box writeBytes -> HTTP 520", "box exec -> HTTP 502", "daemon con không lên sau 8000ms", "box unavailable: connect ECONNREFUSED", "fetch failed"])
    assert.equal(laLoiKhoiDongLanh(new Error(m)), true, m);
  for (const m of ["box exec quá 90000ms không phản hồi", "Máy tính của bot chưa có chỗ … báo quản trị viên", "path escapes root", "box writeBytes -> HTTP 404"])
    assert.equal(laLoiKhoiDongLanh(new Error(m)), false, m);
});
