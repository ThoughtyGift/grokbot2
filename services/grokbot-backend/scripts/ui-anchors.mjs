/**
 * Bảng anchor dùng CHUNG cho `ui-diff.mjs` (ra con số) và `ui-shots.mjs` (ra hình).
 *
 * Để riêng một file vì hai script kia đều **chạy việc ở top-level**: `import` một script như vậy
 * là chạy lại cả bài đo của nó. Lần đầu đúng như thế — `ui-shots` import `ui-diff` và in ra nguyên
 * một lượt ui-diff trước khi làm việc của mình.
 *
 * Thêm vùng vào đây là CẢ HAI thước đo đều thấy. Đó là điểm của việc dùng chung: không có vùng nào
 * có hình mà không có số, hoặc ngược lại.
 */
/**
 * Bảng anchor. Mỗi dòng: tên vùng, cách tìm bên app, cách tìm bên mình, và những thuộc tính đáng so.
 *
 * `props` chọn có chủ ý: `x`/`w` cho khối bố cục, `bg`/`radius`/`pad`/`font` cho thứ nhìn thấy.
 * KHÔNG so chiều cao khối cuộn — nó phụ thuộc số tin nhắn, không phải thiết kế, so nó chỉ tạo nhiễu.
 */
export const ANCHORS = [
  /*
   * Nền so trên `.sand-shell`, KHÔNG so trên `body`.
   *
   * `body` của app là cửa sổ Electron trong suốt (`rgba(0,0,0,0.5)`), nên so nó với `body` của một
   * trang web luôn ra "lệch" trong khi hai bên vẽ ra cùng một màu. Phần tử đục ngoài cùng thật sự
   * là `div.sand-shell` = `rgb(7, 7, 7)` — đúng bằng nền của mình.
   */
  { name: "shell",        app: ".sand-shell",                 web: ".shell",         props: ["bg", "color"] },
  { name: "vạch thời gian", app: ".sand-kit-timestamp",       web: ".day-sep span",  props: ["h", "font"] },
  { name: "sidebar",      app: ".sand-agents-sidebar",        web: ".sidebar",       props: ["x", "w"] },
  /*
   * So RÒNG hàng với hàng, không so container.
   * `.sand-agents-list__rows` (236) là vùng đã trừ lề; `.roster` của mình (260) là vùng chưa trừ.
   * So hai cái đó là so quả táo với quả cam — báo lệch 24px trong khi hàng hai bên bằng nhau.
   */
  { name: "row bot",      app: ".sand-agent-item",            web: ".roster .bot",   props: ["w", "h", "radius"] },
  /*
   * Vùng dựng ở X1. Thêm anchor NGAY khi dựng, không để sau: bốn mục X1 làm xong mà bảng anchor
   * không có dòng nào cho chúng thì con số "khớp bao nhiêu %" chỉ nói về phần đã dựng từ trước —
   * đúng cái bẫy "đo sai thứ" mà dự án này đã sập bốn lần.
   *
   * Vài neo bên app chỉ tồn tại khi sidebar đang MỞ (đầu nhóm, hàng đáy). Chủ máy hay để nó ở rail,
   * nên các dòng này sẽ hiện "app KHÔNG có vùng này" lúc đó — đó là trạng thái, không phải lỗi.
   */
  /*
   * Icon bot — thêm 2026-08-23 sau khi chủ máy chỉ ra ba lần rằng nó bé hơn app gốc mà bảng anchor
   * không có dòng nào cho nó. Đúng cái bẫy: thứ không đo thì không ai biết là đã lệch.
   */
  { name: "avatar hàng bot", app: ".sand-agent-item .sand-agent-avatar", web: ".roster .bot .avatar", props: ["w", "h"] },
  { name: "avatar toolbar", app: ".sand-chat-header__avatar", web: ".chat-head .avatar", props: ["w", "h"] },
  { name: "đầu sidebar",  app: ".sand-agents-sidebar__header", web: ".side-head",     props: ["h"] },
  { name: "nút New",      app: '[aria-label="New"]',           web: ".side-head .new-icon", props: ["w", "h"] },
  { name: "ô Search",     app: ".sand-agents-sidebar__search", web: ".search-btn, .search", props: ["h", "radius"] },
  { name: "đầu nhóm",     app: ".sand-agents-section__header", web: ".roster .group", props: ["h"] },
  { name: "hàng đáy",     app: ".sand-agents-sidebar__plugins", web: ".side-foot .foot-row", props: ["h", "radius"] },
  { name: "nút tài khoản", app: '[aria-label="Open account menu"]', web: ".foot-row.account", props: ["h"] },
  { name: "nút danh tính", app: '[aria-label="View Bot settings"]', web: ".identity",     props: ["h", "radius"] },
  { name: "cột chat",     app: ".sand-chat",                  web: ".chat",          props: ["x", "w"] },
  { name: "transcript",   app: '[role="log"]',                web: ".transcript",    props: ["w"] },
  /*
   * Bỏ `w` khỏi bubble: bề rộng phụ thuộc ĐỘ DÀI TIN NHẮN, không phải thiết kế. Giữ nó thì mỗi
   * lần hai bên mở hai hội thoại khác nhau là một dòng đỏ giả.
   *
   * Bên user, `[data-role="user"]` chỉ là lớp bọc (nền trong suốt, bo 0) — phần tử có kiểu nằm
   * bên trong. Neo vào lớp bọc thì đo ra "app không có nền bubble", sai hoàn toàn.
   */
  /* Hai vai có cấu trúc KHÁC nhau: bên bot, `.sand-message` chính là phần tử mang `data-role`
     (nên là `.`, không phải dấu cách); bên mình nó nằm sâu bên trong. */
  /* Vùng dựng ở A1 — thêm anchor ngay, nếu không con số % chỉ nói về phần đã dựng trước đó. */
  /*
   * Neo phải chỉ đúng MỘT phần tử, và đúng phần tử tương ứng ở bên kia:
   *   - `.sand-agent-avatar` có cả trong row sidebar (36px) lẫn máng lượt (22px) → phải giới hạn
   *     trong máng, nếu không nó bắt cái ở sidebar và báo lệch 36 vs 22 vô nghĩa.
   *   - `.run` đầu tiên bên mình có thể là lượt CỦA MÌNH (đảo chiều), còn bên app là lượt của bot
   *     → chốt cả hai về lượt của bot.
   *   - Chữ nằm trong `<span>` con của `.sand-group-author`; đo trên nút thì ra cỡ chữ kế thừa.
   */
  { name: "lượt nói",     app: ".sand-author-run",            web: ".run.theirs",    props: ["x", "w"] },
  { name: "máng lượt",    app: ".sand-author-run__gutter",    web: ".run.theirs .run-gutter", props: ["w"] },
  { name: "avatar lượt",  app: ".sand-author-run__gutter .sand-agent-avatar", web: ".run.theirs .run-gutter .avatar", props: ["w", "h"] },
  { name: "tên lượt",     app: ".sand-group-author > *",      web: ".run.theirs .run-author", props: ["h", "font"] },
  { name: "cột lượt",     app: ".sand-author-run__column",    web: ".run.theirs .run-col", props: ["x", "w"] },
  /*
   * Đuôi bubble phụ thuộc VỊ TRÍ trong lượt, nên phải so cùng vị trí: bubble MỞ ĐẦU lượt (lượt có
   * hiện tên) với bubble mở đầu, bubble tiếp theo với bubble tiếp theo. So bừa hai vị trí khác
   * nhau thì lúc nào cũng thấy lệch, dù luật đã đúng.
   */
  { name: "bubble đầu lượt", app: '.sand-author-run:has(.sand-group-author) .sand-message', web: ".bubble.agent.first", props: ["bg", "radius", "pad", "font"] },
  { name: "bubble tiếp",     app: '.sand-author-run:not(:has(.sand-group-author)) .sand-message', web: ".bubble.agent:not(.first)", props: ["radius"] },
  { name: "bubble tôi",      app: '[data-role="user"] .sand-message', web: ".bubble.user",  props: ["bg", "pad", "font"] },
  /*
   * Ảnh đính kèm — thêm 2026-08-23. Số 344×200 đo được ở MỘT khổ cửa sổ; anchor này để lượt sau
   * (khi app mở lại với CDP) tự trả lời câu còn bỏ ngỏ: khung đó cố định, hay co theo cột chat.
   */
  { name: "ảnh đính kèm", app: ".sand-attachment__image-button", web: ".att", props: ["w", "h", "radius"] },
  { name: "hover action", app: ".sand-message-hover-actions", web: ".msg-actions",   props: ["h"] },
  { name: "nút hover",    app: ".sand-message-hover-actions__button", web: ".msg-actions .act", props: ["w", "h", "radius"] },
  /* Vùng dựng ở A5/A6 — vào mẫu số ngay. */
  { name: "nút toolbar",  app: '[aria-label="Close details"]',  web: "[data-act=pane]",  props: ["w", "h"] },
  { name: "nút mic",      app: '[aria-label="Start voice input"]', web: ".composer .mic", props: ["w", "h"] },
  { name: "nút đính kèm", app: '[aria-label="Attach file"]',    web: ".composer .attach", props: ["w", "h"] },
  { name: "composer",     app: ".sand-chat-input-dock",       web: ".composer",      props: ["x", "w", "h"] },
  { name: "panel phải",   app: ".sand-info-pane",             web: ".computer",      props: ["x", "w"] },
  /* `__frame` (325×203) là khung ảnh; `.sand-computer-preview` (325×230) là cả khối kèm phần
     dưới. `.screen` bên mình tương ứng với `__frame`. */
  { name: "khung màn hình", app: ".sand-computer-preview__frame", web: ".screen",     props: ["w", "h"] },
];
