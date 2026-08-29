# Lượt nói trong phòng và system prompt — hình dạng TRÍCH ĐƯỢC

> Trích 2026-08-29 từ `dist/electron-main/main.cjs` của 0.30 (và có y hệt trong 0.29).
>
> **Đính chính một khẳng định cũ của tôi.** `0-29-mapping.md §6` ghi rằng thuật toán lượt nói và
> system prompt "nằm ở server, không trích được". Đúng một nửa: **nội dung** và **chính sách** nằm ở
> server, nhưng **hợp đồng** thì nằm ngay trong bundle và đọc được đầy đủ. Tôi đã kết luận sau khi
> tìm trong renderer và `electron-main`, mà **chưa từng tìm trong `node-agent-coordinator`** — và
> hoá ra cũng không cần: nó nằm ngay trong `electron-main`, tôi chỉ chưa tìm đúng từ khoá.

## 1 · Điều phối lượt nói trong phòng

```
aiserver.v1.RequestGrokBotRoomMemberTurnRequest
  1  nonce            string
  2  room             message
  3  member_agent_id  string
  4  peers            message[]      ← lặp
  5  new_messages     message[]      ← lặp
  6  is_winding_down  bool
  7  deadline_ms      int64

aiserver.v1.RequestGrokBotRoomMemberTurnResponse
     dispatch         enum GrokBotRoomMemberTurnDispatch
     member_agent_id  string
```

```
GrokBotRoomMemberTurnDispatch
  0 UNSPECIFIED   1 ACCEPTED   2 DUPLICATE
  3 NOT_TEMPORAL  4 TARGET_NOT_FOUND   5 TEMPORAL_UNAVAILABLE
```

Đọc được gì từ đây:

* Máy chủ **chỉ định từng thành viên một** (`member_agent_id`), không phát tán rộng. Mỗi lượt là một
  lời gọi riêng cho một con bot.
* `peers` và `new_messages` đi **kèm lời gọi** — nghĩa là con bot được đưa cho bối cảnh phòng ngay
  lúc được gọi, không phải tự đi đọc.
* `nonce` + `DUPLICATE` = chống gọi trùng, đúng vai trò `clientNonce` bên ta.
* `NOT_TEMPORAL` và `TEMPORAL_UNAVAILABLE` xác nhận điều phối chạy trên workflow Temporal.
* `is_winding_down` là **cờ máy chủ gửi XUỐNG**, không phải thứ bot tự tính. `deadline_ms` cũng vậy.

**Vẫn không trích được:** *khi nào* máy chủ bật `is_winding_down`, nó chọn `member_agent_id` theo
luật gì, và cấp `deadline_ms` bao nhiêu. Đó là chính sách, nằm trong workflow phía họ.

Nhưng hợp đồng này đủ để dựng lại một bộ điều phối **cùng hình dạng** — và nó nói rõ hai điều bên ta
đang làm khác: ta fan-out lần lượt trong một vòng lặp, còn họ gọi từng lượt một và có cờ dừng do
máy chủ cấp. Trần `MAX_HOPS` của ta là bộ đếm; `deadline_ms` của họ là đồng hồ.

## 2 · System prompt

```
agent.v1.SystemPromptSpec
  oneof spec {
    1  replace  string
    2  append   string
  }
```

Kèm các trường mang nó:

```
RequestContextRulesPart  53  system_prompt_override   message SystemPromptSpec
…                        29  system_prompt_spec       message SystemPromptSpec
…                       121  system_prompt_spec       message SystemPromptSpec
…                         8  custom_system_prompt     string
feature gate               sand_grok_bot_slim_system_prompt
```

Nghĩa là hãng cho phép **thay hẳn** hoặc **nối thêm** vào system prompt, ở cấp request. Đó là cơ chế,
và cơ chế thì map được. **Văn xuôi vẫn không có trong bundle** — tìm `"You are Grok Bot"` trên toàn
bộ 125 file lớn của cả hai bản: **0 lần**.

## 3 · Cài phần mềm trên box

Vẫn **không trích được**: `apt-get` và `install_package` đều 0 lần trong mọi bundle. `vm_setup` chỉ
xuất hiện như một *tên subagent type*, không kèm logic. Kết luận cũ giữ nguyên.

## 4 · Tool catalog — một di tích, không phải nguồn hiện hành

`docs/extracted/tool-catalog.json` giữ 54 schema tool, trích từ chunk `index-DNC736IO.js` của bản
0.20. Đo lại trên bản mới: **1/54 tên còn xuất hiện trong renderer 0.29 và 0.30**. Hãng đã chuyển
schema tool sang server giữa 0.20 và 0.29. File đó vẫn đúng cho 0.20 và vẫn có giá trị tham khảo,
nhưng nó **không mô tả app hiện tại**.
