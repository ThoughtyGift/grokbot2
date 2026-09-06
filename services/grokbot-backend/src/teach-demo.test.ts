/**
 * Dạy việc bằng video — phần đếm được của nó.
 *
 *   npx tsx --test services/grokbot-backend/src/teach-demo.test.ts
 *
 * Phần "bot học được gì từ video" thì chỉ một lượt thật trả lời được. Phần dưới đây là những thứ
 * hỏng lặng lẽ nếu sai: skill bị nhân bản mỗi buổi dạy, bài học thiếu mục chống một cách hỏng đã
 * biết, hay bộ quay chạy hai phiên chồng nhau.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.GROKBOT2_WORKFLOWS_FILE = join(tmpdir(), `grokbot2-teachdemo-test-${process.pid}.json`);

const { dungSkillHocTuDemo, NOI_DUNG_SKILL, TEN_SKILL, CAU_GHI_XONG, batDauQuayDemo, dangQuayDemo, dungQuayDemo } =
  await import("./teach-demo.js");
const { forAgent, _xoaHet } = await import("./workflows.js");

test("dựng skill một lần, gọi lại KHÔNG đẻ thêm bản trùng tên", () => {
  _xoaHet();
  const a = "agent-td-1";
  const m1 = dungSkillHocTuDemo(a);
  const m2 = dungSkillHocTuDemo(a);
  assert.equal(m1.id, m2.id, "buổi dạy thứ hai phải dùng lại skill cũ");
  assert.equal(forAgent({ agentId: a }).filter((w) => w.name === TEN_SKILL).length, 1,
    "menu `/` mà mọc thêm một dòng giống hệt sau mỗi buổi dạy thì vài hôm là không tìm được gì");
});

test("skill là của TỪNG bot — kho chia theo bot", () => {
  _xoaHet();
  dungSkillHocTuDemo("agent-td-a");
  dungSkillHocTuDemo("agent-td-b");
  assert.equal(forAgent({ agentId: "agent-td-a" }).length, 1);
  assert.equal(forAgent({ agentId: "agent-td-b" }).length, 1);
});

test("bài học có đủ bốn mục chống bốn cách hỏng đã biết", () => {
  // Mỗi dòng dưới đây tương ứng một chỗ đã trả giá; mất mục nào là mở lại đúng cái bẫy đó.
  assert.match(NOI_DUNG_SKILL, /khung hình/, "xem thử trước — bản ghi trắng phải lộ ra sớm");
  assert.match(NOI_DUNG_SKILL, /INPUT/, "tách input khỏi hằng số — không có thì skill chỉ chạy lại đúng một lần ấy");
  assert.match(NOI_DUNG_SKILL, /toạ độ/, "bám nhãn thay vì toạ độ — toạ độ là thứ làm hai bộ ghi cũ giòn");
  assert.match(NOI_DUNG_SKILL, /OTP|mật khẩu/, "bản ghi màn hình thấy mọi thứ, kể cả thứ không được chép lại");
});

test("bài học gọi ĐÚNG tool tạo workflow, không nhầm sang create_skill", () => {
  // `create_skill` ghi một tệp SOP lên đĩa box và tệp đó nằm trong MỌI lượt chat sau đó;
  // `create_workflow` mới là thứ hiện trong menu `/`. Nhầm hai cái là bài học đi lạc chỗ.
  assert.match(NOI_DUNG_SKILL, /create_workflow/);
  assert.match(NOI_DUNG_SKILL, /KHÁC `create_skill`/);
});

test("giữ nguyên văn câu app gốc gửi khi ghi xong", () => {
  // Client gốc gửi đúng chuỗi này kèm chip skill. Đổi chữ ở đây là tự tách khỏi bản ghi của họ.
  assert.equal(CAU_GHI_XONG, "The recording is finished. Learn the task from it.");
  assert.equal(TEN_SKILL, "learn-from-demonstration");
});

test("không có box thì không quay, và nói ra vì sao", async () => {
  const cu = process.env.GROKBOT2_BOX_EXEC_URL;
  const cu2 = process.env.GROKBOT2_COMPUTER_URL;
  delete process.env.GROKBOT2_BOX_EXEC_URL;
  delete process.env.GROKBOT2_COMPUTER_URL;
  try {
    const r = await batDauQuayDemo("agent-td-x");
    assert.equal(r.ok, false);
    assert.match(String(r.lyDo), /box/);
    assert.equal(dangQuayDemo(), false);
    assert.equal(await dungQuayDemo(), null, "dừng khi không có phiên nào phải trả null, không ném");
  } finally {
    if (cu != null) process.env.GROKBOT2_BOX_EXEC_URL = cu;
    if (cu2 != null) process.env.GROKBOT2_COMPUTER_URL = cu2;
  }
});

test("mời chạy thử với giá trị trong demo, và KHÔNG tự chạy", () => {
  // App gốc kết ca học-từ-demo bằng đúng một câu: "Muốn chạy thử với nến thơm không?"
  assert.match(NOI_DUNG_SKILL, /[Mm]ời chạy thử/);
  // Hãng kết lượt dạy bằng widget *Dry run · Để sau*; khoá `ask_question` của turn.ts mở khi `create_workflow` đã chạy.
  assert.match(NOI_DUNG_SKILL, /Mời chạy thử[^\n]*bằng `ask_question`/);
  assert.match(NOI_DUNG_SKILL, /SAU khi `create_workflow` đã chạy/);
  // Bài học vừa viết chưa ai kiểm; chạy ngay là hỏng việc trước khi người dùng kịp đọc nó.
  assert.match(NOI_DUNG_SKILL, /KHÔNG BAO GIỜ tự chạy skill vừa học/);
});

test("bàn giao: content ĐÚNG câu hằng, nonce = teach-recording:<scope>:<phiếu>.json, phần model chỉ tiêm queue scope + bài học", async () => {
  const { banGiaoBaiHoc, scopeCua } = await import("./teach-demo.js");
  const phien = {
    agentId: "agent-td-hand",
    sessionId: "teach-20260906T041200Z-5b1a0c3e-1111-4222-8333-944455556666",
    sessionDir: "/home/gb2u003/workspace/teach-sessions/teach-20260906T041200Z-5b1a0c3e-1111-4222-8333-944455556666",
    videoPath: "/home/gb2u003/workspace/teach-sessions/teach-20260906T041200Z-5b1a0c3e-1111-4222-8333-944455556666/demo.mp4",
    giay: 16,
  };
  const h = banGiaoBaiHoc(phien);
  // Renderer 0.43 (`Snn`) và `turn.ts` (`luotHocTuBanGhi`) đều so BẰNG — thêm một chữ vào content là mất cả hai.
  assert.equal(h.content, CAU_GHI_XONG);
  assert.match(h.clientNonce, /^teach-recording:[0-9a-f]{64}:teach-\d{8}T\d{6}Z-[0-9a-f-]{36}\.json$/);
  // Phần cuối của nonce là ĐÚNG tên phiếu trong hàng đợi — hãng dùng tên ấy để nhận bản ghi.
  assert.equal(h.clientNonce, `teach-recording:${scopeCua("agent-td-hand")}:${phien.sessionId}.json`);
  // Như hãng: tin CHỈ tiêm queue scope, không đưa đường dẫn video hay PID — bot tự nhận phiếu rồi đọc session.json.
  assert.match(h.modelNote, new RegExp(`Teach recording queue scope: ${scopeCua("agent-td-hand")}`));
  assert.ok(!h.modelNote.includes(phien.videoPath) && !h.modelNote.includes(phien.sessionDir), "không đưa đường dẫn phiên vào tin");
  assert.doesNotMatch(h.modelNote, /16 giây/);
  // Bài học nằm NGAY trong phần model đọc — không dựa vào việc dò `@tên` trong content.
  assert.match(h.modelNote, /create_workflow/);
  assert.match(h.modelNote, /sand-workflow:<skill-id>/);
  assert.match(h.modelNote, /actions\.md/, "nhật ký CDP đọc từ thư mục phiên, không từ tin nhắn");
  // Skill học-từ-demo đã được dựng cho đúng bot, và là skill HỆ THỐNG như hãng (renderer 0.43: source==="managed" → Managed by Cursor).
  const sk = forAgent({ agentId: "agent-td-hand" }).find((w) => w.name === TEN_SKILL);
  assert.ok(sk);
  assert.equal(sk!.source, "managed");
  // Chip skill dưới câu — đúng hình doc của hãng, id trỏ vào skill THẬT của ta để bấm mở được.
  const doc = JSON.parse(h.richText);
  assert.equal(doc.type, "doc");
  const node = doc.content[0].content[0];
  assert.equal(node.type, "workflowReference");
  assert.equal(node.attrs.id, sk!.id);
  assert.equal(node.attrs.label, "Learn from demonstration");
  assert.equal(node.attrs.teachQueueScope, h.clientNonce.split(":")[1]);
  // Scope là của BOT (hàng đợi theo bot): hai bot → hai scope; cùng bot, buổi dạy khác → cùng scope, khác phiếu.
  const h2 = banGiaoBaiHoc({ ...phien, agentId: "agent-td-khac" });
  assert.notEqual(h.clientNonce.split(":")[1], h2.clientNonce.split(":")[1]);
  const h3 = banGiaoBaiHoc({ ...phien, sessionId: "teach-20260906T041900Z-5b1a0c3e-1111-4222-8333-944455557777" });
  assert.equal(h.clientNonce.split(":")[1], h3.clientNonce.split(":")[1]);
  assert.notEqual(h.clientNonce, h3.clientNonce);
});

test("skill cũ lưu source workflow hay bài học cũ thì được NÂNG tại chỗ, không đẻ bản thứ hai", async () => {
  _xoaHet();
  const { create, update } = await import("./workflows.js");
  const a = "agent-td-nang";
  const cu = create({ agentId: a, name: TEN_SKILL, description: "bản cũ", instructions: "# Học từ một buổi demo (bản cũ)" })[0];
  assert.equal(cu.source, "workflow");
  const moi = dungSkillHocTuDemo(a);
  assert.equal(moi.id, cu.id, "cùng một skill — chip trong bản ghi cũ vẫn trỏ đúng");
  assert.equal(moi.source, "managed");
  assert.equal(moi.instructions, NOI_DUNG_SKILL);
  assert.equal(forAgent({ agentId: a }).filter((w) => w.name === TEN_SKILL).length, 1);
  // Kho không nhận giá trị source lạ.
  const la = update({ workflowId: cu.id, agentId: a, source: "plugin" }).find((w) => w.id === cu.id);
  assert.equal(la!.source, "managed");
});

test("bài học chép đủ quy trình của hãng: hàng đợi flock + lease, chờ ffmpeg đóng file, ffprobe, dọn video, chỉ đọc trình duyệt", () => {
  assert.match(NOI_DUNG_SKILL, /Teach recording queue scope/);
  assert.match(NOI_DUNG_SKILL, /teach-sessions\/queues\/\$scope/);
  assert.match(NOI_DUNG_SKILL, /flock 9/);
  assert.match(NOI_DUNG_SKILL, /lease_minutes=720/);
  assert.match(NOI_DUNG_SKILL, /jq -er .*\.sessionDir/);
  assert.match(NOI_DUNG_SKILL, /\.ffmpegPid/);
  assert.match(NOI_DUNG_SKILL, /\/proc\/"\$pid"\/cmdline/);
  assert.match(NOI_DUNG_SKILL, /ffprobe -v error -show_entries format=duration/);
  assert.match(NOI_DUNG_SKILL, /rm -f "\$video"/);
  assert.match(NOI_DUNG_SKILL, /rm -f "\$claim" "\$claim_lease"/);
  assert.match(NOI_DUNG_SKILL, /Không lấy đường dẫn hay PID từ tin nhắn/);
  assert.match(NOI_DUNG_SKILL, /actions\.md/);
  assert.match(NOI_DUNG_SKILL, /KHÔNG lái Chrome/);
  assert.match(NOI_DUNG_SKILL, /Thông tin nhạy cảm/);
  // Tool của TA, không phải của hãng — bê nguyên `Shell`/`Task`/`update_state` là dạy model gọi thứ không tồn tại.
  assert.match(NOI_DUNG_SKILL, /run_terminal_command_v2/);
  assert.match(NOI_DUNG_SKILL, /view_image/);
  assert.match(NOI_DUNG_SKILL, /watch_video/);
  assert.doesNotMatch(NOI_DUNG_SKILL, /update_state|subagent_type|block_until_ms/);
});

test("create_workflow trả id và cú pháp link để bot dẫn skill thành thẻ bấm", async () => {
  const { taoWorkflowTuBot } = await import("./teach-demo.js");
  const r = taoWorkflowTuBot({ name: "Tìm sỉ trên Alibaba", description: "khi cần nguồn hàng", instructions: "1. mở alibaba.com" }, "agent-td-link");
  const w = forAgent({ agentId: "agent-td-link" }).find((x) => x.name === "Tìm sỉ trên Alibaba");
  assert.ok(w, "skill phải được tạo");
  assert.ok(r.includes(`[Tìm sỉ trên Alibaba](sand-workflow:${w!.id})`), r);
  // Slug renderer 0.43 kiểm: /^[a-z0-9]+(?:-[a-z0-9]+)*$/ — id của ta phải qua được, nếu không link chỉ là chữ.
  assert.match(w!.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  // Trùng tên thì không đẻ bản hai và không trả link mới.
  const r2 = taoWorkflowTuBot({ name: "Tìm sỉ trên Alibaba", instructions: "khác" }, "agent-td-link");
  assert.match(r2, /Đã có skill/);
  assert.equal(forAgent({ agentId: "agent-td-link" }).filter((x) => x.name === "Tìm sỉ trên Alibaba").length, 1);
});
