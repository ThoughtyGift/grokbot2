/**
 * Patch: kênh cập nhật trỏ về BACKEND CỦA MÌNH, không phải máy chủ hãng.
 *
 * ── Vì sao đây là bản vá quan trọng nhất của bộ ───────────────────────────────────────────────
 *
 * Hằng này là địa chỉ mặc định client hỏi "có bản mới không":
 *
 *     var JBn = "https://api2.cursor.sh/updates"        // 0.29
 *     var t4n = "https://api2.cursor.sh/updates"        // 0.30 — cùng chuỗi, khác tên rút gọn
 *
 * và nó được dùng làm `feedBaseUrl ?? t4n` trong `SandUpdateService.fetchUpdate`. Chừng nào nó còn
 * trỏ về hãng thì mọi cách bảo vệ đều là bịt đường CHẠY chứ không bịt đường ĐI: bỏ
 * `SAND_DISABLE_UPDATES` hay gỡ `sandLab` một lần là app tự tải bản của hãng, cài đè, và
 * `resources/app` biến mất cùng cả bộ vá — im lặng, không ai được hỏi.
 *
 * Vá xong thì đảo ngược tình thế: app **không còn đường nào** tới máy chủ hãng, kể cả mở trần bằng
 * cách bấm đúp `.exe`. Nhờ đó mới bỏ được `sandLab` và bật lại banner "New update available" một
 * cách an toàn — xem `docs/plan/quy-trinh-phat-hanh-app-local.md`.
 *
 * ── Vì sao đọc biến môi trường chứ không ghim một địa chỉ ──────────────────────────────────────
 *
 * Bản cài trên máy người dùng trỏ vào backend nào là do lúc cài ghi ra (`backend.txt` → bốn biến);
 * máy này là `localhost:8788`, máy khác có thể là VPS. Ghim cứng một chuỗi ở đây là dựng sẵn một bản
 * vá sai cho mọi máy trừ máy đang ngồi.
 *
 * Nên nó đi theo ĐÚNG backend mà app vốn đã nói chuyện: `SAND_BACKEND_URL`, rồi
 * `CURSOR_API_BASE_URL`, rồi mới tới localhost. Không có biến nào (mở trần) thì rơi về localhost —
 * hỏi hụt là cùng, chứ tuyệt đối không rơi về hãng.
 */
const DOC = 'var $N=(process.env.SAND_BACKEND_URL||process.env.CURSOR_API_BASE_URL||"http://127.0.0.1:8788")+"/updates"/*grokbot2:update-feed*/';

export default {
  id: "update-feed",
  summary: "kênh cập nhật trỏ backend của mình, không phải api2.cursor.sh",

  variants: [
    {
      version: "0.29.0",
      file: "dist/electron-main/main.cjs",
      find: 'var JBn="https://api2.cursor.sh/updates"',
      expected: 1,
      replace: DOC.replace("$N", "JBn"),
      marker: "/*grokbot2:update-feed*/",
    },
    {
      version: "0.30.0",
      file: "dist/electron-main/main.cjs",
      find: 'var t4n="https://api2.cursor.sh/updates"',
      expected: 1,
      replace: DOC.replace("$N", "t4n"),
      marker: "/*grokbot2:update-feed*/",
    },
    // 0.43: `main.cjs` chỉ còn vỏ 12 KB; updater nằm ở `main-app.cjs`, cùng chuỗi, tên `IQe`.
    {
      version: "0.43.0",
      file: "dist/electron-main/main-app.cjs",
      find: 'var IQe="https://api2.cursor.sh/updates"',
      expected: 1,
      replace: DOC.replace("$N", "IQe"),
      marker: "/*grokbot2:update-feed*/",
    },
  ],
};
