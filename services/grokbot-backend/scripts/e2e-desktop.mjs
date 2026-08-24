/**
 * Giai đoạn 1 của docs/plan/desktop-computer-use.md, kiểm trên box thật.
 *
 * Năm nhóm, xếp theo thứ tự "sai thì hỏng tới đâu":
 *
 *   1. bề mặt      — tool có được chào không, nó có biết màn hình rộng bao nhiêu không
 *   2. nguyên thuỷ — chụp / đọc con trỏ / di chuột, mỗi cái kiểm bằng một nguồn ĐỘC LẬP
 *                    (đọc lại con trỏ, đo lại ảnh) chứ không tin vào `ok:true` của driver
 *   3. đối số sai  — thiếu toạ độ phải bị chặn tại chỗ, vì gửi đi là bấm mù
 *   4. bấm và gõ   — xác nhận qua DOM, không qua lời driver tự khai
 *   5. THỊ GIÁC    — nhóm duy nhất chứng minh vòng lặp có thật
 *
 * Nhóm 5 làm theo cách không thể gian lận: đặt một từ ngẫu nhiên lên màn hình box rồi hỏi bot từ
 * đó là gì. Model không nhìn được thì không có cách nào đoán ra. Bốn nhóm trên vẫn xanh nguyên khi
 * model mù — nên bỏ nhóm 5 là tự kết luận sai về chính thứ giai đoạn 1 hứa hẹn.
 *
 * Cần backend đang chạy:  pnpm backend
 *   node scripts/e2e-desktop.mjs
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

/** Gọi một tool và trả về các entry mới nó sinh ra. */
async function callTool(agentId, name, args) {
  const before = (await post("getAgentTranscript", { id: agentId, limit: 200 })).entries?.length ?? 0;
  await post("sendPrompt", {
    agentId, content: `/tool ${name} ${JSON.stringify(args)}`,
    clientNonce: `d${Date.now()}${Math.random()}`,
  });
  for (let i = 0; i < 40; i++) {
    await sleep(700);
    const fresh = ((await post("getAgentTranscript", { id: agentId, limit: 200 })).entries ?? []).slice(before);
    const tc = fresh.find((e) => e.kind === "tool-call");
    if (tc && (tc.status === "done" || tc.status === "failed")) {
      await sleep(400);
      return ((await post("getAgentTranscript", { id: agentId, limit: 200 })).entries ?? []).slice(before);
    }
  }
  return [];
}
const resultOf = (fresh) => fresh.find((e) => e.kind === "tool-call")?.result ?? "";

/**
 * Nói với bot bằng lời người rồi đọc câu CHỐT.
 *
 * Chờ theo "cả đoạn hội thoại đứng yên", không theo "bong bóng này hết streaming". Bản đầu chờ kiểu
 * sau và chốt nhầm ngay câu mở đầu — "Tôi chụp màn hình rồi đọc cho bạn ngay" — trong khi câu trả
 * lời thật xuất hiện sau đó hai bước công cụ. Nó báo FAIL cho một tính năng đang chạy đúng, đúng
 * kiểu sai tốn nhất: nghi ngờ nhầm chỗ.
 */
async function ask(agentId, content, waitMs = 150_000) {
  const before = (await post("getAgentTranscript", { id: agentId, limit: 300 })).entries?.length ?? 0;
  await post("sendPrompt", { agentId, content, clientNonce: `a${Date.now()}${Math.random()}` });
  const until = Date.now() + waitMs;
  let sig = "", stable = 0, last = "";
  while (Date.now() < until) {
    await sleep(2000);
    const fresh = ((await post("getAgentTranscript", { id: agentId, limit: 300 })).entries ?? []).slice(before);
    const busy = fresh.some((e) => (e.kind === "tool-call" && e.status !== "done" && e.status !== "failed")
      || (e.kind === "send-message" && e.streaming));
    const bubbles = fresh.filter((e) => e.kind === "send-message" && e.message?.type === "text" && e.message.content);
    last = bubbles[bubbles.length - 1]?.message?.content ?? last;
    const now = `${fresh.length}|${busy}|${last}`;
    stable = now === sig ? stable + 1 : 0;
    sig = now;
    if (!busy && stable >= 2) return { text: last, fresh };
  }
  return { text: last, fresh: ((await post("getAgentTranscript", { id: agentId, limit: 300 })).entries ?? []).slice(before) };
}

const { agent } = await post("createAgent", { name: "DesktopE2E" });
console.log(`bot thử: ${agent.id}\n`);
const WORD = `MOC-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;

// ── 1. bề mặt ────────────────────────────────────────────────────────────────
console.log("1. tool có mặt và biết màn hình rộng bao nhiêu");
{
  const r = resultOf(await callTool(agent.id, "computer_use", { action: "screen_info" }));
  check("computer_use được đăng ký", r !== "" && !/unknown tool/i.test(r), r || "không có kết quả");
  check("screen_info trả về kích thước", /\d{3,4}x\d{3,4}/.test(r), r);
}

// ── 2. nguyên thuỷ, kiểm bằng nguồn độc lập ─────────────────────────────────
console.log("\n2. chụp / con trỏ / di chuột — kiểm bằng nguồn khác, không tin ok:true");
let screenW = 0, screenH = 0;
{
  const fresh = await callTool(agent.id, "computer_use", { action: "screenshot" });
  const said = resultOf(fresh);
  const att = fresh.find((e) => e.message?.type === "attachment");
  check("chụp màn hình sinh ra một ảnh đính kèm", att != null, att ? att.message.url : "không có attachment");
  if (att) {
    // Đọc lại bằng đúng đường FE dùng: không đo được thì FE không vẽ, ảnh coi như không có.
    const img = await post("readAttachmentImage", { path: att.message.url });
    check("ảnh đo được kích thước thật", img?.width > 0 && img?.height > 0, img ? `${img.width}x${img.height}` : "readAttachmentImage trả null");
    screenW = img?.width ?? 0; screenH = img?.height ?? 0;
    check("tỉ lệ 1:1 với màn hình (không thu nhỏ)", said.includes(`${screenW}x${screenH}`),
      `kết quả nói "${said}", ảnh là ${screenW}x${screenH}`);
  }
}
{
  // Di chuột tới một điểm rồi ĐỌC LẠI con trỏ. `ok:true` không chứng minh chuột đã đi.
  const x = 731, y = 419;
  await callTool(agent.id, "computer_use", { action: "mouse_move", x, y });
  const r = resultOf(await callTool(agent.id, "computer_use", { action: "cursor_position" }));
  check("chuột thật sự đã tới nơi", r.includes(`(${x}, ${y})`), r);
}

// ── 3. đối số sai bị chặn tại chỗ ────────────────────────────────────────────
console.log("\n3. đối số sai bị chặn trước khi ra khỏi máy");
{
  const noXY = resultOf(await callTool(agent.id, "computer_use", { action: "click" }));
  check("click thiếu toạ độ bị từ chối", /cần "x" và "y"/.test(noXY), noXY);
  const weird = resultOf(await callTool(agent.id, "computer_use", { action: "double_click", x: 1, y: 2 }));
  check("action lạ bị từ chối kèm danh sách thật", /không có action/.test(weird) && /mouse_move/.test(weird), weird.slice(0, 90));
}

// ── 4. bấm và gõ, xác nhận qua DOM ───────────────────────────────────────────
console.log("\n4. bấm và gõ tới đúng chỗ — xác nhận bằng DOM, không bằng lời driver");
{
  // Ô input phủ kín khung nhìn, nên bấm giữa màn hình chắc chắn rơi vào ô dù cửa sổ Chrome nằm
  // đâu. Một lần thử trước đã thất bại chỉ vì tab bị mở lại và mất tiêu điểm — bố cục không phải
  // thứ nên đem ra cá cược trong test.
  const html = "<body style='margin:0;background:%23111'><input id=t style='position:fixed;inset:0;width:100%25;height:100%25;font:48px monospace;background:%23111;color:%23eee;border:0;text-align:center'></body>";
  await callTool(agent.id, "browser_navigate", { url: `data:text/html,${html}` });
  await sleep(1500);
  const cx = Math.round((screenW || 1920) / 2), cy = Math.round((screenH || 1080) / 2);
  await callTool(agent.id, "computer_use", { action: "click", x: cx, y: cy });
  await sleep(400);
  const focus = resultOf(await callTool(agent.id, "browser_evaluate", { expression: "document.activeElement && document.activeElement.id" }));
  check("cú bấm rơi vào ô input", /(^|\W)t(\W|$)/.test(focus), focus.slice(0, 80));
  await callTool(agent.id, "computer_use", { action: "type", text: WORD });
  await callTool(agent.id, "computer_use", { action: "key", key: "exclam" });
  await sleep(500);
  const val = resultOf(await callTool(agent.id, "browser_evaluate", { expression: "document.getElementById('t').value" }));
  check("chữ đã gõ nằm trong ô", val.includes(WORD), val.slice(0, 80));
  check("phím rời tới được (exclam ⇒ !)", val.includes(`${WORD}!`), val.slice(0, 80));
}

// ── 5. THỊ GIÁC — nhóm duy nhất chứng minh vòng lặp có thật ──────────────────
console.log("\n5. model có NHÌN được tấm ảnh nó vừa chụp không");
{
  const html = `<body style='margin:0;background:%23fff;color:%23000;font:90px monospace;display:flex;align-items:center;justify-content:center;height:100vh'>${WORD}</body>`;
  await callTool(agent.id, "browser_navigate", { url: `data:text/html,${html}` });
  await sleep(2000);
  const { text } = await ask(agent.id,
    "Chụp màn hình máy tính của bạn bằng computer_use, rồi đọc cho tôi CHÍNH XÁC dòng chữ lớn đang hiện trên màn hình. Chỉ trả lời dòng chữ đó, không giải thích.");
  check("model đọc được chữ trên màn hình", text.includes(WORD),
    `chờ "${WORD}", nhận: ${JSON.stringify(text.slice(0, 200))}`);
}

// ── 6. VÒNG LẶP ĐẦY ĐỦ — nhìn, rồi hành động theo cái vừa nhìn ──────────────
console.log("\n6. bot tự nhìn màn hình rồi bấm đúng chỗ (không ai cho toạ độ)");
{
  // Nút đặt ở một chỗ ngẫu nhiên, và KHÔNG có selector nào được nói ra. Bot chỉ có tấm ảnh.
  // Đây là điều duy nhất giai đoạn 1 hứa hẹn mà bốn nhóm đầu không chứng minh được.
  const left = 12 + Math.floor(Math.random() * 50), top = 12 + Math.floor(Math.random() * 50);
  const html = "<body style='margin:0;background:%23f6f6f6;font:24px sans-serif'>"
    + `<button id=b style='position:fixed;left:${left}%25;top:${top}%25;padding:26px 44px;font:bold 34px sans-serif;background:%23c62828;color:%23fff;border:0;border-radius:10px'>BAM VAO DAY</button>`
    + "<div id=r style='position:fixed;left:8px;bottom:8px;color:%23888'>chua bam</div>"
    + "<script>document.getElementById('b').onclick=function(){document.getElementById('r').textContent='DA-BAM'}</script></body>";
  await callTool(agent.id, "browser_navigate", { url: `data:text/html,${html}` });
  await sleep(1500);
  // Đưa con trỏ ra xa để một cú bấm "đứng yên tại chỗ" không vô tình trúng nút.
  await callTool(agent.id, "computer_use", { action: "mouse_move", x: 40, y: 1040 });
  await ask(agent.id,
    "Trên màn hình máy tính của bạn có một nút màu đỏ. Hãy chụp màn hình, tự xác định toạ độ của nút "
    + "trên ảnh, rồi dùng computer_use để bấm vào chính giữa nút đó. Không dùng công cụ browser_.");
  const r = resultOf(await callTool(agent.id, "browser_evaluate", { expression: "document.getElementById('r').textContent" }));
  check("bot tự tìm được nút và bấm trúng", r.includes("DA-BAM"), `ô kết quả nói: ${r.slice(0, 40)}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
