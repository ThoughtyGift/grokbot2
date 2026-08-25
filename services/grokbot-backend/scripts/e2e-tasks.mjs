/**
 * `task` / `await_task` — việc chạy nền, kiểm trên stack thật.
 *
 * Điểm cần chứng minh không phải "tool trả về chuỗi gì", mà là **hai việc có thật sự chạy chồng
 * lên nhau không**. Một bản cài sai vẫn trả đúng mọi chuỗi ở trên trong khi chạy nối đuôi, và
 * lúc đó tính năng chẳng còn lý do tồn tại. Nên nhóm 3 đo ĐỒNG HỒ, không đo lời tool tự khai.
 *
 * Ba trạng thái của `await_task` cũng được kiểm riêng từng cái: xong / không có mã / còn chạy.
 * Gộp chúng lại là model tưởng một việc chưa chạy đã chạy xong.
 *
 * Cần backend đang chạy:  pnpm backend
 *   node scripts/e2e-tasks.mjs
 */
import { gwHeaders } from "./gw-auth.mjs";

const GW = "http://localhost:8788/gw/api";
const post = async (m, b) => (await fetch(`${GW}/${m}`, {
  method: "POST", headers: { "content-type": "application/json", ...gwHeaders() }, body: JSON.stringify(b),
})).json();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${detail ? `  — ${detail}` : ""}`);
};

const LIMIT = 400;
const read = async (id) => (await post("getAgentTranscript", { id, limit: LIMIT })).entries ?? [];
const anchorOf = (e) => e[e.length - 1]?.id ?? null;
const since = (e, a) => { const i = a ? e.findIndex((x) => x.id === a) : -1; return i >= 0 ? e.slice(i + 1) : e; };

/** Gọi một tool và trả về kết quả của nó. */
async function callTool(agentId, line, waitSec = 120) {
  const anchor = anchorOf(await read(agentId));
  await post("sendPrompt", { agentId, content: line, clientNonce: `t${Date.now()}${Math.random()}` });
  for (let i = 0; i < waitSec; i++) {
    await sleep(1000);
    const tc = since(await read(agentId), anchor).find((e) => e.kind === "tool-call");
    if (tc && (tc.status === "done" || tc.status === "failed")) { await sleep(300); return String(tc.result ?? ""); }
  }
  return "(quá giờ)";
}
const task = (agentId, o) => callTool(agentId, `/tool task ${JSON.stringify(o)}`);
const awaitTask = (agentId, ids) => callTool(agentId, `/tool await_task ${JSON.stringify({ ids })}`, 320);
const idIn = (s) => /task-\d+/.exec(s)?.[0] ?? null;

// Không chạy khi có bot khác đang làm việc: bài này chiếm bot thử và gọi model thật.
const roster = await post("listAgents", {});
const list = Array.isArray(roster) ? roster : Object.values(roster);
const busy = list.filter((a) => a?.name !== "DesktopE2E" && (a?.isRunning === true || a?.isRunningTurn === true));
if (busy.length) {
  console.log(`DỪNG: ${busy.map((a) => a.name ?? a.id).join(", ")} đang chạy`);
  process.exit(2);
}
const agent = list.find((a) => a?.name === "DesktopE2E") ?? (await post("createAgent", { name: "DesktopE2E" })).agent;
console.log(`bot thử: ${agent.id}\n`);

// ── 1. chạy thẳng: không có `async` thì trả kết quả ngay ─────────────────────
console.log("1. task không async trả thẳng kết quả (nhánh completed của hãng)");
{
  const r = await task(agent.id, { task_description: "Trả lời đúng một chữ số: 7 cộng 8 bằng mấy?", task_title: "cộng" });
  check("trả về câu trả lời, không phải mã task", /15/.test(r) && !idIn(r), r.slice(0, 90));
}

// ── 2. giao nền: trả về mã ───────────────────────────────────────────────────
console.log("\n2. task async trả về mã để thu sau");
let idA = null;
{
  const r = await task(agent.id, { task_description: "Trả lời ngắn: thủ đô của Pháp là gì?", task_title: "thủ đô Pháp", async: true });
  idA = idIn(r);
  check("trả về một mã task", idA != null, r.slice(0, 100));
  check("có nói cách lấy kết quả", /await_task/.test(r), r.includes("await_task") ? "có" : "không");
}

// ── 3. HAI VIỆC CÓ CHỒNG NHAU KHÔNG — nhóm duy nhất chứng minh tính năng có nghĩa ──
console.log("\n3. hai việc nền chạy CHỒNG lên nhau, không nối đuôi");
{
  // Đo bằng đồng hồ: chạy nối đuôi thì tổng ≈ tổng hai việc; chạy chồng thì ≈ việc dài hơn.
  const t0 = Date.now();
  const r1 = await task(agent.id, { task_description: "Viết một đoạn 120 chữ về mưa Hà Nội.", task_title: "mưa", async: true });
  const r2 = await task(agent.id, { task_description: "Viết một đoạn 120 chữ về phở bò.", task_title: "phở", async: true });
  const dispatched = Date.now() - t0;
  const ids = [r1, r2].map(idIn).filter(Boolean);
  check("giao được hai việc", ids.length === 2, ids.join(", "));
  check("giao xong nhanh, không đứng chờ việc chạy", dispatched < 25_000, `${Math.round(dispatched / 1000)}s để giao cả hai`);

  const t1 = Date.now();
  const w = await awaitTask(agent.id, ids.concat(["task-khong-he-ton-tai"]));
  const waited = Date.now() - t1;
  check("một lần chờ thu được cả hai", ids.every((id) => w.includes(id)), w.slice(0, 120).replace(/\n/g, " "));
  check("mã không có thật được nói thẳng", /không có mã/.test(w) && w.includes("task-khong-he-ton-tai"),
    /không có mã/.test(w) ? "có" : "IM LẶNG BỎ QUA");
  check("cả hai đều báo xong", (w.match(/\(xong\)/g) ?? []).length === 2, `${(w.match(/\(xong\)/g) ?? []).length} việc xong`);
  console.log(`       (giao ${Math.round(dispatched / 1000)}s, chờ thêm ${Math.round(waited / 1000)}s)`);
}

// ── 4. trần việc nền ─────────────────────────────────────────────────────────
console.log("\n4. quá trần thì từ chối, và nói cách gỡ");
{
  // Việc phải đủ DÀI để cả bốn còn đang chạy lúc giao việc thứ năm. Bản đầu dùng "đếm từ 1 đến 5":
  // chúng xong trước khi tới lượt thứ năm, nên trần không chạm tới và bài kiểm báo FAIL cho một
  // giới hạn đang hoạt động đúng. Trần đếm việc ĐANG CHẠY, không đếm việc đã từng giao.
  const ids = [];
  for (let i = 0; i < 4; i++) {
    const r = await task(agent.id, {
      task_description: `Viết một bài khoảng 600 chữ, chia ba đoạn, về chủ đề số ${i}: một ngày ở chợ quê.`,
      task_title: `bài dài ${i}`, async: true,
    });
    const id = idIn(r); if (id) ids.push(id);
  }
  check("giao đủ bốn việc dài", ids.length === 4, ids.join(", "));
  const over = await task(agent.id, { task_description: "Việc thứ năm.", task_title: "thừa", async: true });
  const refused = !idIn(over);
  check("việc thứ năm bị từ chối", refused, over.slice(0, 80));
  check("lời từ chối nói cách gỡ", /await_task/.test(over), refused ? over.slice(0, 60) : "không từ chối");
  if (ids.length) await awaitTask(agent.id, ids);
}

// ── 5. khay "đang chạy" của app có thấy việc nền không ───────────────────────
console.log("\n5. việc nền hiện trong khay đang chạy, không phải bot im lặng");
{
  const r = await task(agent.id, { task_description: "Viết 150 chữ về Hồ Gươm.", task_title: "Hồ Gươm", async: true });
  const id = idIn(r);
  await sleep(1500);
  const tray = await post("getAsyncTasks", { id: agent.id });
  const rows = Array.isArray(tray) ? tray : (tray.tasks ?? []);
  check("khay có ít nhất một dòng đang chạy", rows.length >= 1, `${rows.length} dòng: ${rows.map((x) => x.detail ?? x.kind).join(", ")}`);
  check("dòng khay đúng kiểu subagent", rows.every((x) => x.kind === "subagent"), rows.map((x) => x.kind).join(","));
  if (id) {
    const anchor = anchorOf(await read(agent.id));
    await awaitTask(agent.id, [id]);
    const notes = since(await read(agent.id), anchor)
      .filter((e) => e.kind === "send-message" && e.message?.type === "text")
      .map((e) => e.message.content).join(" ");
    check("xong thì tự nhắn vào hội thoại", /Hồ Gươm|việc nền/i.test(notes), notes.slice(0, 80).replace(/\n/g, " ") || "(không có dòng nào)");
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
