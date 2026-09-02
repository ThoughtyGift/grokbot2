/**
 * Đo TỰ LÀNH thật: giết Chrome của mình trên box, rồi bảo backend mở một trang.
 *
 *   npx tsx --env-file=.env services/grokbot-backend/scripts/do-tu-lanh-chrome.mts
 *
 * Bài test `browser-tu-lanh.test.ts` chỉ phủ điều kiện quyết định (khoảng nghỉ, màn hình riêng).
 * Vế còn lại — chở script lên box, chạy, rồi gọi lại CDP — chỉ chứng minh được bằng một lượt thật:
 * đúng bài học "test xanh không có nghĩa là đúng" trong §7 bảng theo dõi.
 *
 * Chỉ giết Chrome trên cổng của CHÍNH MÌNH (9224). Box dùng chung: 15 Chrome của user `box`, 58 của
 * `root` — `pkill -f chrome` ở đây là giết phần mềm người khác.
 */
process.env.GROKBOT2_BROWSER_CDP = `http://127.0.0.1:${process.env.CHROME_CDP_PORT ?? "9224"}`;

const { boxCall, boxConfigured } = await import("../src/box-exec.js");
if (!boxConfigured()) { console.error("box chưa cấu hình"); process.exit(2); }

const CONG = process.env.CHROME_CDP_PORT ?? "9224";
const chay = async (command: string) => {
  const r = await boxCall<{ stdout?: string; stderr?: string; exitCode?: number }>("exec", { command });
  return `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();
};
const congMo = async () => (await chay(`ss -lnt 2>/dev/null | grep -c ':${CONG}' || true`)).trim() !== "0";

console.log(`cổng ${CONG} trước khi giết: ${await congMo() ? "MỞ" : "đóng"}`);

// `pkill -f` với đúng chuỗi cổng: nó chỉ khớp tiến trình có `--remote-debugging-port=<cổng>` trong
// cmdline, tức Chrome của mình. Không dùng `-f chrome`.
await chay(`pkill -f -- "remote-debugging-port=${CONG}"; sleep 2; echo xong`);
console.log(`cổng ${CONG} sau khi giết  : ${await congMo() ? "MỞ (giết không thành)" : "đóng"}`);

// ── giờ bảo backend làm một việc browser; nó phải tự bật lại Chrome ────────────────────────────
const { runBrowserTool } = await import("../src/browser.js");
console.log("\ngọi browser_navigate qua backend (chưa bật lại tay)…");
const ra = await runBrowserTool("browser_navigate", JSON.stringify({ url: "about:blank" }));
console.log(`kết quả: ${String(ra).replace(/\s+/g, " ").slice(0, 160)}`);

const lai = await congMo();
console.log(`\ncổng ${CONG} sau lượt gọi : ${lai ? "MỞ" : "đóng"}`);
console.log(lai
  ? "✔ TỰ LÀNH được — backend bật lại trình duyệt và làm xong việc"
  : "✘ không tự lành — xem log `[grokbot2] browser:` phía trên");
process.exit(lai ? 0 : 1);
