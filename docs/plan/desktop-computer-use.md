# Điều khiển và dạy việc **ngoài** trình duyệt

Trạng thái: **giai đoạn 1 và 2 đã làm** (24/08/2026). Viết ra vì phần khó nhất —
spec của hãng — **trích được**, và không nên để ai phải suy lại từ đầu.

## Hiện tại có gì

| | Điều khiển | Ghi lại thao tác |
|---|---|---|
| Chrome trên box | 16 tool `browser_*` (click, gõ, kéo, cuộn, phím, chụp, CDP thô) | **có** — `teach.ts`, ghi selector |
| File trên box | `readBytes`, `memoryLoad/Save` qua box daemon | — |
| **Ngoài Chrome** | **không có gì tự động** — `request_box_help` chỉ *nhờ người dùng làm* | không |

So sánh hay bị hiểu sai: VS Code / Antigravity cũng chỉ điều khiển **trình duyệt** qua CDP,
không điều khiển desktop. Ở phần browser thì bản này ngang bằng. Chỗ hẹp hơn hãng là mọi thứ
nằm ngoài Chrome.

## Spec trích từ bản gốc

`aiserver.v1.ComputerUseParams` chứa `actions` (repeated), mỗi action là một `oneof` **11 nhánh**:

```
1  mouse_move        5  drag        9   wait
2  click             6  scroll      10  screenshot
3  mouse_down        7  type        11  cursor_position
4  mouse_up          8  key
```

Kèm theo, trong bundle:

```
computer_use_coordinate_mode     screen_width_pixels    screen_dpi
computer_use_session             screen_height_pixels   screen_density
computer_use_stream              screen_resolution      screen_hover
computer_use_supported           computer_use_model
```

`ComputerUseResult` là `oneof { success | error }`.

**Điều quan trọng nhất nằm ở chỗ KHÔNG có gì**: không có action nào kiểu "tìm nút Save". Toàn bộ
theo **toạ độ**, và model được cho biết kích thước/DPI màn hình để tự tính. Nghĩa là phần chạy lại
bắt buộc dùng **thị giác** — và đó là lý do bản gốc có `computerUseModel` như một thiết lập model
**riêng**, tách khỏi model chat.

Không trích được: bộ ghi và vòng lặp replay của hãng nằm trên máy chủ họ. Client chỉ chuyển tiếp.

## Giai đoạn 1 — điều khiển desktop (bot *làm* được việc ngoài Chrome)

Box đã chạy X11 (VNC phục vụ chính nó), nên 11 action trên map thẳng sang công cụ có sẵn:

| action | cách làm trên box |
|---|---|
| mouse_move / click / down / up / drag | `xdotool mousemove/click/mousedown/mouseup` |
| scroll | `xdotool click 4` / `5` |
| type / key | `xdotool type` / `key` |
| screenshot | `maim` hoặc `import -window root` |
| cursor_position | `xdotool getmouselocation` |
| wait | ở backend, không cần box |

Việc thật cần làm:

1. Box daemon: thêm op cho từng action (`boxCall("desktopAct", {...})`).
2. Tool cho model: `computer_*`, chỉ đăng ký khi box báo có X11 — cùng nguyên tắc như
   `browser_*` (không quảng cáo tool không chạy được).
3. Prompt: đưa `screen_width_pixels` / `screen_height_pixels` / `screen_dpi` vào, đúng như hãng.
   Model không đoán được toạ độ nếu không biết khung.
4. Vòng lặp: **chụp → model chọn toạ độ → hành động → chụp lại để xác nhận**. `pool-client` đã
   biết cách gửi ảnh cho pool (`image` ở top-level của `/v1/messages`), nên phần vision không phải
   dựng mới.

Giai đoạn này **tự nó đã có giá trị**: bot dùng được mọi app trên box, không cần dạy gì.

### Đã làm — `src/desktop.ts` + tool `computer_use`

Khác kế hoạch một chỗ, và khác có lý do: **không sửa box daemon**. Driver là một file Python nhỏ
gói trong `desktop.ts`, tự đẩy lên box theo băm nội dung (`desktop-<hash>.py`) rồi gọi qua op `run`
có sẵn. Không phải chờ deploy lại daemon, và hai phiên bản backend không giẫm lên nhau.

Không dùng `xdotool` mà dùng **XTEST qua python-xlib** — cùng cơ chế xdotool dùng, nhưng cài được
không cần root.

| chỗ | việc |
|---|---|
| `desktop.ts` | driver + `desktopAct` + `parseDesktopArg` + `screenInfo` + `isDesktopLook` |
| `runtime/tools.ts` | tool `computer_use`, chỉ đăng ký khi `desktopConfigured()`; đoạn prompt DESKTOP |
| `runtime/turn.ts` | chỉ hành động **nhìn** được duyệt sẵn |
| `desktop.test.ts` | 8 test cho phần đọc đối số |

Ba quyết định đáng nhớ:

- **Ảnh JPEG q75, không thu nhỏ.** Thu nhỏ làm nhẹ ảnh nhưng phá tỉ lệ 1:1 giữa ảnh và toạ độ —
  model đọc toạ độ trên ảnh rồi bấm trượt. PNG 602KB → JPEG 193KB mà toạ độ vẫn thật.
  Ảnh cũng không đi thẳng qua stdout: daemon cắt ở 200.000 ký tự, nên driver ghi file trong gốc
  daemon rồi TS đọc về bằng `readBytes`.
- **Chụp lại sau mỗi hành động, tự động.** Bước "nhìn lại" chính là bước model sẽ quên, và quên rồi
  thì hành động sau bấm mù.
- **Duyệt: nhìn thì tự chạy, bấm thì theo quyền thường.** Cố ý khác `browser_*` — thao tác trình
  duyệt bị giới hạn trong một trang, một cú click trên desktop thì không.

Đã chứng minh chạy thật trên box: mở một trang có ô input, chụp màn hình, đọc toạ độ ô **từ chính
tấm ảnh**, `click` → `type "xin chao 123"` → `key exclam`, rồi đọc lại `input.value` qua CDP:
`"xin chao 123!"`. Đúng vòng lặp mà model sẽ chạy.

Còn thiếu so với spec: `wait` (làm ở backend, chưa cần) và `mouse_down`/`mouse_up` tuy có driver
nhưng chưa dùng thật lần nào.

## Checklist E2E giai đoạn 1

Chạy: `pnpm backend` rồi `node scripts/e2e-desktop.mjs`. Kết quả dưới đây là lần chạy thật ngày
24/08/2026 trên box, **13/13**.

| # | Kiểm | Cách kiểm | Trạng thái |
|---|---|---|---|
| 1 | tool được chào khi box có mặt | gọi `screen_info` qua gateway | ✅ |
| 2 | prompt mang kích thước màn hình | đoạn DESKTOP có `1920x1080, 100 DPI` | ✅ |
| 3 | chụp màn hình ra ảnh thật | `readAttachmentImage` đo lại được | ✅ |
| 4 | ảnh giữ tỉ lệ 1:1 | ảnh 1920x1080 khớp `screen_info` | ✅ |
| 5 | chuột thật sự di chuyển | đi tới (731,419) rồi **đọc lại** con trỏ | ✅ |
| 6 | thiếu toạ độ bị chặn tại chỗ | `click` không x/y ⇒ từ chối | ✅ |
| 7 | action lạ bị chặn tại chỗ | `double_click` ⇒ từ chối kèm danh sách thật | ✅ |
| 8 | cú bấm rơi đúng chỗ | `document.activeElement.id` qua CDP | ✅ |
| 9 | gõ chữ tới nơi | `input.value` chứa từ ngẫu nhiên | ✅ |
| 10 | phím rời tới nơi | `exclam` ⇒ giá trị kết thúc bằng `!` | ✅ |
| 11 | **model NHÌN được ảnh nó chụp** | từ ngẫu nhiên trên màn hình, bot đọc lại đúng | ✅ *(sau khi sửa)* |
| 12 | **vòng lặp đầy đủ** | nút đỏ ở chỗ ngẫu nhiên, không cho selector — bot tự tìm rồi bấm | ✅ *(sau khi sửa)* |
| 13 | không bao giờ chạy song song | `isParallelSafe("computer_use") === false` | ✅ (unit) |
| 14 | nhìn thì tự chạy, bấm thì hỏi | `isDesktopLook` | ✅ (unit) |

### Cái E2E tìm ra — và bốn nhóm đầu không thể tìm ra

Mục 1–10 xanh hết **trong khi bot đang mù**. `continueAfterTool` dựng lượt tiếp theo hoàn toàn bằng
chữ, nên tấm ảnh `ctx.attach` chỉ tới được **người xem**, không tới model. Model đọc đúng bảy chữ
"đã chụp màn hình 1920x1080" rồi tự nói ra:

> "Ảnh chụp trả về nhưng mình không nhận được nội dung hình để đọc, nên mình không dám đọc đại."

Nghĩa là toàn bộ `computer_use` chỉ là một màn kịch câm: bấm theo toạ độ, đính một tấm ảnh, rồi
đọc lại mấy chữ mô tả. Và `browser_*` mang đúng lỗi đó từ đầu — dòng chú thích ngay chỗ chụp ảnh
còn ghi "mọi tool browser đều trả về ảnh nên model không cần hỏi", trong khi model chưa từng thấy
tấm nào.

Sửa: `ToolCtx.see(dataUrl)` — ảnh dành cho **model**, tách khỏi `attach` là ảnh dành cho **người**.
Cả hai đường nối lượt (`continueAfterTool`, `continueAfterTools`) mang nó sang lượt sau rồi xoá,
nên một tấm được nhìn đúng một lần chứ không đi theo mãi.

Bài học đáng giữ: **`ok: true` của mọi nguyên thuỷ vẫn đúng khi thứ quan trọng nhất đã hỏng.** Nếu
dừng ở nhóm 4 thì đã tuyên bố giai đoạn 1 xong, và nó xong theo nghĩa không dùng được.

### Chuyển sang giai đoạn 2 khi nào

Điều kiện đã đủ: vòng lặp *chụp → chọn toạ độ → hành động → nhìn lại* chạy được với bot thật, không
người mớm toạ độ (mục 12). Đó là điều kiện mà mục "Khuyến nghị" cuối trang này đặt ra cho giai
đoạn 2.

## Giai đoạn 2 — ghi thao tác desktop (dạy việc ngoài Chrome)

Ba đường bắt input, đánh đổi khác nhau:

| cách | được | mất |
|---|---|---|
| X11 `XRecord` / `xinput test` | rẻ, bắt mọi sự kiện | chỉ có toạ độ: "click (742,318)" |
| Proxy tầng VNC (RFB qua websockify) | bắt cả input do app gửi | vẫn chỉ toạ độ |
| **Chụp ảnh kèm mỗi hành động** | replay bằng thị giác: tìm lại vùng ảnh đó | nặng hơn, cần vision tốt |

Cách thứ ba gần như chắc là cách của hãng — không thì `computerUseModel` tồn tại để làm gì.

### Đã làm — `src/desktop-record.ts`

Đi đường thứ ba, nhưng bẻ một chỗ mà kế hoạch chưa nhìn ra: **pool chỉ mang được MỘT ảnh mỗi lượt.**
Một routine tám bước có tám mẩu ảnh, nên không có cách nào vừa đưa "ảnh cái nút cần tìm" vừa đưa
"ảnh màn hình bây giờ" cho model trong cùng một lượt. Nếu không xử lý, giai đoạn 2 sẽ chết đúng ở
chỗ nó hứa hẹn nhất.

Lời giải: **đổi pixel thành lời một lần, ngay lúc dạy xong.** Mỗi cú bấm được cắt một mẩu ảnh
320x200 quanh điểm bấm, rồi model thị giác tả lại mẩu ảnh đó thành một câu. Lúc chạy lại chỉ còn
cần một tấm ảnh màn hình thật — và câu mô tả sống sót qua những thứ toạ độ không sống nổi: cửa sổ
dịch chỗ, đổi độ phân giải, một thông báo chen ngang.

Mô tả thật, sinh ra từ một buổi dạy thật:

> 1. bấm vào "Ô nhập liệu (text input) hình chữ nhật nền trắng, viền xám mảnh, chứa chữ gợi ý màu
>    xám 'Ten khach hang'" — lúc dạy nó ở khoảng (300, 250)
> 2. gõ "Nguyen Van A"
> 3. bấm vào "Nút bấm hình chữ nhật màu xanh dương với chữ trắng in hoa 'LUU HO SO'" — lúc dạy nó
>    ở khoảng (300, 435)

| chỗ | việc |
|---|---|
| `desktop-record.ts` | bộ ghi XRecord trên box + `describeCrops` + `desktopStepsToPrompt` + `stopDesktopTeach` |
| `gateway.ts` / `cursor-acl` | cổng `desktopTeach` + ba lệnh `*DesktopTeach*` (tên của mình, không mượn tên client) |
| `runtime/tools.ts` | `desktop_teach_start` / `desktop_teach_stop` — đường dùng trong app gốc, không cần thêm UI |
| `desktop-record.test.ts` | 7 test cho câu chữ giao cho bot chạy lại |

Ba điều học được khi làm:

- **Hai bộ ghi phải loại trừ nhau.** Người dùng thao tác trong Chrome của box qua VNC thì MỘT cú
  bấm sinh ra cả sự kiện X11 lẫn sự kiện DOM. Bật cả hai là mọi bước bị ghi hai lần.
- **`A && B &` trong shell làm daemon chờ 60 giây.** Shell tách một subshell cho cả nhóm, và
  subshell đó vẫn giữ ống stdout của daemon dù B đã tự chuyển hướng. Đổi thành `A; B &` là xong —
  250ms. Đo được vì mỗi lần bấm "bắt đầu ghi" treo đúng bằng thời hạn phiên ghi.
- **`keysym_to_string(XK_Return)` trả về một ký tự dài 1**, nên bộ ghi đầu tiên nuốt phím Enter vào
  giữa chuỗi chữ: `"abc"` thay vì `"abc"` rồi `Return`.

### Checklist E2E giai đoạn 2

Trong `scripts/e2e-desktop.mjs`, nhóm 7. Kết quả 24/08/2026: **19/19 toàn bài**.

| # | Kiểm | Trạng thái |
|---|---|---|
| 15 | bật được bản ghi trên desktop | ✅ |
| 16 | thao tác thật được ghi lại (bấm, gõ, phím) | ✅ |
| 17 | lưu thành routine, có mặt trong bảng Routines | ✅ |
| 18 | **mỗi bước bấm được tả bằng lời**, không chỉ toạ độ | ✅ |
| 19 | chữ đã gõ nằm nguyên trong routine | ✅ |

Chưa kiểm: **chạy lại** một routine desktop trên màn hình đã đổi bố cục. Đó là phép thử thật của
mô tả bằng lời, và nó cần một app desktop thật chứ không phải trang web dựng cho test.

## Cảnh báo phải nói trước

**Dạy trên desktop kém hơn dạy trong browser.** Browser cho `#article_title`; desktop cho
`(742,318)` cộng một tấm ảnh. Cửa sổ dịch chỗ, font đổi, một thông báo nhảy ra — toạ độ vỡ.

Nên khi việc nằm trong trình duyệt, `teach.ts` vẫn phải là đường ưu tiên. Giai đoạn 2 chỉ dành
cho app không có trong browser.

## Khuyến nghị

Làm **giai đoạn 1**, rồi dừng lại đánh giá. Nó mở ra năng lực lớn (bot dùng được app desktop) mà
không mang theo sự mong manh của replay theo toạ độ. Giai đoạn 2 chỉ làm khi có việc thật cần dạy
một app ngoài trình duyệt — và lúc đó vòng lặp vision của giai đoạn 1 phải đã tốt trước.
