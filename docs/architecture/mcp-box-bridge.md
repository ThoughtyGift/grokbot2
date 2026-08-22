# Cầu MCP trên box — thiết kế, rủi ro, và quyết định niềm tin

Viết trước khi code, vì đây là ranh giới bảo mật (chạy code do người dùng cung cấp trên một VPS
**dùng chung**). Mục tiêu người dùng: "agent tự cài MCP rồi dùng luôn", như bot Shopee trong ảnh
định làm.

## 0. Sửa tiền đề: app gốc KHÔNG chạy box local

Đo từ `docs/box-architecture.md` (proxy `EnsureSandBox` từ tài khoản thật):

```
exec_daemon_url   https://<tenant>-<pod>-1337.us8.cursorvm.com
```

App gốc chạy **cloud pod trên `cursorvm.com`**, **mỗi tenant một pod riêng, ngắn hạn** (`resume_lower_s`
/`resume_upper_s` — pod tự ngủ và tái sinh). **Đó chính là toàn bộ chiến lược an toàn của nó**: agent
cài gì, build gì, kể cả code độc — cũng chỉ trong **pod dùng một lần của riêng tenant đó**. Bán kính
thiệt hại = một pod vứt đi. Không có dữ liệu tenant khác trên đó.

Box của ta: `admin.halcion.vn/grok-exec`, root `/home/box/workspace` — **một VPS DÙNG CHUNG** của
pool. Đây là khác biệt kiến trúc lớn nhất, và là gốc mọi rủi ro dưới đây.

## 1. Chặn kỹ thuật: exec một-lệnh vs stdio bền bỉ

`boxCall` (`src/box-exec.ts`) là **request/response một lần**: POST một op, nhận JSON, xong. MCP over
stdio cần **ống hai chiều sống lâu** — client gửi JSON-RPC liên tục, server đẩy notification ngược.
Hai mô hình không khớp. Nên cầu này cần một trong hai:

- **A. Kênh streaming tới box** — thêm websocket/SSE + bơm stdin vào exec daemon. Sửa cả daemon
  (`infra/vps/exec-daemon.mjs`) lẫn `mcp.ts`. Nặng.
- **B. MCP-over-HTTP trên box** — agent dựng MCP server nghe **cổng HTTP** trên box (như box gateway
  1340, VNC 6080 đã làm), `mcp.ts` nối tới bằng **transport HTTP** của MCP. Hiện `mcp.ts` chỉ biết
  `spawn` stdio local, nên phải thêm client HTTP-MCP. **Sạch hơn A**, nhưng cần box mở cổng.

Không đường nào là "spawn thêm một dòng". Ước lượng: **~2–3 ngày** cho B, gồm cả tầng transport mới.

## 2. Ba rủi ro bạn nêu — trả lời thẳng

### a. RAM/Disk của box tăng — CÓ

Mỗi MCP server là một tiến trình sống + `node_modules`/`.venv`. Agent build bot Shopee kéo Playwright
+ Cloakbrowser = **hàng trăm MB disk + một Chromium chạy nền**. Nhiều bot × nhiều MCP = box phình.
App gốc không lo vì pod dùng một lần; ta thì box **thường trực dùng chung**, nên phình là **tích luỹ
vĩnh viễn** cho tới khi có người dọn.

**Cách quản:** hạn ngạch cứng — số MCP tối đa/box, disk tối đa/thư mục cài, và **TTL**: MCP không
dùng N ngày thì gỡ. Đặt mỗi MCP trong `/home/box/mcp/<id>/` để dọn gọn.

### b. Không ảnh hưởng dữ liệu khác trên VPS — VẤN ĐỀ CỐT LÕI

Box **dùng chung** nghĩa là mọi bot của mọi người (nếu mở nhiều người) chạy trên **cùng một
`/home/box`**. Một MCP cài bởi bot A **thấy được file của bot B**, cùng `/home/box/workspace`. App gốc
không có vấn đề này vì mỗi tenant một pod. Trên VPS chung, cô lập phải **tự dựng**:

- Tối thiểu: mỗi MCP chạy dưới **user Linux riêng** (`useradd mcp-<id>`), chỉ đọc/ghi thư mục của nó,
  `chroot`/`bind-mount` cô lập khỏi `workspace`.
- Chắc hơn: mỗi MCP trong **container riêng** (docker/podman) với volume riêng, network riêng.
- Đây là chỗ "VPS chung" trả giá: app gốc được cô lập **miễn phí** nhờ pod; ta phải mua bằng công.

### c. Người dùng cài MCP chứa mã độc — WORST CASE

MCP là **code tuỳ ý**. `npx -y <gói-bất-kỳ>` = **thực thi code lạ trên box**. Trên VPS chung, một MCP
độc có thể: đọc `pool-key.txt`/token nếu chung filesystem, quét mạng nội bộ VPS, đào tiền, hoặc dùng
box làm bàn đạp. Đây **không phải rủi ro lý thuyết** — nó là mô hình thực thi.

**Mức xử lý, tăng dần:**

1. **Allowlist (khuyến nghị mặc định):** agent **KHÔNG** được tự `npm install` MCP tuỳ ý. Chỉ MCP
   trong danh sách bạn duyệt (khai ở config) mới cài được. Agent chọn *từ* danh sách, không *thêm vào*.
2. **Cô lập tiến trình** (mục b) để MCP độc không chạm dữ liệu khác.
3. **Không có secret trên box:** `pool-key.txt`, token — tuyệt đối không nằm trong `/home/box`.
4. **Egress firewall:** chặn box gọi ra ngoài trừ đích cho phép, chống đánh cắp dữ liệu + đào coin.

## 3. Vì sao app gốc chọn pod cloud per-tenant

Chính là để né cả ba rủi ro trên **bằng kiến trúc thay vì bằng luật**: pod dùng một lần → phình thì
vứt; per-tenant → không có dữ liệu người khác để lộ; code độc → nổ trong hộp cát của chính nó rồi biến
mất. Ta chọn self-host trên VPS chung để tiết kiệm, nên phải **trả lại phần an toàn đó bằng tay**.

## 4. Khuyến nghị

**KHÔNG** làm "agent tự cài MCP tuỳ ý trên VPS chung" như bước đầu — đó là mở cửa thực thi code lạ
trên hạ tầng chung. Thay vào đó, theo thứ tự an toàn:

1. **Cầu B + allowlist:** `mcp.ts` nối tới MCP-over-HTTP trên box, nhưng **chỉ** các MCP bạn khai
   trong config (không phải agent tự thêm). Agent *dùng* được MCP box-hosted, không *cài* tuỳ ý.
2. **Cô lập:** mỗi MCP một user/container, thư mục riêng, không thấy secret.
3. **Hạn ngạch + TTL:** chặn phình.
4. **Chỉ khi có cô lập thật** mới cân nhắc cho agent tự cài — và ngay cả lúc đó, nên để **một pod dùng
   một lần cho mỗi bot** giống app gốc, thay vì VPS chung.

Quyết định niềm tin là **của bạn**: cho phép tới đâu trên box chung. Tôi dựng phần được duyệt, không
tự mở đường thực thi code lạ trên hạ tầng chung mà chưa có cô lập.
