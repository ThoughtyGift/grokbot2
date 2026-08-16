# Continuation prompt

Paste one of these into a fresh session opened on `C:\Users\admin\Desktop\grokbot2`.

---

## A. Continue the VNC work (the open thread)

```
Đọc docs/HANDOFF.md trong repo này trước, rồi tiếp tục phần còn dang dở: VNC workspace.

Bối cảnh ngắn: app Grok Bot gốc (đã ký, không sửa được) chạy trên backend tự host của repo này.
Chat/roster/tool-loop đã chạy thật. Box VNC đã dựng trên VPS và phục vụ được
(x11vnc bắt tay RFB 003.008, noVNC HTTPS 200 từ cả máy Windows), EnsureSandBox đã trả
vnc_url + fork_vnc_base_url + network_token. NHƯNG app vẫn báo "Can't reach … screen"
và chưa từng mở webview (không có VNC target nào trong CDP).

Đã loại trừ: URL không tới được (tới được), thiếu fork URL (đã thêm), long-poll
/gw/local-exec/requests và /gw/webauthn/requests trả ngay (đã park 25s).

Mục tiêu: tìm điều kiện khiến app KHÔNG mở viewer, rồi sửa backend/box cho đúng.

Đầu mối theo thứ tự (chi tiết ở cuối docs/HANDOFF.md):
1. Cổng chặn nằm ở MAIN PROCESS, không phải gateway — app không hề hỏi gateway về màn hình
   (đã xác nhận qua log args). Trace n9n(gatewayUrl, gatewayToken, networkToken,
   {primaryUrl, forkBaseUrl}) trong electron-main/main.cjs.
2. Đọc hết preload-vnc.cjs (18KB, đọc được) — đó là contract của chính viewer.
3. Dựng exec daemon (cổng 1337 trên box thật). Có thể app coi box "unreachable" cho tới khi
   kênh exec bắt tay xong.
4. Đối chiếu với app gốc đang chạy song song (scripts/box-probe.mjs đã giải mã descriptor thật).

Cách làm đã hiệu quả ở phiên trước: bật GROKBOT2_LOG=1 để log args trên dây, lái app thật
bằng CDP (app chấp nhận --remote-debugging-port), và verify bằng quan sát chứ không đoán.

Lưu ý môi trường (đọc kỹ, từng cái đã tốn hàng giờ):
- Bỏ ELECTRON_RUN_AS_NODE trước khi mở app, không thì exe chạy như Node và thoát ngay.
- Đặt CURSOR_WEBSITE_URL=https://cursor.com, không thì login đi vào https://localhost:4443.
- Kill theo CHỦ SỞ HỮU CỔNG 8788, không phải "tiến trình node" — tsx để lại tiến trình con
  và bạn sẽ test nhầm code cũ.
- Bundle client đã giải nén KHÔNG nằm trong repo; giải nén lại từ resources/app.asar khi cần
  (scratchpad/extract-asar.js).
```

---

## B. Turn the remaining stubs into real features

```
Đọc docs/HANDOFF.md và docs/audit.md, rồi biến các stub thành tính năng thật.

Hiện 78/87 method đã map, nhưng nhiều cái chỉ trả đúng shape rỗng: workflows, automations,
channels, skills publishing, subagents, async tasks, trays, groups, media search, MCP/plugins.

Chọn nhóm rẻ trước (trays có nội dung thật, groups, media search), làm từng cái rồi verify
bằng cách lái app thật qua CDP, không chỉ test HTTP.

CẢNH BÁO quan trọng: e2e-coverage.mjs chỉ biết method "đã map hay chưa" — nó KHÔNG phát hiện
handler đọc sai tên field. Ở phiên trước có 5 bug loại này, mỗi cái giết âm thầm một tính năng.
Trước khi implement mỗi method, hãy trích call-site thật trong bundle để lấy đúng arg shape,
hoặc bật GROKBOT2_LOG=1 rồi bấm trong app để xem args thật trên dây.
```

---

## C. Just run it

```
Mở backend + app Grok Bot bản build:
  cd C:\Users\admin\Desktop\grokbot2 && pnpm backend
  infra\scripts\run.ps1

Nếu app không hiện cửa sổ: bỏ biến ELECTRON_RUN_AS_NODE rồi mở lại.
Chat cần key hal_ trong services/grokbot-backend/pool-key.txt.
```
