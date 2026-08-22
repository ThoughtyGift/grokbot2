/**
 * X2.3 / X5.3 — `/v1/host/settings`: bố cục của người đang đăng nhập.
 *
 *   node scripts/e2e-host-settings.mjs
 *
 * Ba điều cần chứng minh, không phải "route trả 200":
 *   · KẸP theo ngưỡng đo được ở app gốc (sidebar 88–400, panel 280–480) — một client hỏng ghi
 *     `sidebarWidth: 5000` thì lần mở sau app không dùng được;
 *   · GHI RỒI ĐỌC LẠI đúng, kể cả sau khi backend lưu xuống SQLite;
 *   · TÁCH THEO CHỦ SỞ HỮU — hai tài khoản trên cùng backend không được thấy bố cục của nhau.
 *     Đây là điều tôi đã khẳng định khi thiết kế, nên nó phải có bài kiểm.
 */
import { spawn } from "node:child_process";
import { recordRun } from "./run-history.mjs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { killPort } from "./kill-port.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.GROKBOT2_E2E_PORT || 8809);
process.on("exit", () => { try { killPort(PORT); } catch { /* không có gì để dọn */ } });
const API = `http://localhost:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dataDir = mkdtempSync(join(tmpdir(), "grokbot2-hostset-"));

let pass = 0, fail = 0;
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, pass: Boolean(ok), detail });
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${detail ? `  — ${detail}` : ""}`);
};

try {
  await fetch(`${API}/v1/health`, { signal: AbortSignal.timeout(1500) });
  console.log(`cổng ${PORT} đã có tiến trình khác — đóng nó trước.`);
  process.exit(1);
} catch { /* chưa ai nghe */ }

const child = spawn("npx", ["tsx", "src/index.ts"], {
  cwd: ROOT, shell: true, stdio: ["ignore", "pipe", "pipe"],
  env: {
    ...process.env,
    PORT: String(PORT), GROKBOT2_PORT: String(PORT),
    GROKBOT2_AUTH: "enforce",
    GROKBOT2_RUNTIME_URL: "", GROKBOT2_COMPUTER_URL: "", GROKBOT2_OPS_URL: "",
    GROKBOT2_SQLITE_FILE: join(dataDir, "grokbot.sqlite"),
    GROKBOT2_STATE_FILE: join(dataDir, "state.json"),
    GROKBOT2_GATEWAY_TOKEN: "e2e-hostset-token",
    NODE_TEST_CONTEXT: "e2e-host-settings",
  },
});
const killTree = () => {
  if (child.pid == null || child.exitCode !== null || child.killed) return;
  if (process.platform === "win32") spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  else child.kill();
};
let log = "";
child.stdout.on("data", (d) => { log += d; });
child.stderr.on("data", (d) => { log += d; });

const hdr = (t) => ({ authorization: `Bearer ${t}`, "content-type": "application/json" });
const get = (t) => fetch(`${API}/v1/host/settings`, { headers: hdr(t) }).then((r) => r.json());
const patch = (t, body) => fetch(`${API}/v1/host/settings`, { method: "PATCH", headers: hdr(t), body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));

try {
  let up = false;
  for (let i = 0; i < 40; i++) {
    await sleep(1000);
    try { if ((await fetch(`${API}/v1/health`)).ok) { up = true; break; } } catch { /* chưa lên */ }
  }
  if (!up) { console.log(`backend không lên được trên ${PORT}:\n${log.slice(-800)}`); process.exit(1); }

  const noAuth = await fetch(`${API}/v1/host/settings`);
  check("không có bearer thì 401", noAuth.status === 401, `HTTP ${noAuth.status}`);

  const tok = (await (await fetch(`${API}/v1/session`)).json()).token;
  const first = await get(tok);
  check("lần đầu trả về bố cục rỗng", JSON.stringify(first) === '{"ui":{}}', JSON.stringify(first));

  const wrote = await patch(tok, { sidebarWidth: 300, sidebarCollapsed: false, paneWidth: 420, paneOpen: true });
  check("ghi được bốn giá trị hợp lệ",
    wrote.status === 200 && wrote.body.ui.sidebarWidth === 300 && wrote.body.ui.paneWidth === 420
    && wrote.body.ui.sidebarCollapsed === false && wrote.body.ui.paneOpen === true, JSON.stringify(wrote.body));

  const readBack = await get(tok);
  check("đọc lại đúng cái đã ghi", readBack.ui?.sidebarWidth === 300 && readBack.ui?.paneWidth === 420, JSON.stringify(readBack.ui));

  const tooBig = await patch(tok, { sidebarWidth: 5000, paneWidth: 9999 });
  check("kẹp mép trên: 5000→400, 9999→480",
    tooBig.body.ui.sidebarWidth === 400 && tooBig.body.ui.paneWidth === 480, JSON.stringify(tooBig.body.ui));

  const tooSmall = await patch(tok, { sidebarWidth: 5, paneWidth: 10 });
  check("kẹp mép dưới: 5→88, 10→280",
    tooSmall.body.ui.sidebarWidth === 88 && tooSmall.body.ui.paneWidth === 280, JSON.stringify(tooSmall.body.ui));

  const junk = await patch(tok, { sidebarWidth: "rộng lắm", paneOpen: "có", lạ: 1 });
  check("bỏ qua giá trị sai kiểu, không ghi khoá lạ",
    junk.status === 200 && junk.body.ui.sidebarWidth === 88 && junk.body.ui.paneOpen === true && !("lạ" in junk.body.ui),
    JSON.stringify(junk.body.ui));

  const partial = await patch(tok, { sidebarCollapsed: true });
  check("patch một phần không xoá phần còn lại",
    partial.body.ui.sidebarCollapsed === true && partial.body.ui.paneWidth === 280, JSON.stringify(partial.body.ui));

  // ── tách theo chủ sở hữu ───────────────────────────────────────────────────
  const reg = async (email) => {
    const r = await fetch(`${API}/v1/register`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: "mat-khau-du-dai-123" }),
    });
    return r.ok ? (await r.json()).token : null;
  };
  const a = await reg("a@e2e.local");
  const b = await reg("b@e2e.local");
  if (!a || !b) check("tạo được hai tài khoản để so", false, "POST /v1/register không trả token");
  else {
    await patch(a, { sidebarWidth: 120 });
    await patch(b, { sidebarWidth: 380 });
    const ga = await get(a), gb = await get(b);
    check("hai tài khoản giữ bố cục riêng",
      ga.ui.sidebarWidth === 120 && gb.ui.sidebarWidth === 380, `a=${ga.ui.sidebarWidth} b=${gb.ui.sidebarWidth}`);
    const host = await get(tok);
    check("bố cục của host không bị hai tài khoản kia ghi đè",
      host.ui.sidebarWidth === 88, JSON.stringify(host.ui));
  }
} finally {
  killTree();
}

console.log(`\n${pass} pass, ${fail} fail`);
recordRun("e2e-host-settings.mjs", results);
process.exit(fail ? 1 : 0);
