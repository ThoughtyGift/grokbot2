# Kịch bản E2E trước khi deploy — chạy trọn bộ trên client 0.43 local

> Lệnh chủ dự án 06/09: *"Trước khi deploy VPS test lại E2E toàn bộ các luồng trên app local version mới đang mở,
> chuẩn bị sẵn kịch bản test lại."* Tài liệu này là kịch bản ấy — thứ tự, điều kiện, lệnh, cái gì là đỏ THẬT, dọn
> thế nào. Kết quả từng lượt ghi vào [bảng theo dõi §1/§6](../state/bang-theo-doi.md), không ghi ở đây.

## 0 · Điều kiện trước khi chạy

| kiểm | lệnh | phải thấy |
|---|---|---|
| backend dev sống, rảnh | `curl -s http://127.0.0.1:8788/gw/health` | `"ok":true,"isBusy":false` — `isBusy:true` là người dùng đang chat: **không chạy bài nào gửi lượt model** |
| client 0.43 local đang mở | `curl -s http://127.0.0.1:9225/json/version` | JSON có `Browser` — đây là bản `Grok Bot (local 043)` (`start-app-043.cmd`), KHÔNG phải app hãng |
| Chrome box của ta (cho teach) | `curl -s http://127.0.0.1:9224/json/version` | JSON — thiếu thì `e2e-teach` đi đường CDP cũ, vẫn đo được nhưng không phải đường video |
| box tới được | `/admin?token=…` thẻ RAM/đĩa/tài khoản vẽ được | thẻ đỏ *không tới được box* ⇒ đọc bảng theo dõi §5 mục 18 (tên miền) trước khi nghi code |
| không sửa `src` trong lúc chạy | — | `tsx watch` nạp lại backend là cắt lượt đang đo (§7 bảng theo dõi) |
| `pnpm typecheck` KHÔNG chạy song song | — | nó dựng lại `packages/*` ⇒ backend restart giữa bài (§7) |

Mọi bài dưới đây đều **tự dọn** bot/mẫu/listing nó tạo. Bài nào để lại gì thì ghi ở cột "để lại".

## 1 · Bộ bài, theo thứ tự chạy

Thứ tự: rẻ trước (0 lượt model), đắt sau; bài bấm thật trên client (CDP) cuối cùng vì chúng gửi lượt vào bot người dùng đang mở.

**Bài 7 và 8 đo trên BOT ĐANG MỞ trong client.** Bot việc của người dùng (New Bot) đã có mẫu lên Marketplace ⇒ mốc 1 của bài 7 đỏ là đúng. Tạo một bot thử qua gateway (`createAgent{name:"e2e-bam-that (xoá sau)"}`), mở nó bằng `node services/grokbot-backend/scripts/chon-bot-cdp.mjs <agentId>`, chạy bài 7–8, rồi `chon-bot-cdp.mjs agent-984` để trả lại New Bot và `deleteAgents{ids:[…]}` (skill của bot thử xoá theo). Lượt 06/09 ~09:00 là cách này.

| # | bài | lệnh (từ gốc repo) | đo gì | lượt model | để lại |
|---|---|---|---|---|---|
| 1 | schema 0.43 | `node services/grokbot-backend/scripts/kiem-reply-0-43.mjs` | 29 lệnh đọc qua validator của coordinator 0.43 — **đỏ ở đây là banner "mất kết nối" trên client dù HTTP 200** | 0 | — |
| 2 | mẫu bot | `node services/grokbot-backend/scripts/e2e-mau-bot.mjs` | share → publish → import → `getPublicBotTemplate`, 20 mốc | 0 | — |
| 3 | marketplace | `node services/grokbot-backend/scripts/e2e-marketplace.mjs` | listing · RPC proto phân trang · blob recipe · import, 26 mốc | 0 | — (kho listing về rỗng ⇒ tab Bots hiện *No Bots available* — bình thường) |
| 4 | hai tài khoản | `node services/grokbot-backend/scripts/e2e-hai-tai-khoan.mjs` | B thấy listing của A, import ra bot của mình, không đọc/xoá được của A, 20 mốc | 0 (lời chào chạy nền) | người `e2e-b@vi-du.vn` trong kho dev |
| 5 | routine → bot nói | `node services/grokbot-backend/scripts/e2e-routine-nhac.mjs` | 5 nhịp (tạo · tắt · bật+sửa · **thêm lịch thứ hai** · xoá) → 5 hàng sự kiện + 5 câu, 0 tin người dùng | **5** | — |
| 6 | trang chia sẻ | `node services/grokbot-backend/scripts/e2e-trang-chia-se.mjs` | bot stage mẫu → publish → `/bot/<id>` (title · og · deep link · CSP · 301) → dọn, 17 mốc | 1 | — |
| 7 | share-as-template trên client | `node services/grokbot-backend/scripts/e2e-chia-se-mau.mjs` | bấm THẬT menu header: share → Publish → Update → Publish 2 → View Details → Delete, 7 mốc | 2 (vào bot đang mở) | — nếu xanh; đỏ giữa chừng ⇒ dọn bằng menu **Delete Template của client**, không qua gateway (§7) |
| 8 | teach a task | `CDP_APP=http://127.0.0.1:9225 CDP_BOX=http://127.0.0.1:9224 node services/grokbot-backend/scripts/e2e-teach.mjs` | `+` → Teach → Start → demo → Stop → tin bàn giao (≤45 s) → skill + link `sand-workflow:<id>` (≤5 phút), 15 mốc | 1 (dài) | skill thử — xoá qua `deleteAgentWorkflow{workflowId}` |
| 9 | bản ghi sống | `node services/grokbot-backend/scripts/do-ban-ghi-song.mjs` | bot thử, một câu 25 dòng: đếm lượt `getAgentTranscriptTail` trong lúc gõ (mốc 06/09: **5**, trước sửa 38), DOM mọc chữ, replica đĩa có `epochHint` | 1 | — |

Tổng ~10 lượt model, ~15–20 phút nếu không có gì đỏ.

## 2 · Đọc kết quả — cái gì là đỏ thật

- **Bài 1 đỏ** ⇒ sửa reply trước mọi thứ khác: client 0.43 coi reply sai schema là lệnh thất bại, không log.
- **Bài 5**: hàng sự kiện là ĐỒNG BỘ; hàng đỏ cùng lúc câu bot đỏ ⇒ nghi bài đo đọc sai khoá trước (§7). Câu bot 6–11 s là bình thường; >60 s là bot đang bận lượt khác.
- **Bài 7 mốc 4 đỏ mà `getAgentTranscriptTail` có thẻ** ⇒ bản ghi sống đứng (bảng theo dõi §5 mục 19). Từ 06/09 khung SSE có `ordered` nên không còn tái hiện sau nhiều lượt; nếu tái hiện, đọc `GET /gw/__coverage` khoá `cham` trước khi tải lại renderer.
- **Bài 7 đỏ 0/7 ngay mốc 1** ⇒ store client còn nhớ mẫu cũ: bấm Delete Template trên client, chạy lại.
- **Bài 8 RED "0 → 0 skill"** trong khi transcript có link `sand-workflow:` ⇒ bài đo hết giờ chờ, không phải sản phẩm (đọc `TEACH_WAIT_MS`).
- **Bất kỳ bài nào `ECONNREFUSED :8788`** ⇒ backend vừa restart (ai đó sửa `src` hoặc chạy typecheck) — bot thử có thể chưa xoá: `listAgents` tìm tên *"(xoá sau)"* / *e2e-* rồi `deleteAgents`.

## 3 · Sau khi xanh

1. Ghi một dòng kết quả vào [bảng theo dõi §1](../state/bang-theo-doi.md) (`E2E 0.43 …`) với giờ chạy.
2. Commit + push (chỉ file của mình).
3. Deploy VPS theo [trien-khai.md](trien-khai.md); trên VPS chạy lại **bài 1** với `GW_TOKEN` và **bài 5, 6** (`GW=http://127.0.0.1:8788/gw/api GW_TOKEN_FILE=/opt/grokbot2/shared/data/gateway-token.txt`), vì đó là ba bài không cần client.
