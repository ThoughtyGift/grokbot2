# Mỗi bot một màn hình

Trạng thái: **bước 0–2 đã làm** (25/08/2026), sau cờ `GROKBOT2_PER_BOT_DISPLAY=on` (mặc định tắt).
Bước 3–5 chưa.

> Tách theo NGƯỜI DÙNG là tầng trên của tài liệu này và nằm ở
> [per-user-on-one-box.md](per-user-on-one-box.md). Bản gốc có cả hai tầng: một box mỗi người dùng
> (`EnsureSandBoxRequest` không có trường nào — danh tính nằm trong token), và trong box đó mỗi bot
> một **cửa sổ** (`ensureWindow(boxId, windowIndex)` với `ownerToken` riêng, và số cửa sổ chính là
> số X display). Tài liệu này là tầng cửa sổ; tách người dùng phải làm ở tầng trên.

## Vì sao

Bên mình một box dùng chung cho mọi bot: một X display, một Chrome, một màn hình. `browser_*` chịu
được vì mỗi bot có tab riêng và CDP không cần tab nằm trên cùng. `computer_use` thì không — nó bấm
vào cửa sổ nào đang ở trên cùng, của bất kỳ ai.

Đã xảy ra thật: một bot đang đọc trang Shopee bị bot khác gõ chữ vào đúng tab đó. Không lỗi nào nổi
lên, vì thao tác vẫn "thành công".

Hiện đã có khoá (`claimDesktop`, xem [desktop-computer-use.md](desktop-computer-use.md)), nhưng khoá
là lời giải cho hạ tầng hiện có chứ không phải hạ tầng nên có. Bản gốc **không có trọng tài nào** vì
box của họ cấp theo từng bot (`forever-box.releaseAgent(agentId)`) — hai bot là hai máy. Khoá làm
các bot phải xếp lượt nhau; cấp riêng thì chúng chạy song song.

## Đã đo, không phải phỏng đoán

Dựng thử display `:78` ngay trên box này:

```
Xvfb :78 -screen 0 1280x800x24 &
DISPLAY=:78 fluxbox &
DISPLAY=:78 google-chrome --user-data-dir=<riêng> --remote-debugging-port=9224 &
```

| câu hỏi | trả lời đo được |
|---|---|
| dựng được display riêng? | ✅ `X78` xuất hiện cạnh `X77` |
| Chrome riêng, CDP riêng? | ✅ `127.0.0.1:9224/json/version` trả về Chrome 149, tách hẳn cổng 9223 của `:77` |
| hai màn hình có độc lập? | ✅ ảnh chụp `:78` (1280x800) **chỉ có trang của nó**; `:77` (1920x1080) không lọt vào |
| công cụ có sẵn chưa? | ✅ `Xvfb`, `Xephyr`, `x11vnc`, `fluxbox`, `xfwm4`, `google-chrome` đều đã cài |

Box còn đang chạy sẵn 8 display (`:77 :99 :294 :336 :341 :342 :381 :433`), nên chuyện nhiều display
không phải điều gì lạ với nó.

## Chi phí — và đây mới là chỗ quyết định

| | đo được |
|---|---|
| một display riêng (Xvfb + fluxbox + Chrome) | **~500 MB RAM** |
| RAM box | 22 GB, còn trống **~8 GB** |
| CPU | 19 nhân |
| đĩa | 100 GB, **đã dùng 87%**, còn 14 GB |

Tính ra, chừa lại 1 GB: **14 bot theo RAM, 37 bot theo đĩa** → **RAM chặn trước**.

Tôi đã viết ngược điều này ở bản đầu — thấy 87% đĩa thì kết luận đĩa hết trước, mà không tính. Con
số 87% nghe đáng lo hơn "còn 8 GB RAM", và đó đúng là cái bẫy. Nên `/admin` trả về **cả hai** con số
và nói rõ cái nào đang chặn, thay vì chọn hộ người đọc.

Còn một điều nữa chỉ lộ ra khi đo: **box này dùng chung với phần mềm khác.** Sáu Chrome
`/root/flow-profiles/ip-…-both-93NN` đang ăn ~6 GB và không phải của grokbot2. Chúng cũng chiếm sáu
display. Nghĩa là 8 GB "còn trống" đã là phần sau khi trừ họ, và họ có thể lớn lên bất cứ lúc nào.

Kết luận thẳng: cấp theo bot phải là **cấp khi dùng, thu khi nghỉ**, không phải cấp sẵn cho mọi bot
trong danh sách. Đúng như hãng làm — `releaseAgent(agentId)` chạy khi xoá bot, và box của một bot
không sống mãi.

## Theo dõi

`/admin` (BFF, xem `src/admin.ts` + `src/box-resources.ts`) trả lời đúng một câu: **cấp thêm được
mấy bot, và cái gì đang chặn.** Kèm từng màn hình và từng hồ sơ Chrome, vì khi con số tổng trông lạ
thì phải thấy ngay ai đang ăn. Trang chỉ đọc — sáu Chrome trên box không thuộc mình, nên một nút
"thu hồi" ở đó là nút giết tiến trình của người khác.

## Phải sửa những đâu

| chỗ | việc |
|---|---|
| mới: `src/displays.ts` | sổ đăng ký `agentId → {display, cdpPort, vncPort, profileDir}`; dựng khi dùng, thu khi nghỉ |
| `src/browser.ts` | `CDP_BASE()` đang là một hằng số cho cả máy → phải tra theo `agentId` |
| `src/desktop.ts` | driver đang dùng `DISPLAY` của tiến trình → nhận display theo từng lệnh |
| `src/desktop-record.ts` | bộ ghi cũng phải gắn vào display của bot đang dạy |
| `src/forever-box.ts` | `vncUrl` phải theo bot; pane của mỗi bot xem đúng màn hình của nó |
| `src/desktop.ts` (khoá) | `claimDesktop` trở thành **thừa** khi mỗi bot một màn hình — bỏ đi, đừng để lại một cái khoá không còn gì để khoá |

## Thứ tự nên làm

0. ✅ **Đường hầm mở sẵn dải cổng** (`box-tunnel.ps1 -Slots 4`). Bước này không có trong kế hoạch
   ban đầu, và thiếu nó thì mọi thứ sau đều vô nghĩa: backend chỉ với tới cổng nào hầm đã mở, mà
   hầm chỉ mở đúng 9223. Đo trước khi viết là thứ đã cứu công sức ở đây.
1. ✅ `displays.ts` + vòng đời. Đo trên box: cấp một slot mất **~3.1 giây**, thu xong không còn
   `X521`, không còn tiến trình, không còn thư mục hồ sơ.
2. ✅ `browser.ts` tra CDP theo bot — một hàm `CDP_BASE(agentId)`, và `connect()` gọi `ensureDisplay`
   nên không đường nào lọt. Cờ tắt thì `displayOf` trả null và chuỗi trả về y như cũ.
3. `desktop.ts` + `desktop-record.ts` nhận display. **Chưa làm** — nên lúc này bot có màn hình riêng
   vẫn chụp nhầm màn hình chung nếu dùng `computer_use`. Đây là lý do cờ còn tắt.
4. `forever-box.ts` trả `vncUrl` theo bot. Chưa làm — bot ở màn hình riêng hiện **không xem được**
   trong pane, một bước lùi về khả năng quan sát.
5. Bỏ khoá `claimDesktop`, và chạy lại bộ e2e khi hai bot cùng làm việc.

### Đã chứng minh

Hai bot, hai màn hình, mỗi bot mở một trang rồi chụp màn hình của chính nó: `BOT-MOT` trên `:521`
nền tím, `BOT-HAI` trên `:522` nền xanh lục, hai ảnh cách nhau một giây, **không ảnh nào thấy ảnh
kia**. Đó là điều cái khoá không làm được — khoá bắt hai bot xếp lượt, cấp riêng thì chúng chạy
cùng lúc.

### Về độ ổn định của bộ e2e

Ba lần chạy liên tiếp cho 29/29, 27/29 và 28/29, và **lỗi rơi vào chỗ khác nhau mỗi lần** — luôn là
một trong các phép kiểm dựa vào thị giác (nhóm 6, 8, 9). Các phép kiểm tất định xanh cả ba lần.

Nói thẳng: bấm không toạ độ, dựa vào model nhìn ảnh, **không tất định**. Ước lượng thô là mỗi bước
thị giác trượt cỡ 10–20%. Với widget gốc nhỏ thì tệ hơn — một lần model đọc nút `LUU` thành `LUI`.
Đó không phải lỗi sửa được bằng một commit; đó là hình dạng của tính năng, và routine desktop phải
được viết với giả định "có lúc nó không tìm thấy" — nên lời dặn "không thấy thì DỪNG" quan trọng
hơn là trang trí.

## Rủi ro phải nói trước

- Bước 2 chạm vào đường đang chạy tốt của mọi bot. Nên làm sau một mốc commit sạch.
- Chrome trên display mới hiện cảnh báo `--no-sandbox` và một hộp "Can't update Chrome"; vô hại
  nhưng nó **chiếm chỗ trên ảnh chụp**, và model đọc toạ độ từ ảnh đó. Cần cờ tắt bớt.
- RAM chặn trước đĩa ở thời điểm này (14 so với 37), nhưng tỉ lệ đó đổi theo việc phần mềm khác
  trên box lớn lên. Đừng gắn cứng bên nào: lấy số nhỏ hơn trong hai, như `headroomOf` đang làm.
- Thu hồi phải xoá cả profile dir, không giữ lại — đó là phần chiếm đĩa.
