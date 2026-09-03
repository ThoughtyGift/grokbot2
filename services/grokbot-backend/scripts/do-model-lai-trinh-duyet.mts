/**
 * Model nào lái được trình duyệt — đo bằng một lượt THẬT, không đọc lời đồn.
 *
 *   npx tsx --env-file=.env services/grokbot-backend/scripts/do-model-lai-trinh-duyet.mts
 *   … --models claude-opus-5,gemini-3.7-flash        (mặc định: 5 ứng viên dưới)
 *
 * ── Vì sao phải đo lại ─────────────────────────────────────────────────────────────────────────
 *
 * Trong `subagents.ts` có HAI phép đo cũ nói ngược nhau, cách nhau vài dòng:
 *   - chú thích `browserUse` : gemini-2.5-flash ✅ lái được, các model Claude ✗ ("I can't access URLs")
 *   - chú thích SUBAGENT_MODEL: gemini-2.5-flash 502 sau 38s, claude-opus-5 ✅ 6.6s
 * Cả hai đều ghi ngày, cả hai đều thật. Nên số hiện hành phải đo lại chứ không chọn bên.
 *
 * App gốc lái trình duyệt bằng một cấu hình RẺ HƠN lượt chính (`sand_browser_use_model`:
 * `thinking:false, effort:low`). Pool bên mình không có tham số effort, nên "rẻ hơn" chỉ có một
 * đường: đổi model. Bài này trả lời được đổi sang cái nào.
 *
 * Đo cái gì: lượt có phát ra `TOOL_CALL` không · có ra ĐÚNG đáp án không · mất bao lâu · mấy bước.
 * "Nhanh" mà sai thì không rẻ; nên cột đúng/sai đứng trước cột giây.
 */
import { runSubagent } from "../src/subagents.js";
import { runBrowserTool, BROWSER_TOOL_NAMES, isBrowserConfigured } from "../src/browser.js";

const argOf = (ten: string, md: string): string => {
  const i = process.argv.indexOf(ten);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : md;
};

const MODELS = argOf("--models", "claude-opus-5,claude-haiku-4-5,gemini-3.7-flash,gemini-2.5-flash,grok-4.5")
  .split(",").map((s) => s.trim()).filter(Boolean);

/** Việc cố ý TẦM THƯỜNG: một trang tĩnh, một đáp án kiểm được bằng chuỗi. */
const VIEC = "Mở https://example.com rồi cho biết TIÊU ĐỀ của trang đó. Trả lời ngắn.";
const DUNG = /example domain/i;

if (!isBrowserConfigured()) {
  console.error("GROKBOT2_BROWSER_CDP chưa đặt — không có trình duyệt thì bài này vô nghĩa.");
  process.exit(1);
}

interface Luot { model: string; buoc: number; giay: number; coToolCall: boolean; dung: boolean; baoCao: string }

const ketQua: Luot[] = [];
for (const model of MODELS) {
  process.env.GROKBOT2_BROWSER_MODEL = model;   // `modelChoSubagent` đọc lúc GỌI, nên đổi được trong một tiến trình
  let buoc = 0;
  const t0 = Date.now();
  let baoCao = "";
  try {
    baoCao = await runSubagent("browserUse", VIEC, BROWSER_TOOL_NAMES, {
      runTool: async (ten, arg) => { buoc += 1; return runBrowserTool(ten, arg); },
      onStep: () => {},
    });
  } catch (e) {
    baoCao = `(ném: ${e instanceof Error ? e.message : String(e)})`;
  }
  const giay = Math.round((Date.now() - t0) / 100) / 10;
  ketQua.push({ model, buoc, giay, coToolCall: buoc > 0, dung: DUNG.test(baoCao), baoCao: baoCao.replace(/\s+/g, " ").slice(0, 90) });
  console.log(`${buoc > 0 && DUNG.test(baoCao) ? "✅" : "❌"} ${model.padEnd(20)} ${String(buoc).padStart(2)} bước · ${String(giay).padStart(6)}s · ${baoCao.replace(/\s+/g, " ").slice(0, 80)}`);
}
delete process.env.GROKBOT2_BROWSER_MODEL;

console.log("\n# BẢNG\n");
console.log("| model | TOOL_CALL | đúng | bước | giây |");
console.log("|---|---|---|---|---|");
for (const r of ketQua) {
  console.log(`| ${r.model} | ${r.coToolCall ? "có" : "KHÔNG"} | ${r.dung ? "✅" : "❌"} | ${r.buoc} | ${r.giay} |`);
}

const dat = ketQua.filter((r) => r.dung && r.coToolCall).sort((a, b) => a.giay - b.giay);
console.log(
  dat.length
    ? `\nRẺ NHẤT mà vẫn ĐÚNG: ${dat[0].model} (${dat[0].giay}s). Đặt GROKBOT2_BROWSER_MODEL nếu muốn dùng.`
    : "\nKhông model nào vừa lái được vừa ra đúng đáp án — GIỮ nguyên mặc định.",
);
