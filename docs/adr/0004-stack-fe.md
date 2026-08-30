# ADR 0004 — Stack cho `apps/grokbot-web`

- **Trạng thái:** ⚠️ **hoãn thi hành 2026-08-23** — điều kiện kích hoạt (X4) đã tới, đo lại thì
  tiền đề không đúng. Xem §Kích hoạt đã được đo lại.
- **Ngày:** 2026-08-22
- **Liên quan:** [fe/fe-xray-roadmap.md](../history/fe-xray-roadmap.archived.md) · [system-pipeline.md](../plan/system-pipeline.md) T1.1

## Bối cảnh

`apps/grokbot-web` viết bằng vanilla TypeScript + Vite. Toàn bộ giao diện dựng lại bởi một hàm
`paint()` — mỗi lần trạng thái đổi thì **cây DOM bị thay hết**.

Ngày 2026-08-20 dự án đổi hướng: `Grok Bot.exe` đã patch là UI sản xuất, `apps/grokbot-web` bị
giáng xuống đường lùi cho rủi ro **R2** (bản update của hãng bật `OnlyLoadAppFromAsar` thì hướng
patch chết). Ngày 2026-08-22 chủ máy đặt thêm một đích nữa: **clone giao diện app gốc tới từng chi
tiết đo được** (checklist X0–X6).

Hai đích đó đòi hai mức chất lượng khác nhau, và đó là điều làm quyết định này khó.

### Bằng chứng: giá của mô hình vẽ-lại-tất-cả

Bốn lỗi, **cùng một phiên làm việc**, cùng một gốc:

| Lỗi | Phải chữa bằng |
|---|---|
| Gõ vào ô Tìm bot mất focus sau một ký tự | tự khôi phục focus + vị trí con trỏ sau mỗi lần vẽ |
| Mỗi lần vẽ để lại một vòng `requestAnimationFrame` chạy trên node đã rời DOM | tự giữ danh sách animator và `stop()` tay |
| `root.addEventListener` cộng dồn mỗi lần vẽ | thêm cờ `closeMenusBound` |
| Guard animation trỏ `.msg-row` — class bị A1 xoá nên guard hở **im lặng** | đổi sang `.run-gutter`; chỉ phát hiện nhờ đọc lại code |

Không phải viết cẩu thả. Cả bốn đều là **việc mà framework làm hộ**: giữ node qua các lần vẽ, dọn
effect khi unmount, gắn listener một lần.

Và chặn đường thật nằm ở **X4** (ảo hoá transcript). Ảo hoá cần: cập nhật có khoá, giữ vị trí cuộn
khi prepend lịch sử, ghim đáy khi tin cuối phình ra lúc stream. Không có cái nào làm được trên mô
hình thay-hết-DOM.

## Quyết định

Khi tới **X4**, chuyển `apps/grokbot-web` sang **React**, kèm hai thư viện headless:

| Nhu cầu | Thư viện | Trạng thái (tra 2026-08-22) |
|---|---|---|
| Panel kéo/gập/nhớ cỡ (X2) | `react-resizable-panels` | v4.12.3 · MIT · ~32M lượt tải/tuần · có `Separator` cho bàn phím |
| Transcript ảo hoá kiểu chat (X4) | `@tanstack/react-virtual` | có **guide riêng cho chat**: `anchorTo:'end'`, `followOnAppend`, prepend giữ vị trí, ghim đáy khi stream |

Cả hai **headless** — không áp style. Điều đó quan trọng: thước duy nhất của bản clone là số đo
(`pnpm ui:diff`), nên thư viện nào mang theo style của riêng nó là tự phá thước.

Chuyển **dần**, không viết lại một lượt: React dựng vỏ (shell, panel, transcript ảo hoá), các phần
đã khớp 100% (bubble, reaction, bộ chọn ảnh, avatar `bloub`) chuyển sau, từng mảng một, mỗi mảng
chạy `ui-diff` trước/sau.

## Kích hoạt — và điều kiện KHÔNG làm

> ### Đo lại khi X4 thật sự tới (2026-08-23) — và kết luận đổi
>
> ADR này viết rằng X4 sẽ kích hoạt việc chuyển React. Khi tới X4 tôi đo trước
> (`pnpm measure:transcript`), và **tiền đề của nó không đúng**:
>
> | transcript | node | một lần vẽ lại |
> |---|---|---|
> | 31 bubble | 657 | **0,84 ms** |
> | 124 bubble | 2 628 | 4,52 ms |
> | 496 bubble | 10 512 | 21,8 ms |
> | 1 984 bubble | 42 048 | 52,0 ms |
>
> Ba điều đọc ra:
>
> 1. Ở cỡ đang dùng, "vẽ lại tất cả" **không** phải vấn đề hiệu năng — 0,84 ms, tức 1/20 khung hình.
>    ADR viết dựa trên giả định nó đắt; giả định đó chưa từng được đo.
> 2. Nó thành vấn đề từ khoảng **500 entry** (21,8 ms > 16,7 ms của một khung hình). Đó là ngưỡng,
>    và nó xa hơn nhiều so với các hội thoại đang có.
> 3. Lỗi thật hôm nay **không phải** hiệu năng mà là mất vị trí cuộn: `log.scrollTop =
>    log.scrollHeight` chạy vô điều kiện mỗi lần vẽ, đo được 7516 → 14103. **React không chữa cái
>    đó** — thứ chữa nó là chụp trạng thái cuộn trước khi vẽ và neo lại theo phần tử, 60 dòng
>    vanilla. Và thứ chữa mục (2) là chỉ dựng phần nhìn thấy, cũng không cần React.
>
> Nên **hoãn**, không huỷ. X4 đã xong trên mô hình hiện tại: `pnpm measure:transcript-scroll` 4/4,
> vị trí cuộn giữ đúng `7516 → 7516`, DOM chặn ở cửa sổ 150 entry kèm nút xem thêm.
>
> Điều kiện kích hoạt **mới**, thay cho "khi tới X4": khi một trong ba xảy ra
> — (a) một hội thoại thật vượt ~500 entry *và* `measure:transcript` báo > 16 ms;
> (b) cần chỉnh sửa tại chỗ trong transcript (edit/reply lồng nhau) khiến cập nhật có khoá là bắt
> buộc; (c) `main.ts` vượt 1500 dòng hoặc `paint()` vượt 500 dòng. Hiện: **1214 dòng / `paint()` 400
> dòng** — đã sát, nên đây là điều kiện gần nhất sẽ bật.

**Làm** khi một trong ba điều kiện trên xảy ra, không phải "khi bắt đầu X4". X1–X4 đều làm được trên
mô hình hiện tại; chuyển stack trước đó là trả giá trước khi cần.

**Không làm** nếu đích của `apps/grokbot-web` quay về "chỗ debug backend + đường lùi R2". Lúc đó
vanilla là đủ và rẻ hơn, và bốn lỗi trên là giá chấp nhận được cho một bề mặt phụ. ADR này **không**
nói React tốt hơn; nó nói React trả được đúng bốn khoản nợ mà đích *clone từng chi tiết* tạo ra.

## Hệ quả

**Được:** X4 khả thi; bốn lớp chữa cháy ở trên biến mất; `main.ts` (~800 dòng, vượt ngưỡng 800 của
[system-pipeline.md](../plan/system-pipeline.md) T5.1) tách được thành component.

**Mất:** bundle FE tăng — hiện **66 KB thô / 23 KB gzip** (JS + CSS, đo bằng `pnpm self-xray`; log của Vite in riêng từng loại nên số ở đó nhỏ hơn), React + hai thư viện thêm khoảng 45–55 KB
gzip. Vẫn dưới ngân sách app (300 KB) nhưng phải đặt ngưỡng ở T4.3 để biết lúc nào phình.
Thêm phụ thuộc bên thứ ba vào một bề mặt trước đây **không có phụ thuộc runtime nào**.
Và có một quãng hai mô hình cùng tồn tại — quãng đó phải ngắn, đó là lý do chuyển theo mảng.

**Không đổi:** backend. Domain đã tách module (`directory`, `conversation`, `runtime`, `computer`,
`ops`), SQLite là hot path, `/v1` là hợp đồng riêng. Việc thiếu chỉ là route mỏng.

## Đã cân nhắc gì khác

| Phương án | Vì sao không |
|---|---|
| **Giữ vanilla, tự viết lớp keyed-update** | tức là tự viết framework. Bốn lỗi trên là bốn thứ đầu tiên phải tự làm, và còn nữa |
| **Svelte 5 / SolidJS** | mô hình tinh gọn hơn thật, nhưng hai thư viện quyết định (`react-resizable-panels`, `@tanstack/react-virtual` bản React) mạnh nhất ở React. TanStack Virtual có bản Svelte/Solid; `react-resizable-panels` thì không |
| **Web Components** | không giải được ảo hoá và panel kéo; vẫn phải tự viết hai thứ đó |
| **Chép component của app gốc** | vi phạm [legal.md](../legal.md) — bundle của hãng là proprietary. Đường duy nhất là đo rồi tự viết |

## Nghiệm thu

Chuyển đúng khi: `pnpm ui:diff` **không tụt** so với con số trước khi chuyển (hiện 40/40 ở
1920×1040), `pnpm test:avatar-ui` và `pnpm test:reaction` vẫn xanh, và bundle nằm trong ngưỡng T4.3.
