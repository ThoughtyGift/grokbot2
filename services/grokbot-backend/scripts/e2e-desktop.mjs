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

const LIMIT = 400;
const read = async (agentId) => (await post("getAgentTranscript", { id: agentId, limit: LIMIT })).entries ?? [];

/**
 * "Những gì mới kể từ lúc này" — neo vào ID của entry cuối, KHÔNG vào số lượng entry.
 *
 * Đếm rồi `slice(n)` chỉ đúng khi transcript ngắn hơn `limit`. Bot thử được dùng lại nên nó dài ra
 * theo từng lần chạy, và khi vượt 200 thì `before` luôn bằng 200, `slice(200)` luôn rỗng — mười
 * phép kiểm báo FAIL trong khi mọi tool đều chạy đúng. Một bộ đo hỏng trông y hệt một tính năng
 * hỏng, và đó là kiểu sai tốn thời gian nhất.
 */
const anchorOf = (entries) => entries[entries.length - 1]?.id ?? null;
const since = (entries, anchor) => {
  const i = anchor ? entries.findIndex((e) => e.id === anchor) : -1;
  return i >= 0 ? entries.slice(i + 1) : entries;
};

/** Gọi một tool và trả về các entry mới nó sinh ra. */
async function callTool(agentId, name, args) {
  const anchor = anchorOf(await read(agentId));
  await post("sendPrompt", {
    agentId, content: `/tool ${name} ${JSON.stringify(args)}`,
    clientNonce: `d${Date.now()}${Math.random()}`,
  });
  for (let i = 0; i < 40; i++) {
    await sleep(700);
    const fresh = since(await read(agentId), anchor);
    const tc = fresh.find((e) => e.kind === "tool-call");
    if (tc && (tc.status === "done" || tc.status === "failed")) {
      await sleep(400);
      return since(await read(agentId), anchor);
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
  const anchor = anchorOf(await read(agentId));
  await post("sendPrompt", { agentId, content, clientNonce: `a${Date.now()}${Math.random()}` });
  return waitQuiet(agentId, anchor, waitMs);
}

/** Chờ tới khi bot ngừng hẳn — dùng cho cả tin nhắn lẫn routine tự chạy. */
async function waitQuiet(agentId, anchor, waitMs = 150_000) {
  const until = Date.now() + waitMs;
  let sig = "", stable = 0, last = "";
  while (Date.now() < until) {
    await sleep(2000);
    const fresh = since(await read(agentId), anchor);
    const busy = fresh.some((e) => (e.kind === "tool-call" && e.status !== "done" && e.status !== "failed")
      || (e.kind === "send-message" && e.streaming));
    const bubbles = fresh.filter((e) => e.kind === "send-message" && e.message?.type === "text" && e.message.content);
    last = bubbles[bubbles.length - 1]?.message?.content ?? last;
    const now = `${fresh.length}|${busy}|${last}`;
    stable = now === sig ? stable + 1 : 0;
    sig = now;
    if (!busy && stable >= 2) return { text: last, fresh };
  }
  return { text: last, fresh: since(await read(agentId), anchor) };
}

/**
 * Dùng lại một bot thử duy nhất.
 *
 * Bản đầu tạo bot mới mỗi lần chạy, và sau sáu lần chạy trong một buổi thì bảng bot của người dùng
 * có sáu con "DesktopE2E" chen giữa bot thật của họ. Một bài kiểm chạy nhiều lần không được để lại
 * dấu vết tích luỹ.
 */
/**
 * Không chạy khi có bot khác đang làm việc.
 *
 * Bài này lái đúng con Chrome và đúng cái màn hình mà mọi bot đang dùng chung. Lần đầu chạy nó đã
 * cắt ngang một bot đang phân tích trang Shopee: pane "màn hình" của bot đó hiện ra trang test của
 * bài kiểm. Một bài kiểm không được phép phá công việc thật, kể cả khi nó đang kiểm một tính năng
 * thật.
 */
const roster = await post("listAgents", {});
const busy = (Array.isArray(roster) ? roster : Object.values(roster))
  .filter((a) => a?.name !== "DesktopE2E" && (a?.isRunning === true || a?.isRunningTurn === true));
if (busy.length) {
  console.log(`DỪNG: ${busy.map((a) => a.name ?? a.id).join(", ")} đang chạy — bài này dùng chung màn hình`);
  console.log("Chờ bot kia xong rồi chạy lại, hoặc chạy trên một box riêng.");
  process.exit(2);
}
const existing = (Array.isArray(roster) ? roster : Object.values(roster)).find((a) => a?.name === "DesktopE2E");
const agent = existing ?? (await post("createAgent", { name: "DesktopE2E" })).agent;
console.log(`bot thử: ${agent.id}${existing ? " (dùng lại)" : " (mới tạo)"}\n`);
const WORD = `MOC-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
let createdRoutineId = null;

/**
 * Cùng một biểu mẫu, hai bố cục.
 *
 * Bài dạy diễn ra trên A, bài chạy lại diễn ra trên B — nút chuyển sang phía đối diện và đổi độ
 * cao. Đó là toàn bộ điểm của giai đoạn 2: nếu bot bấm theo toạ độ đã ghi thì trên B nó bấm vào
 * chỗ trống, và ô kết quả sẽ nói thẳng ra điều đó.
 */
const LAYOUT_A = { inputLeft: 40, inputTop: 60, btnLeft: 40, btnTop: 220 };
const LAYOUT_B = { inputLeft: 900, inputTop: 420, btnLeft: 900, btnTop: 600 };
const form = (L) => "<body style='margin:0;font:20px sans-serif;background:%23fafafa'>"
  + `<input id=t placeholder='Ten khach hang' style='position:fixed;left:${L.inputLeft}px;top:${L.inputTop}px;width:700px;height:90px;padding:0 16px;font:30px sans-serif'>`
  + `<button id=b style='position:fixed;left:${L.btnLeft}px;top:${L.btnTop}px;width:700px;height:140px;font:bold 40px sans-serif;background:%231565c0;color:%23fff;border:0;border-radius:10px'>LUU HO SO</button>`
  + "<div id=r style='position:fixed;left:40px;bottom:20px;color:%23888;font:24px monospace'>chua luu</div>"
  + "<script>b.onclick=function(){r.textContent='DA-LUU: '+t.value}</script></body>";

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

// ── 7. GIAI ĐOẠN 2 — dạy một việc trên desktop rồi lưu thành routine ────────
console.log("\n7. dạy trên desktop: ghi thao tác, tả lại bằng lời, lưu thành routine");
{
  // Các phần tử để to hẳn: bài kiểm này kiểm BỘ GHI, không kiểm khả năng bấm chính xác của tôi.
  // Một cú bấm trượt mép nút vẫn được ghi đúng, nhưng lời mô tả sinh ra sẽ nói về cái mép đó.
  await callTool(agent.id, "browser_navigate", { url: `data:text/html,${form(LAYOUT_A)}` });
  await sleep(1500);

  const started = await post("startDesktopTeachRecording", { agentId: agent.id });
  check("bật được bản ghi desktop", started?.state === "recording", JSON.stringify(started).slice(0, 80));
  await sleep(2500);

  // "Người dùng" làm mẫu. Ở đây do driver giai đoạn 1 bơm vào — XRecord thấy cả input của XTEST,
  // nên e2e tự lái được một buổi dạy mà không cần người ngồi bấm.
  await callTool(agent.id, "computer_use", { action: "click", x: 300, y: 250 });
  await callTool(agent.id, "computer_use", { action: "type", text: "Nguyen Van A" });
  await callTool(agent.id, "computer_use", { action: "click", x: 300, y: 435 });
  await sleep(1500);

  const stopped = await post("stopDesktopTeachRecording", { agentId: agent.id, save: true });
  check("ghi được thao tác", (stopped?.steps ?? 0) >= 3, `${stopped?.steps} bước`);
  check("lưu thành routine", typeof stopped?.saved === "string" && stopped.saved.length > 0,
    stopped?.saved ?? JSON.stringify(stopped).slice(0, 80));

  const list = await post("listAllAutomations", {});
  const rows = Array.isArray(list) ? list : (list.automations ?? list.list ?? []);
  const saved = rows.find((r) => (r?.name ?? "") === stopped?.saved);
  createdRoutineId = saved?.id ?? null;
  const prompt = saved?.prompt ?? saved?.trigger?.prompt ?? "";
  check("routine có mặt trong bảng Routines", saved != null, saved ? saved.name : `${rows.length} routine, không thấy`);
  // Điểm cốt lõi của giai đoạn 2: bước phải mô tả THỨ cần bấm, không chỉ toạ độ. Chỉ có toạ độ thì
  // routine hỏng ngay lần đầu cửa sổ nằm khác chỗ — và hỏng im lặng.
  check("mỗi bước bấm được tả bằng lời, không chỉ toạ độ", /bấm vào "[^"]{10,}"/.test(prompt),
    prompt ? prompt.split("\n").find((l) => l.startsWith("1.")) ?? prompt.slice(0, 80) : "routine không có prompt");
  check("chữ đã gõ nằm trong routine", prompt.includes("Nguyen Van A"), prompt ? "có" : "không");
}

// ── 8. CHẠY LẠI — phép thử thật của giai đoạn 2 ─────────────────────────────
console.log("\n8. chạy lại bài đã dạy trên một BỐ CỤC KHÁC");
if (!createdRoutineId) {
  check("chạy lại được bài đã dạy", false, "nhóm 7 chưa tạo được routine nên không có gì để chạy");
} else {
  // Đổi bố cục trước khi chạy. Nếu bot bấm theo toạ độ đã ghi, trên bố cục này nó bấm vào nền
  // trống — và ô kết quả vẫn nói "chua luu". Không có cách nào đi qua bài này bằng toạ độ cũ.
  await callTool(agent.id, "browser_navigate", { url: `data:text/html,${form(LAYOUT_B)}` });
  await sleep(1500);
  const before = resultOf(await callTool(agent.id, "browser_evaluate", { expression: "document.getElementById('r').textContent" }));
  check("bố cục mới bắt đầu ở trạng thái sạch", before.includes("chua luu"), before.slice(0, 40));

  const anchor = anchorOf(await read(agent.id));
  await post("runAgentAutomationNow", { agentId: agent.id, automationId: createdRoutineId });
  const { fresh } = await waitQuiet(agent.id, anchor, 300_000);

  const calls = fresh.filter((e) => e.kind === "tool-call" && e.name === "computer_use");
  const looked = calls.filter((e) => /screenshot/.test(e.summary ?? "")).length;
  check("bot dùng computer_use chứ không lén dùng browser_", calls.length >= 2, `${calls.length} lần gọi computer_use`);
  check("bot có nhìn màn hình trước khi bấm", looked >= 1, `${looked} lần chụp`);

  const after = resultOf(await callTool(agent.id, "browser_evaluate", { expression: "document.getElementById('r').textContent" }));
  check("bài đã dạy chạy đúng trên bố cục đã đổi", after.includes("DA-LUU: Nguyen Van A"),
    `ô kết quả nói: ${after.slice(0, 60)}`);
}

// ── 9. APP THẬT, KHÔNG PHẢI TRANG WEB ───────────────────────────────────────
console.log("\n9. dạy và chạy lại trên một app X11 GỐC (xmessage), cửa sổ đã dời chỗ");
let routine9 = null;
{
  // `xmessage` là app X11 thật, toolkit Athena — nút của nó không giống bất cứ thứ gì trên web,
  // và không có DOM nào để hỏi. Nó cũng tự khai báo kết quả một cách không thể cãi: bấm LUU thì
  // tiến trình thoát với mã 10, bấm XOA thì mã 20. Ghi mã đó ra file là có một phép kiểm khách
  // quan, không phải "model nhìn ảnh rồi bảo là đã bấm".
  const sh = (command) => callTool(agent.id, "run_terminal_command_v2", { command });
  const launch = (geom) => sh(`pkill xmessage; rm -f /tmp/xm.exit; sleep 0.3; `
    + `sh -c 'xmessage -fn 10x20 -geometry ${geom} -buttons LUU:10,XOA:20 "Ho so khach hang - ban muon lam gi?"; `
    + `echo $? > /tmp/xm.exit' > /tmp/xm.log 2>&1 < /dev/null & sleep 2; echo started`);
  // `run_terminal_command_v2` trả về "exit=0 / stdout: / <output>", không trả về mỗi output.
  // Bản đầu so cả chuỗi đó với "10" và báo FAIL cho ba phép kiểm ĐANG ĐÚNG.
  const stdoutOf = (text) => {
    const i = String(text).indexOf("stdout:");
    const body = i >= 0 ? String(text).slice(i + 7) : String(text);
    return body.split(/stderr:/)[0].trim();
  };
  const exitCode = async () => stdoutOf(resultOf(await sh("cat /tmp/xm.exit 2>/dev/null || echo none")));

  // Nút LUU nằm ở gốc cửa sổ + (29, 78) — đo trên màn hình thật, và mã thoát dưới đây sẽ nói
  // ngay nếu số đó sai, nên không có chuyện dạy nhầm mà tưởng là đúng.
  const LUU = (gx, gy) => ({ x: gx + 29, y: gy + 78 });

  await launch("+120+120");
  const started = stdoutOf(resultOf(await sh("ps -eo args | grep -c '[x]message'")));
  check("app X11 gốc đang chạy", Number(started) >= 1, started.slice(0, 20));

  const rec = await post("startDesktopTeachRecording", { agentId: agent.id });
  check("ghi được trên app gốc", rec?.state === "recording", JSON.stringify(rec).slice(0, 60));
  await sleep(2000);
  const p = LUU(120, 120);
  await callTool(agent.id, "computer_use", { action: "click", x: p.x, y: p.y });
  await sleep(1200);
  check("bài dạy thật sự bấm trúng nút LUU", (await exitCode()) === "10", await exitCode());

  const saved = await post("stopDesktopTeachRecording", { agentId: agent.id, save: true });

  const rows9 = await post("listAllAutomations", {});
  const list9 = Array.isArray(rows9) ? rows9 : (rows9.automations ?? []);
  const row9 = list9.find((r) => (r?.name ?? "") === saved?.saved);
  routine9 = row9?.id ?? null;
  const prompt9 = row9?.prompt ?? "";
  // Mô tả của một widget gốc hay chứa dấu nháy bên trong (nút "LƯU" cạnh nút "XOÁ"), nên
  // `[^"]{10,}` khớp hụt ngay ở dấu nháy đầu tiên và báo FAIL cho một mô tả hoàn toàn đúng.
  const line9 = prompt9.split("\n").find((l) => l.startsWith("1.")) ?? "";
  check("nút của app gốc được tả bằng lời", /^1\. bấm vào "/.test(line9) && line9.length > 60,
    line9 || "không có routine");

  // Dời cửa sổ đi chỗ khác. Toạ độ đã ghi giờ trỏ vào nền trống.
  await launch("+900+600");
  check("mở lại app ở chỗ khác, chưa ai bấm", (await exitCode()) === "none", await exitCode());

  if (routine9) {
    const anchor9 = anchorOf(await read(agent.id));
    await post("runAgentAutomationNow", { agentId: agent.id, automationId: routine9 });
    await waitQuiet(agent.id, anchor9, 300_000);
    const code = await exitCode();
    check("bài đã dạy bấm đúng nút trên app gốc đã dời chỗ", code === "10",
      code === "20" ? "bấm nhầm nút XOA" : code === "none" ? "không bấm trúng gì cả" : code);
  } else {
    check("bài đã dạy bấm đúng nút trên app gốc đã dời chỗ", false, "không tạo được routine");
  }
  await sh("pkill xmessage; rm -f /tmp/xm.exit; echo done");
  if (routine9) await post("deleteAgentAutomation", { agentId: agent.id, automationId: routine9 });
}

// Routine do bài kiểm tự tạo thì bài kiểm tự dọn — nếu không, mỗi lần chạy để lại một dòng
// "Việc đã dạy trên máy" trong bảng Routines của người dùng.
if (createdRoutineId) {
  // `automationId`, không phải `id`: deleteAgentAutomation tra theo trường đó, và gọi sai tên thì
  // nó trả về danh sách như thường mà không xoá gì — im lặng đúng nghĩa. Bản dọn đầu tiên gọi sai
  // và báo "đã dọn" trong khi routine vẫn nằm nguyên trong bảng.
  await post("deleteAgentAutomation", { agentId: agent.id, automationId: createdRoutineId });
  const after = await post("listAllAutomations", {});
  const still = (Array.isArray(after) ? after : after.automations ?? []).some((r) => r?.id === createdRoutineId);
  console.log(`\n(${still ? "KHÔNG dọn được" : "đã dọn"} routine thử ${createdRoutineId})`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
