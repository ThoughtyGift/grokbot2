# Còn thiếu gì so với app gốc 0.30 — đo, không đoán

> Đo 2026-08-29 trên `asar029` + `asar030` đã giải nén. Mỗi con số dưới đây có một lệnh sinh ra nó;
> không mục nào là ước lượng.

## Cách đọc bảng này

Ba loại khác nhau, đừng trộn:

* **Thiếu năng lực** — ta chưa làm. Sửa được bằng code.
* **Thiếu dữ liệu** — ta làm rồi nhưng không có thứ để hiển thị (ví dụ catalog MCP nghèo hơn).
* **Không thuộc về ta** — chạy trên server hãng hoặc trên máy người dùng. Không sửa được từ backend.

Trộn ba loại này là cách một danh sách việc trở thành một danh sách lo lắng.

## 1 · Lệnh gateway — 135/147

Đo bằng `extract-gateway.mjs` (bảng `("gateway",{methods:{…}})` trong `electron-main`) đối chiếu
bảng lệnh ACL chạy thật.

```
cuộc gọi thoại (5)   getVoiceCall · nudgeVoiceCall · recordVoiceCall
                     readVoiceCallAgentContext · readVoiceCallSentMessages
lẻ (6)               resolveVirtualCardApproval       ← thẻ ảo, mới ở 0.30
                     injectChromeCookies              ← nhập cookie Chrome
                     getBotTemplateExportPolicy       ← chính sách xuất mẫu
                     generateAgentAvatarImage · getAgentNotificationAvatar · getMcpPluginLogo
```

## 2 · Loại thẻ trong bản ghi — 8/17

App gốc 0.30 có 17 loại `send-message`; ta khai báo 8.

```
CÓ    text · attachment · widget · email-draft · slack-draft
      listener-connect · auto-review-approval · local-tool-permission

THIẾU cursor-agent · secret-request · user-form · permission-request
      connector · connectors · bot-template-share
      virtual-card-approval      ← mới 0.30
      cookie-origin-approval     ← mới 0.30
```

**Hai cái đáng làm trước, vì ruột đã có sẵn:** `secret-request` và `user-form`. Ta ĐÃ phục vụ
`submitSecret`, `submitUserForm`, `dismissUserForm` — tức có đủ đường nhận câu trả lời, nhưng không
chỗ nào dựng thẻ ra để hỏi. Cùng mẫu với trường `title`: khai báo, nối dây, không ai điền.

## 3 · Entry kind — thiếu `feedback` và `voice-call`

App gốc: `message · user-attachment · notice · feedback · voice-call` (+ `send-message`,
`tool-call`, `event`). Ta thiếu hai cái cuối.

## 4 · Feature gate — 1/42

Ta phát đúng `sand_teach_by_demonstration`. Nhưng **phần lớn 42 gate kia KHÔNG nên bật**:

* `*_via_server` (`sand_roster_via_server`, `sand_send_via_server`, `sand_attachments_via_server`,
  `sand_transcript_server_tail`) — bật là đẩy dữ liệu qua server hãng thay vì qua box của ta. Phải
  giữ TẮT.
* telemetry (`sand_rpc_tracing`, `sand_process_metrics`, `sand_product_analytics`…) — không có ý
  nghĩa với backend tự dựng.
* Gate mở ra tính năng ta chưa có (`sand_marketplace_bots`, `sand_multi_machine_local_exec`,
  `sand_import_chrome_cookies`) — bật vỏ mà không có ruột sẽ ra bảng trống, **tệ hơn là ẩn**.

Nên đây không phải "thiếu 41 gate". Chỉ bật gate khi ruột sẵn sàng.

## 5 · Kho trích xuất — chỉ 1/11 file là hiện hành

```
gateway-commands.json    0.30   ← vừa làm mới
box-host-contract.json   0.20   ← routes/auth/channels vẫn đo theo bản này
tool-catalog.json        0.20   ← 1/54 tên còn tồn tại ở 0.29+; là di tích
subagent-prompts.json    ~0.20
proto-*.json, ui-*.json  không ghi phiên bản
```

## Thứ tự đề nghị

**① `secret-request` + `user-form`** — ruột đã có, chỉ thiếu thẻ. Rẻ nhất, và đóng một mẫu lỗi đã
gặp ba lần (khai báo mà không ai điền).

**② `getAutomationWebhookCredential` + routine webhook** — ~~còn thiếu~~ **XONG 2026-08-29**
(`c7b2bff`). Nhóm automations giờ đủ 8/8. Hợp đồng lấy từ renderer chứ không đoán: `{url, key}`,
`key: null` nghĩa là "đang đúc, hỏi lại mỗi 2s, quá 15 lần thì bỏ" — ta đúc ngay nên luôn trả khoá
thật. Cửa nhận `POST /hooks/automation/<id>` đặt ở ops, khoá so ở BFF vì ops không đụng sqlite.
Chi tiết trong commit; điểm đáng nhớ là `toClientAutomation` trải `...rec` nên bí mật phải gỡ TAY
tại đó, và có bài test giữ.

**③ Trích lại `routes`/`auth`/`channels` theo 0.30** — bị chặn vì 0.30 thay router if-chain bằng bộ
điều phối theo đăng ký. Chưa đo được kích thước; phải khảo sát trước khi hứa.

**④ Cụm voice-call (5 lệnh)** — khối lớn nhất còn lại, nhưng giá trị với người dùng này chưa rõ.

**Chưa nên làm:** thẻ ảo (cần nhà cung cấp thanh toán), marketplace (cần máy chủ chia sẻ),
`GrokBotUserComputer` (là quyết định an toàn, không phải tính năng thường).

## Nhắc lại một điều không sửa được bằng code

`prompt-base.ts` của ta là bản port từ **0.20** — bản duy nhất từng ship `dist/host/` kèm system
prompt. Từ 0.29 hãng đã bỏ host khỏi client, nên **mọi sửa đổi prompt của họ về sau ta không nhìn
thấy**. Khoảng cách hành vi sẽ rộng dần theo từng phiên bản, và chỉ đóng được bằng cách quan sát
rồi đo thống kê — không đóng được bằng đối chiếu.
