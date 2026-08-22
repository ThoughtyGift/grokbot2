# Đặc tả giao diện app gốc — để dựng lại, không để copy

Đo trực tiếp từ app đang chạy qua CDP (`localhost:9222`), viewport 1920×1040.
Máy đọc được: [`ui-design-spec.json`](ui-design-spec.json) · [`ui-components.json`](ui-components.json).

> **Ranh giới.** File này chứa **số đo và tên nhãn**, không chứa code, stylesheet hay asset của hãng.
> Bundle renderer là proprietary: không copy vào product ([legal.md](../legal.md), ROADMAP R4), và
> `.gitignore` chặn `*.asar` / `resources/app/`. Dựng lại UI của mình từ đặc tả này là việc roadmap
> cho phép tường minh (§F7: *"Có thể **tham khảo** UX từ extracted FE"*).

## Khung ba cột

| Vùng | x | rộng | Ghi chú |
|---|---|---|---|
| Sidebar | 0 | **399** | roster + nhóm + hành động dưới đáy |
| Chat | 400 | 1163 | header · transcript · composer |
| Panel phải | 1563 | ~357 | màn hình bot + Routines |

Nền shell: **`rgb(7,7,7)`**. Chữ chính: **`rgb(252,252,252)`**.

## Bảng màu (theo tần suất dùng thật)

| Vai trò | Giá trị | Lần dùng |
|---|---|---|
| Chữ chính | `rgb(252,252,252)` | 469 |
| Chữ phụ | `rgba(252,252,252,0.6)` | 167 |
| Chữ mờ | `rgba(252,252,252,0.4)` | 26 |
| Nền bubble agent | `rgb(38,38,38)` | 9 |
| Nền row đang chọn | `rgba(119,119,119,0.32)` | — |
| Nền hover row | `rgba(119,119,119,0.173)` | 6 |
| Nền shell | `rgb(7,7,7)` | 5 |
| **Accent** (unread, nút chính) | `rgb(16,132,254)` | 5 |
| Nền phụ | `rgb(47,47,47)` · `rgb(17,17,17)` · `rgb(90,90,90)` | |

## Chữ

Họ font: `-apple-system` (hệ thống), mono: `ui-monospace`.
Cỡ theo tần suất: **16px** (354) · **14px** (129) · **12px** (70) · 13px (69) · 20px (1).

| Chỗ dùng | Cỡ / nặng |
|---|---|
| Tên bot trong row | 14px / 500 |
| Preview + timestamp | 12px / 400, màu `0.6` |
| Nhãn nhóm ("Phòng marketing") | 12px / 400, màu `0.6`, **không** uppercase |
| Nội dung bubble | 14px / line-height 20px |
| Tiêu đề bot ở header | 16px |

## Bán kính

`50%` avatar · `9999px` pill (composer) · `18px 18px 18px 6px` bubble agent · `10px` row sidebar · `12px` · `8px` · `6px`.

Bubble agent có **đuôi ở góc dưới-trái** (`6px`); bubble user mirror sang dưới-phải.

## Row sidebar — 375×54, x=12

```
┌─────────────────────────────────────────────┐
│ ◯  Tên bot                      10:34 AM  ● │  radius 10px, pad 8px, gap 8px
│ 40 Preview tin cuối, cắt một dòng…          │
└─────────────────────────────────────────────┘
```

- Avatar tròn 40px, bên trái
- Tên 14px/500 · timestamp 12px phải · **dot unread** `rgb(16,132,254)` ngoài cùng phải
- Preview 12px màu `0.6`, cắt một dòng
- Nhóm có nhãn phía trên ("Phòng marketing", "BOT HTML")

## Bubble

| | Agent | User |
|---|---|---|
| Nền | `rgb(38,38,38)` | `rgba(119,119,119,0.32)` |
| Radius | `18px 18px 18px 6px` | `18px 18px 6px 18px` |
| Padding | `8px 12px` | như agent |
| Rộng tối đa | ~640 (55% cột chat) | như agent |
| Căn | trái, có avatar nhỏ ngoài lề | phải |

Tên tác giả in **phía trên** bubble, 12px màu `0.6`.

## Composer

Pill `9999px` chiếm hết chiều rộng cột chat, đáy 991px. Bên trái nút `+`, bên phải nút mic.
Placeholder: `Message <tên bot>`.

## Panel phải

Hai phần xếp dọc: khung "màn hình của bot" (VNC/ảnh) + khối **Routines** với nút `Create Routine`
và câu giải thích *"Routines are recurring tasks this Bot runs on a schedule."*

## Phần thuộc hãng — phải thay, không dùng lại

| Thứ | Vì sao | Thay bằng |
|---|---|---|
| Font icon `cursor-icons` | asset của hãng | SVG tự vẽ / ký tự unicode |
| Icon SVG trong bundle | asset của hãng | bộ icon tự làm |
| Nhãn "Plugins", "Grok Local", "Enter your name" | thương hiệu của họ | nhãn của grokbot2 |
| Ảnh avatar bot | asset của hãng | **`bloub`** — bản dựng lại con bot x.ai bằng SVG, giấy phép MIT, tác giả tự đo từ video. Hình/biểu cảm/màu suy từ id. Xem `apps/grokbot-web/src/vendor/bloub/PROVENANCE.md` |
| Chuỗi UI tiếng Anh (1.233 message) | tham khảo được, không copy nguyên khối | dịch/viết lại theo giọng của mình |

> **Ranh giới thật nằm ở "của ai", không phải ở "trông giống".** Hàng avatar ở trên đóng được là
> vì tìm được một tác phẩm độc lập có giấy phép cho phép dùng — không phải vì nới luật. Cùng cách
> đó áp cho phần còn lại: font icon và bộ SVG của hãng vẫn phải tự vẽ hoặc tìm nguồn có giấy phép,
> chép từ bundle thì không, dù kết quả nhìn giống hệt.

## Đo khoảng cách với app gốc

`node services/grokbot-backend/scripts/ui-diff.mjs` — so từng thuộc tính đo được giữa app (CDP
:9222) và FE (:5173) ở nhiều khổ cửa sổ. Nó neo vào cấu trúc DOM của họ, không vào ngưỡng pixel,
nên chạy được ở mọi kích thước cửa sổ. Không phải một gate.

## Còn thiếu ở FE 5173 (đo bằng coverage)

| Nhóm | App gốc gọi | FE có |
|---|---|---|
| Chat + transcript | 5.380 | **5/5** ✅ |
| Roster | 713 | **4/4** ✅ |
| Cài đặt | 245 | 2/3 |
| Máy tính / box | 307 | 1/2 — panel báo thiếu VNC dù `.env` có `GROKBOT2_VNC_URL` |
| Routine / workflow | 350 | **0/2** |
| Khay việc nền (subagent/task/tray) | 636 | **0/4** |
