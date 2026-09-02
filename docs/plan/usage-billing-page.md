# Trang Usage & Billing — luồng app gốc đã trích, và đường ánh xạ sang billing của ta

> Trích 03/09/2026 từ bundle 0.30 (renderer + electron-main), đối chiếu ảnh chụp trang thật của app
> gốc. Mục đích: bật đúng trang này trên app local với SỐ THẬT từ billing bên mình (enforce đã chạy
> từ 02/09), không bịa field nào.

## 1 · Luồng của app gốc (đo, không đoán)

```
FE  Settings → mục "usage" (nhãn 6BjldL "Usage & Billing")
 │   chỉ HIỆN khi cờ Statsig `sand_usage_page` bật   ← yrn(): ZL.filter(...)
 │
 │  desktop IPC:  getCursorWeeklyUsage → getWeeklyUsage()
 │                getCursorUsageSummary → getUsageSummary()
 ▼
electron-main  emn({sandStatus, currentPeriodUsage, teams, nowMs}) → snapshot cho trang
 │
 │  ConnectRPC aiserver.v1 (DashboardService):
 │    GetSandUsageStatus   → GetSandUsageStatusResponse     ← nguồn CHÍNH của trang
 │    GetSandAccessStatus  → {state, block_reason, …}       ← cổng khoá/mở app (ta ĐÃ làm)
 │    GetCurrentPeriodUsage → thanh usage trong app          ← ta ĐÃ làm (billing.currentPeriodUsage)
 ▼
api2.cursor.sh
```

`GetSandUsageStatusResponse` — field đã trích từ proto trong main.cjs:

| no | field | nuôi ô nào trên trang |
|---|---|---|
| 3 | `usage_percent` | thanh **"SuperGrok 2%"** |
| 7 | `has_available_usage` | câu phụ khi hết hạn mức |
| 8 | `has_non_zero_included_limit` | có thanh included hay không |
| 10 | `sand_trial_expires_at` | nhánh trial |
| 13 | `on_demand_settings` | khối **On-demand** (`{usedCents, limitCents?, resetTimestampMs}` + `spendLimit {mode: none|fixed|unlimited, limitDollars}`) |
| 15 | `grok_plan_label` | tên plan trên tiêu đề thanh |
| (1/2) | `next_reset_timestamp_utc` | **"Resets in 3 days"** |

Nút **"Open Cursor Dashboard"** KHÔNG phải RPC — là link tĩnh `https://cursor.com/dashboard/spending`.
Sửa spend limit đi qua mutation họ đặt tên `requestLimitIncrease`, mode hợp lệ
`["none","fixed","unlimited"]`, `limitDollars` nguyên dương < 2^31.

**Tính chất quyết định cho ta:** FE **tự ẩn** từng khối khi field vắng mặt — `onDemand == null` thì
cả khối On-Demand biến mất, `usage_percent == null` thì không có thanh, enterprise thì ẩn hết. Nghĩa
là một backend trả THIẾU field vẫn ra một trang đúng, chỉ gọn hơn.

## 2 · Ánh xạ sang billing của ta (bảng `users`/`usage`/`plans`, enforce đã chạy)

| ô trên trang | app gốc lấy từ | TA lấy từ |
|---|---|---|
| thanh % | `usage_percent` | `monthlyTokens(authId) / plans.monthly_token_cap × 100` — free có trần 100k; **pro không trần → trả null → FE tự ẩn thanh** (đúng ngữ nghĩa) |
| "Resets in N days" | `next_reset_timestamp_utc` | `cycleEndMs` của `currentPeriodUsage` (cửa sổ trượt 30 ngày) |
| nhãn plan | `grok_plan_label` | `users.plan` ("free"/"pro") |
| biểu đồ chi tiêu ngày | daily spend (cents) | bảng `usage` ĐÃ theo ngày (`auth_id, day, tokens_in, tokens_out`) — đơn vị là token, không phải cents |
| khối On-Demand + spend limit | `on_demand_settings` | **không có khái niệm này** (ta đếm token, không mét tiền theo lượt) → trả vắng mặt, FE tự ẩn |
| nút mở dashboard | link cursor.com | trỏ `GROKBOT2_CHECKOUT_URL` / trang quản trị của mình khi có |

## 3 · ĐÃ LÀM 03/09 — cả ba bước, mỗi bước một phép đo

1. ✅ Cờ `sand_usage_page` bật trong `feature-gates.ts` — đo: `BootstrapStatsig` trả cổng ấy.
2. ✅ Builder `GetSandUsageStatus` (nâng từ stub 4-bool): ba nhánh — billing tắt giữ NGUYÊN byte stub
   lịch sử (khoá bằng test `2000380140015800`); pro không trần → vắng field 3 + `15="pro"`; free →
   Timestamp ×2 + double % + nhãn. `plan` chở vào `RpcCtx` từ `index.ts`. Test byte 4/4
   (`bootstrap-usage.test.ts`), kể cả ca vượt trần (%=250, `has_available_usage=false`).
   Dây đo sống: `20003801400058007a0370726f` — đúng từng byte thiết kế.
3. ✅ Đo bằng chính trang: app local → account menu → Settings → **Usage & Billing hiện ra** và vẽ
   `pro · "Separate from existing Grok usage."` — không thanh % (đúng: không trần), không khối
   On-Demand (đúng: không phát field cents). Khác ảnh app gốc đúng ở chỗ PHẢI khác (bên gốc plan có
   trần tuần nên có thanh 2%).

Một vết thẩm mỹ ghi lại, chưa sửa: dòng *"No included usage available on your plan right now"* hơi
lệch nghĩa với plan KHÔNG TRẦN (nghe như "hết hạn mức"). Nó đến từ nhánh disclaimer khi
`has_non_zero_included_limit=false`; muốn đổi phải đọc thêm nhánh `srn()`/`MD()` — làm khi có nhu
cầu thật, đừng đoán field để tắt một câu chữ.

## (kế hoạch gốc, giữ để đối chiếu)

1. **Bật cờ `sand_usage_page`** trong `feature-gates.ts` — không có nó thì mục không hiện, khỏi bàn tiếp.
2. **Dựng builder `GetSandUsageStatus`** trong `bootstrap.ts` (hiện CHƯA có — app sẽ nhận nhánh
   mặc định): trả `usage_percent` + `next_reset` + `grok_plan_label` cho free; với pro trả vắng
   `usage_percent` để FE ẩn thanh. BỎ `on_demand_settings`. Trước khi phát: xác nhận số field
   `next_reset_timestamp_utc` (1 hay 2) bằng cách đọc lại block proto — đừng đoán số.
3. **Đo bằng đúng cách của trang**: mở Settings → Usage & Billing trên app local, chụp ảnh so với
   ảnh app gốc; và một ca free vượt trần phải thấy % ≥ 100.

## 4 · Bẫy biết trước

- `GetSandAccessStatusResponse` (cổng khoá app) và `GetSandUsageStatusResponse` (trang usage) là
  **hai message khác nhau**, tên gần giống. Ta đã có cái trước; trang này cần cái sau.
- Đơn vị: app gốc hiển thị CENTS (`kj(t){t/100 → USD}`); số của ta là TOKEN. Đừng nhét token vào
  field cents — hoặc ẩn khối tiền, hoặc quy đổi có chủ ý và ghi rõ.
- Field vắng mặt là công cụ thiết kế hợp lệ của trang này (FE tự ẩn) — trả thiếu TỐT HƠN trả bịa.
