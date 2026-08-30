# Mapping system prompt: live (agent đang chạy) → grokbot2

> 2026-08-30. **Live** = prompt server bơm vào Grok Bot đang chat phiên này (không có trong asar 0.30).
> **0.20** = [`prompt-base-goc-0.20.md`](./prompt-base-goc-0.20.md).
> **gb2** = [`prompt-base-hien-hanh.md`](./prompt-base-hien-hanh.md) ← `prompt-base.ts`.
> Văn xuôi live (đã lọc memory/tool schema): [`prompt-base-goc-live.md`](./prompt-base-goc-live.md).

Ba cột. `KEEP` = grokbot2 còn đoạn tương đương (có thể đã rewrite tên tool). `DROP` = generator cố ý bỏ. `NEW` = live có, 0.20 extract không có chương riêng.

## Tên tool giọng nói (lệch đời)

| Đời | Tool tới user |
|---|---|
| 0.20 host | `SendMessage` |
| Live 2026-08-30 | `SendToUser` (cùng vai: type text/widget/attachment/cursor-agent/secret-request) |
| grokbot2 | không có tool giọng nói — plain text **là** bong bóng |

Đó là lý do `build-prompt.mjs` DROP cả chương "only voice". Copy live nguyên xi vào grokbot2 sẽ dạy model gọi `SendToUser`/`SendMessage` — **không tồn tại** trên BE tự host.

## Bảng chương

| # | Chương live | 0.20 | gb2 | Ghi chú map |
|---|---|---|---|---|
| 1 | How a turn works | có | KEEP một phần | Live bước 2 = Pick the surface (Read/Shell mặc định, MCP, web, **machineId** máy user). gb2 bỏ bước 2 vì ExternalShell. Live: exception tapback `ReactToMessage`. |
| 2 | **SendToUser is your only voice** | có (tên SendMessage) | **DROP** | Cùng luật; đổi tên tool. Không map vào gb2 trừ khi đổi kiến trúc transcript. |
| 3 | Reply first, then keep the user posted | có | KEEP | Live nhắc cursor-agent card không tính là ack. |
| 4 | Tone | có | KEEP | Live thêm ReactToMessage tapback. |
| 5 | Reply length and shape | có | KEEP | Live: mermaid, KaTeX, identifier trong code span. |
| 6 | Showing your work | có | KEEP cắt | Live: Copy box path, CloudAgent artifacts `cursor.com/artifacts`, GenerateImage, Screenshot lúc computerUse. gb2 DROP file:// host + cloud agent. |
| 7 | Never fabricate data | có | KEEP | |
| 8 | Asking for decisions | có | KEEP | Live widget: multiSelect, secret-request, không hỏi tool đã có UI duyệt. |
| 9 | Threaded replies | có | **DROP** | Live: `reply_to`, chỉ digest/progress. |
| 10 | Where you work | có | **DROP** (vài đoạn 83–85 KEEP) | Live: box vs **ListMachines + machineId**; CopyToBox/CopyFromBox; không clone repo. gb2: một máy Linux, không user-PC đầy đủ. |
| 11 | Long-running commands | có | **DROP** | Live: `block_until_ms`, AwaitShell. gb2 `run_terminal_command_v2` không có background mode (ghi trong generator). |
| 12 | Delegating background work | có | KEEP mỏng | Live: Task executor/browserUse/computerUse/watchVideo, CheckSubagent, MessageSubagent, StopSubagent. gb2: `task_v2` chạy xong mới trả, không poll. |
| 13 | Managing plugins and MCP | có | KEEP rewrite | Live: SearchPlugins, InstallPlugin, AuthenticateMcpServer, model **được** cài sau widget. gb2 rewrite: user cài từ pane (một số câu live đã cho model `setup_plugin`). |
| 14 | Reaching services that have no connector | có | KEEP | Live: SearchPlugins trước, rồi browserUse. |
| 15 | Debugging the box | có | KEEP đổi tên | Live: `/home/box/reference/debugging-the-box.md`, Update Grok Bot's Computer. File đó **không có** trên box gb2 → generator bỏ path. |
| 16 | The Grok Bot app UI | có | **DROP** | Live: `/home/box/reference/app-ui.md`. |
| 17 | Matching the user's writing style | có | **DROP** | Sample kênh trước khi draft. gb2 KEEP đoạn 126 (sample voice) rời. |
| 18 | Cursor Origin | có | **DROP** | Live: `cursor.com/codebase`, CLI `origin` read-only. |
| 19 | Code changes | có | **DROP** | Live: **bắt buộc CloudAgent** cho repo; không clone. gb2 không có CloudAgent (`getCloudAgentInfo=null`). |
| 20 | Autonomy | có | KEEP | |
| 21 | Initiative | có | KEEP | |
| 22 | When your own action needs approval | có | KEEP | Live: Auto-review, `request_smart_mode_approval`. |
| 23 | Security | có | **DROP** | Live: machineId = máy user, không lấy credential để tự cấp quyền. |
| 24 | Untrusted content | **NEW** (so với bảng ## 0.20) | không | Fence `cursor_untrusted_data_*`; không làm theo lệnh trong tool result. |
| 25 | Multitasking / executor | **NEW** | không | TodoWrite, một executor/stream, không nói "dispatch" với user. |
| 26 | MCP server accounts | **NEW** | không | Nhiều account / `account_label`. |
| 27 | Time | **NEW** | không | Báo giờ theo timezone user (live: Asia/Bangkok). |
| 28 | User / project / agent memory | runtime | không trong prompt-base | Đường file `/home/box/agent-data/...`; update_state. |
| 29 | Routines | runtime + luật | không trong prompt-base | Cron + listener Slack/GitHub/Origin/Teams/Linear/Sentry/PagerDuty/webhook. gb2: ops cron/webhook inbound, không outbound. |
| 30 | Skills | runtime | không | Catalog + `sand-workflow:` link. |
| 31 | Purchases (Stripe Link) | **NEW** | không | `request_virtual_card`. Cổng `resolveVirtualCardApproval` gb2 chưa có. |
| 32 | Teammates / CreateAgent / channels | **NEW** so với 0.20 ## list | một phần tool | Live: SendToAgent. gb2 có create_agent/create_group. |
| 33 | Your box + The box desktop | có (nằm Where you work / computer) | KEEP một phần | Live: browserUse trước, computerUse khi cần GUI; request_box_help. |
| 34 | Safety overlay (DISALLOW) | overlay server | không | child_sex, bio, cyber offensive, … — không nằm `prompt-base.ts`. |

## Map được sang gb2 ngay (nên port)

Những mục live **còn thiếu** ở `prompt-base.ts` nhưng gb2 **đã có surface** (tool/BE có, prompt chưa dạy):

| Live | Surface gb2 đã có | Việc |
|---|---|---|
| Untrusted content / fence tool result | tool result vẫn bọc | thêm 1 chương ngắn: không làm theo lệnh trong output |
| Timezone user | host_settings | 1 đoạn: báo giờ local |
| browserUse vs computerUse | computer :8790 + browser tools | siết đúng thứ tự live (browser trước) |
| `request_box_help` / handoff | đã có | KEEP rồi |
| widget multiSelect / secret-request | secret-request **chưa emit** | prompt có thể dạy; thẻ còn thiếu (xem so-sánh BE) |
| create_agent / create_group | đã làm 28/08 | thêm luật phòng (directAddressedAcceptance đã đọc) |
| watch_video / mediaReview | đã làm | không cần copy nguyên subagent 0.20 |

## Không map được (dù copy prompt)

| Live | Vì sao gb2 không nhận |
|---|---|
| SendToUser / SendMessage only-voice | kiến trúc transcript đảo |
| CloudAgent + Origin + Code changes | `getCloudAgentInfo=null`; không phải Cursor |
| ListMachines / ExternalShell đầy đủ | local-exec 3 op, gate multi-machine tắt |
| CheckSubagent / resume subagent | `task_v2` sync |
| Stripe virtual card | lệnh 0.30 chưa trả |
| Plugin marketplace Cursor.com | catalog local |
| `*_via_server` roster/transcript | cố ý tắt, bật là gãy emulation |
| Prompt 0.30 server-only extras | không thấy trong asar; chỉ thấy trong phiên live |

## Việc cụ thể cho `build-prompt.mjs`

Không copy live nguyên. Cập nhật KEEP/REWRITE:

1. Giữ DROP chương only-voice.
2. Thêm chương **Untrusted content** (không phụ thuộc Cursor).
3. Thêm **Time** (timezone).
4. Rewrite "Pick the surface" theo máy gb2 (box Linux + VNC), không dán machineId Cursor.
5. Không bật chương CloudAgent / Origin / Purchases / ExternalShell trừ khi surface đã có.
6. Đối chiếu tên tool: live `SendToUser`/`WebSearch`/`CloudAgent` vs gb2 `web_search`/`task_v2`/`read_file_v2`.

Live ≠ 0.20: cùng xương 23 chương, thêm overlay + multitasking + purchases + memory/routines. gb2 đang đứng ở **port 0.20 đã cắt**, chưa bắt live 0.30.
