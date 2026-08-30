# TRẠNG THÁI — một chỗ duy nhất

> Đo **31/08/2026** bằng `node services/grokbot-backend/scripts/trang-thai.mjs`.
> Số ở đây do script in ra; phần chữ là để giải thích số, không phải để thay số.

Trước tài liệu này, trạng thái nằm ở **ba** chỗ đo vào **ba** ngày khác nhau —
[bang-theo-doi.md](state/bang-theo-doi.md) (1.245 dòng, 25–27/08),
[system-xray.md](state/system-xray.md) (561 dòng, 25/08),
[con-thieu-so-voi-0-30.md](plan/con-thieu-so-voi-0-30.md) (107 dòng, 29/08).
Ba nguồn sự thật thì luôn có ít nhất hai cái sai và không ai biết cái nào; chính `bang-theo-doi.md`
đã phải tự ghi *"bản trước ghi ngày 25–26/08 và đã lệch khá xa"*. Ba tài liệu ấy vẫn giữ nguyên làm
tài liệu SÂU — chỗ này chỉ giữ **trạng thái**.

---

## 1 · Một dòng

Backend nói được **148/147** lệnh của hợp đồng 0.30, client không còn đường nào nhận 404, bot điều
khiển được **cả box Linux lẫn máy Windows thật** của người dùng, và bám app gốc **21/23** ca đo
được. Phần chưa làm gần như trọn vẹn nằm sau các cờ tính năng mà **chính client đang tắt**.

## 2 · Lệnh gateway

```
hợp đồng 0.30: 147   ·   backend có handler: 148   ·   thiếu: 17
```

Thiếu 17, nhưng **15 trong số đó client không gọi được**:

| nhóm | số | vì sao client không gọi |
|---|---|---|
| phòng chung (`createSharedRoom`, `joinSharedRoom`, `setSharedRoomTyping`…) | 9 | sau cờ `grok_bot_multiplayer` — **mặc định TẮT** |
| gọi thoại (`getVoiceCall`, `recordVoiceCall`, `nudgeVoiceCall`…) | 5 | sau cờ `sand_voice_call` — **mặc định TẮT** |
| `getBotTemplateExportPolicy`, `resolveVirtualCardApproval` | 2 | **0 lần** trong bundle 0.29 đang chạy, cả renderer lẫn main — chỉ có trong hợp đồng 0.30 |
| `injectChromeCookies` | 1 | main nhắc 7× — **đây là món duy nhất còn thật sự mở** |

Cờ đọc từ `main.cjs` của bản đang cài:

```
grok_bot_multiplayer          TẮT      sand_share_bot              TẮT
sand_voice_call               TẮT      sand_channels               TẮT
sand_multi_machine_local_exec TẮT*     agent_prompted_cookie_sync  TẮT
```

\* Đó là **mặc định của hãng**. Bản vá `computer-tab` bật nó ngay tại chỗ renderer đọc, nên bảng
Settings → Computer chạy — xem §4.

**Đọc bảng này thế nào.** "Thiếu" không có nghĩa là "hỏng". Viết ra 14 lệnh sau cờ tắt thì client
vẫn không gọi một dòng nào; việc đáng làm là `injectChromeCookies`, và chỉ khi có nhu cầu thật.

## 3 · Client thực sự gọi gì

```
đã gọi 148 lệnh  ·  đường không có handler: 0 (còn thật)
gọi nhiều nhất: WatchSandBoxMigration 296.071×  ·  getAgentTranscriptTail 122.808×
                SubmitLogs 58.306×  ·  EnsureSandBox 48.718×  ·  getAgentChannels 41.777×
```

`coverage.json` còn ghi ba đường 404 — cả ba đều là **lịch sử, đã đóng**:

* `cookie-origin-approval/{requests,responses}` — mở 31/08, kênh thứ ba, xem §4;
* `GET /local-exec/may` — không phải client gọi, mà là **tôi** gõ nhầm trong lúc dò.

## 4 · Máy tính người dùng — làm được gì

| việc | trạng thái | đo bằng |
|---|---|---|
| chạy lệnh trên máy Windows | **được** | `hostname` → `DESKTOP-7D2FJG8`, exit 0 |
| nhiều máy cùng lúc | **được** | 3 máy, mỗi lệnh tới đúng máy, tên sai báo rõ |
| bảng Settings → Computer | **được** | hiện đúng máy, "Current computer" lấy id từ client |
| đổi tên máy / mức quyền | **được** | Save đổi được tên, tên người đặt không bị `hello` ghi đè |
| đọc project trên máy | **được** | bot tóm tắt đúng 5 phần của `clawe-main`, tự tránh `.env` |
| lái Chrome trên máy | **được** | mở · đọc · bấm · gõ · chụp, trong cửa sổ riêng cổng 9333 |
| cài phần mềm cần admin | **không** | daemon `KHONG-ELEVATED`; app gốc cũng chặn cứng trên Windows |
| cài phần mềm portable | **được** | bot tự tải + bung + chạy OBS 32.2.2, `obs64` PID 27156 |

Chi tiết vì sao không nâng quyền được — và vì sao **cố tình** không thêm:
[nang-quyen-tren-may-nguoi-dung.md](extracted/nang-quyen-tren-may-nguoi-dung.md).

## 5 · Bám app gốc

```
21/23 ca khớp, ổn định qua 3 lượt  ·  20 bản ghi phát lại trong docs/parity-runs/
```

Hai ca còn lệch là hai **đầu đối nghịch của cùng một cái núm**: vặn cho bot mời chọn nhiều hơn thì
ca "biết edit video" khá lên và ca "tự đăng ký giúp" hỏng, vặn ngược lại thì ngược lại. Ba vòng đo
(mỗi vòng ×3 lượt, mỗi vòng đổi đúng một thứ) cho thấy cái núm chỉ có bấy nhiêu:

| vòng | đổi gì | lệch ổn định |
|---|---|---|
| 1 | "mời chọn SAU khi đã tra" | **2** ← giữ bản này |
| 2 | thêm "việc cụ thể thì phải đi TRA" | 3 |
| 3 | thu hẹp còn "hỏi mình CÓ CÔNG CỤ gì" | 3 |

Muốn tiến thêm thì phải đổi thứ khác một luật văn xuôi — ví dụ dạy bằng ví dụ trong ngữ cảnh, hoặc
một tool riêng cho "tra catalog" để mô hình phân biệt bằng công cụ chứ không bằng cách hiểu chữ.

## 6 · Mã và test

```
68 file test  ·  78 file nguồn  ·  518 bài test xanh  ·  typecheck sạch
```

## 7 · Bản vá client

Sáu bản vá, `--verify` báo còn nguyên:

| id | vá gì |
|---|---|
| `win-drive-path` | ảnh trên ổ đĩa Windows không còn "Image unavailable" |
| `get-ultra-redirect` | nút Get Ultra mở checkout của mình |
| `computer-tab-flag` | bật `sand_multi_machine_local_exec` tại chỗ renderer đọc (**2 chỗ**) |
| `computer-tab-ipc` | `getSandMachines` hỏi backend mình |
| `computer-tab-label` | nút Save đổi tên máy |
| `computer-tab-permission` | ô Execution đổi mức quyền |
| ~~`attach-upload-observable`~~ | thừa từ 0.29 — đường đính kèm đã viết lại |

Giòn ở đâu: tên file renderer mang băm nội dung (`index-DO1aF_xy.js`), nên mỗi lần hãng dựng lại là
bản vá gãy **đỏ kèm đúng id** — cố ý, nhưng phải nhớ trỏ lại.

## 8 · Còn lại, theo thứ tự đáng làm

1. **`injectChromeCookies`** — món duy nhất còn mở mà client gọi được thật.
2. **Dùng máy Windows vào việc thật** — cửa đã thông cả hai chiều, chưa dùng vào việc gì cụ thể.
3. **Voice-call (5) và phòng chung (9)** — chỉ khi bật cờ tương ứng, hoặc khi client đổi mặc định.
4. **Hai ca parity còn lệch** — cần cách khác, không phải viết thêm luật.

## 9 · Tài liệu sâu

| chủ đề | ở đâu |
|---|---|
| hệ thống này là gì, cho người không rành kỹ thuật | [state/system-xray.md](state/system-xray.md) |
| lộ trình + danh sách việc chi tiết | [state/bang-theo-doi.md](state/bang-theo-doi.md) |
| so với 0.30, chia theo loại thiếu | [plan/con-thieu-so-voi-0-30.md](plan/con-thieu-so-voi-0-30.md) |
| hợp đồng client (RPC, kênh, thẻ) | [protocol-reference.md](protocol-reference.md) |
| nâng quyền trên máy người dùng | [extracted/nang-quyen-tren-may-nguoi-dung.md](extracted/nang-quyen-tren-may-nguoi-dung.md) |
| kiến trúc | [architecture.md](architecture.md) |
