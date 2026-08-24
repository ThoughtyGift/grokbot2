# Điều khiển và dạy việc **ngoài** trình duyệt

Trạng thái: **giai đoạn 1 đã làm** (24/08/2026), giai đoạn 2 chưa. Viết ra vì phần khó nhất —
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

## Giai đoạn 2 — ghi thao tác desktop (dạy việc ngoài Chrome)

Ba đường bắt input, đánh đổi khác nhau:

| cách | được | mất |
|---|---|---|
| X11 `XRecord` / `xinput test` | rẻ, bắt mọi sự kiện | chỉ có toạ độ: "click (742,318)" |
| Proxy tầng VNC (RFB qua websockify) | bắt cả input do app gửi | vẫn chỉ toạ độ |
| **Chụp ảnh kèm mỗi hành động** | replay bằng thị giác: tìm lại vùng ảnh đó | nặng hơn, cần vision tốt |

Cách thứ ba gần như chắc là cách của hãng — không thì `computerUseModel` tồn tại để làm gì.

## Cảnh báo phải nói trước

**Dạy trên desktop kém hơn dạy trong browser.** Browser cho `#article_title`; desktop cho
`(742,318)` cộng một tấm ảnh. Cửa sổ dịch chỗ, font đổi, một thông báo nhảy ra — toạ độ vỡ.

Nên khi việc nằm trong trình duyệt, `teach.ts` vẫn phải là đường ưu tiên. Giai đoạn 2 chỉ dành
cho app không có trong browser.

## Khuyến nghị

Làm **giai đoạn 1**, rồi dừng lại đánh giá. Nó mở ra năng lực lớn (bot dùng được app desktop) mà
không mang theo sự mong manh của replay theo toạ độ. Giai đoạn 2 chỉ làm khi có việc thật cần dạy
một app ngoài trình duyệt — và lúc đó vòng lặp vision của giai đoạn 1 phải đã tốt trước.
