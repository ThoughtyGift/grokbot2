# Mỗi bot một màn hình

Trạng thái: **đã chứng minh chạy được trên box hiện tại** (24/08/2026), chưa dựng vào sản phẩm.

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

1. `displays.ts` + vòng đời (dựng/thu/hết hạn), có test cho phần thu — rò một display là rò 500 MB.
2. `browser.ts` tra CDP theo bot. Đây là bước rủi ro nhất: mọi thứ đang chạy đều đi qua đây.
3. `desktop.ts` + `desktop-record.ts` nhận display.
4. `forever-box.ts` trả `vncUrl` theo bot.
5. Bỏ khoá, và **chạy lại đúng bộ e2e 29 phép kiểm** — nếu nó vẫn xanh khi hai bot cùng làm việc
   thì mới thật sự xong.

## Rủi ro phải nói trước

- Bước 2 chạm vào đường đang chạy tốt của mọi bot. Nên làm sau một mốc commit sạch.
- Chrome trên display mới hiện cảnh báo `--no-sandbox` và một hộp "Can't update Chrome"; vô hại
  nhưng nó **chiếm chỗ trên ảnh chụp**, và model đọc toạ độ từ ảnh đó. Cần cờ tắt bớt.
- Đĩa 87% là vấn đề **trước** khi RAM là vấn đề. Thu hồi profile khi thu display, không giữ lại.
