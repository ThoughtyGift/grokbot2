/**
 * 3L — watch_video, đo trên box thật với pool thật, đúng kịch bản B2:
 * bot gốc xem clip OBS của chính nó và nói "~20 giây toàn màn đen … track AAC gần như câm (-91 dB)".
 *
 * Hai clip được dựng NGAY TRÊN BOX bằng ffmpeg (không tải gì lên):
 *   - đen + câm     → bot phải tự thấy clip hỏng
 *   - testsrc + 440Hz → bot phải thấy có hình có tiếng, KHÔNG kêu đen
 *
 * Ba điều phải đúng: tool chạy KHÔNG cần thẻ Allow (chỉ nhìn); khung hình vào transcript
 * (attachment); và lời nhận xét khớp sự thật của từng clip.
 *
 *   node services/grokbot-backend/scripts/e2e-watch-video.mjs
 */
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gwHeaders } from "./gw-auth.mjs";
import { killPort } from "./kill-port.mjs";

const PORT = 18888;
process.on("exit", () => { try { killPort(PORT); } catch { /* nothing */ } });
const root = await mkdtemp(join(tmpdir(), "grokbot-video-"));
const procs = [];
const killTree = (p) =>
  new Promise((r) => {
    if (!p.pid || p.exitCode !== null || p.killed) return r();
    if (process.platform === "win32") spawn("taskkill", ["/pid", String(p.pid), "/T", "/F"], { stdio: "ignore" }).on("close", r);
    else { try { process.kill(-p.pid, "SIGKILL"); } catch { p.kill("SIGKILL"); } r(); }
  });
const stop = async () => { for (const p of procs) await killTree(p); await rm(root, { recursive: true, force: true }); };
for (const s of ["SIGINT", "SIGTERM"]) process.on(s, () => void stop().then(() => process.exit(1)));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Dựng 2 clip thẳng trên box, qua exec daemon (cùng đường backend dùng) ───────────────────────
try { process.loadEnvFile(".env"); } catch { /* env thật đã có sẵn */ }
const BOX = (process.env.GROKBOT2_BOX_EXEC_URL ?? "").replace(/[/]+$/, "");
const TOKEN = process.env.GROKBOT2_EXEC_TOKEN ?? "";
if (!BOX) { console.error("thiếu GROKBOT2_BOX_EXEC_URL (.env gốc repo)"); process.exit(1); }
const boxExec = (command) =>
  fetch(`${BOX}/exec`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}`, "x-grokbot2-owner": "auth0|grokbot2-user" },
    body: JSON.stringify({ command, timeoutMs: 120_000 }),
  }).then((r) => r.json());

const BLACK = "/tmp/gb2-e2e-black.mp4";
const LIVE = "/tmp/gb2-e2e-live.mp4";
console.log("dựng 2 clip trên box…");
const mk1 = await boxExec(`ffmpeg -hide_banner -y -f lavfi -i color=c=black:s=640x360:d=5 -f lavfi -i anullsrc=r=44100:cl=mono -t 5 -c:v libx264 -pix_fmt yuv420p -c:a aac ${BLACK} 2>&1 | tail -1; ls -la ${BLACK}`);
const mk2 = await boxExec(`ffmpeg -hide_banner -y -f lavfi -i testsrc=s=640x360:d=5:r=25 -f lavfi -i sine=frequency=440:duration=5 -c:v libx264 -pix_fmt yuv420p -c:a aac ${LIVE} 2>&1 | tail -1; ls -la ${LIVE}`);
if (mk1.exitCode !== 0 || mk2.exitCode !== 0) { console.error("không dựng được clip:", mk1, mk2); process.exit(1); }

try {
  await fetch(`http://127.0.0.1:${PORT}/gw/health`, { signal: AbortSignal.timeout(1200) });
  console.error(`port ${PORT} already in use`); process.exit(1);
} catch { /* expected */ }

const backend = spawn("npx", ["tsx", "src/index.ts"], {
  cwd: "services/grokbot-backend", shell: true,
  env: { ...process.env, PORT: String(PORT), GROKBOT2_STATE_FILE: join(root, "state.json"), TSX_DISABLE_CACHE: "1" },
  stdio: ["ignore", "pipe", "pipe"],
});
procs.push(backend);
for (let i = 0; i < 60; i += 1) {
  try { await fetch(`http://127.0.0.1:${PORT}/gw/health`); break; } catch { await wait(500); }
}

const gw = (m, b = {}) =>
  fetch(`http://127.0.0.1:${PORT}/gw/api/${m}`, { method: "POST", headers: { "content-type": "application/json", ...gwHeaders() }, body: JSON.stringify(b) }).then((r) => r.json());
const entriesOf = (id) => gw("getAgentTranscriptTail", { id, limit: 200 }).then((r) => r.entries ?? []);

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  ok ? pass++ : fail++;
  console.log(`${ok ? "  ok  " : "  FAIL"} ${name}${ok ? "" : `  ${String(detail).slice(0, 260)}`}`);
};
const textOf = (e) => (e.kind === "message" ? e.content : e.message?.content ?? "");

const bot = (await gw("createAgent", { name: "Soi Video" })).agent;

/** Gửi một câu, chờ lượt lắng, trả về entries MỚI của lượt đó. */
async function ask(prompt, timeoutMs = 150_000) {
  const before = (await entriesOf(bot.id)).length;
  await gw("sendPrompt", { agentId: bot.id, content: prompt });
  const deadline = Date.now() + timeoutMs;
  let stable = 0, lastLen = -1;
  while (Date.now() < deadline) {
    await wait(2500);
    const now = (await entriesOf(bot.id)).slice(before);
    const streaming = now.some((e) => e.streaming);
    const texts = now.filter((e) => e.kind === "send-message" && e.message?.type === "text" && (e.message.content ?? "").trim() && !e.streaming);
    const calls = now.filter((e) => e.kind === "tool-call");
    const busy = calls.some((e) => e.status === "running" || e.status === "pending");
    if (!streaming && !busy && texts.length) {
      if (now.length === lastLen) { stable += 1; if (stable >= 2) break; }
      else stable = 0;
    } else stable = 0;
    lastLen = now.length;
  }
  return (await entriesOf(bot.id)).slice(before);
}

// ── clip ĐEN — bot phải tự thấy hỏng ────────────────────────────────────────────────────────────
console.log("clip đen + câm");
const t1 = await ask(`Mình vừa quay được clip ${BLACK} trên máy của bạn. Xem giúp clip này có ổn không, trong đó có gì?`);
const call1 = t1.filter((e) => e.kind === "tool-call" && e.name === "watch_video");
check("bot tự gọi watch_video", call1.length > 0, JSON.stringify(t1.map((e) => e.kind === "tool-call" ? e.name : e.kind)));
check("tool chạy xong không lỗi", call1.some((e) => e.status === "done" && !/Không mở được|lỗi/.test(String(e.result ?? ""))), JSON.stringify(call1.map((e) => [e.status, String(e.result).slice(0, 80)])));
check("KHÔNG cần thẻ Allow (chỉ nhìn)", !t1.some((e) => e.kind === "send-message" && e.message?.type === "local-tool-permission" && String(e.message.ask?.target ?? "").includes("watch_video")));
check("khung hình vào transcript (attachment)", t1.some((e) => e.kind === "send-message" && e.message?.type === "attachment" && String(e.message.file_name ?? "").includes("khung-hinh")));
const reply1 = t1.filter((e) => e.kind === "send-message" && e.message?.type === "text" && (e.message.content ?? "").trim()).map(textOf).join(" ");
check("nhận xét khớp sự thật: clip đen/câm", /đen|tối|không có (hình|nội dung)|trống|câm|im lặng|silent|black/i.test(reply1), reply1.slice(0, 200));
console.log(`      bot: ${reply1.replace(/[ ]+/g, " ").slice(0, 180)}`);

// ── clip CÓ HÌNH CÓ TIẾNG — bot không được kêu đen ─────────────────────────────────────────────
console.log("clip testsrc + 440Hz");
const t2 = await ask(`Còn clip ${LIVE} thì sao? Có hình có tiếng không, tả xem thấy gì.`);
const call2 = t2.filter((e) => e.kind === "tool-call" && e.name === "watch_video");
check("bot lại tự gọi watch_video", call2.length > 0);
const reply2 = t2.filter((e) => e.kind === "send-message" && e.message?.type === "text" && (e.message.content ?? "").trim()).map(textOf).join(" ");
// Chỉ bắt lời KHẲNG ĐỊNH clip đen/hỏng — bản đầu match trúng chữ "câm" trong câu phủ định
// "không câm như clip kia" và đánh rớt một câu trả lời hoàn toàn đúng.
check("KHÔNG kêu clip đen/hỏng", !/đen kịt|toàn màu đen|màn đen|đen hết|hoàn toàn đen|clip.{0,12}hỏng/i.test(reply2), reply2.slice(0, 200));
check("thấy nội dung thật (màu/sọc/số/chuyển động…)", /màu|sọc|test|số|đếm|chuyển động|thanh|pattern|hình/i.test(reply2), reply2.slice(0, 200));
console.log(`      bot: ${reply2.replace(/[ ]+/g, " ").slice(0, 180)}`);

await boxExec(`rm -f ${BLACK} ${LIVE}`);
console.log(`\n${pass} ok, ${fail} fail`);
await stop();
process.exit(fail ? 1 : 0);
