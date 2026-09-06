# Tool của bot — bên mình có gì, app gốc có gì

> Đo 03/09/2026. Chạy lại:
> `npx tsx --env-file=.env services/grokbot-backend/scripts/tool-hien-co.mts` (bên mình)
> `node services/grokbot-backend/scripts/tool-app-goc.mjs` (app gốc)

---

## 0 · Kết luận trước

1. **Không nhóm tool nào đang hỏng.** Cả bốn phụ thuộc đều sống lúc đo: trình duyệt bot (CDP 9224),
   box (`/home/gb2u003/workspace`, `:77`), máy người dùng (`DESKTOP-7D2FJG8`), backend `:8788`.
   Lỗi *"fetch failed"* ngày 03/09 là hầm ssh chết, đã chữa.
2. **Bên mình có 75 tool, model thấy 69** (6 tool dev bị lọc).
3. **Không so được toàn bộ danh sách với app gốc, và lý do là kiến trúc chứ không phải thiếu dữ
   liệu:** danh sách tool của hãng nằm trên MÁY CHỦ của họ. Chỗ duy nhất so được 1:1 là tool chạy
   trên máy người dùng — ở đó ta **thiếu 4**.

---

## 1 · Tool bên mình — 75, theo NGUỒN HỎNG

Nhóm theo thứ mỗi tool dựa vào, không theo chức năng: một tool không tự hỏng, nó hỏng vì thứ nó
dựa vào — và cả nhóm chết cùng lúc.

| nhóm | số | cần gì | tool |
|---|---|---|---|
| Trình duyệt bot lái | 16 | CDP qua hầm ssh (`GROKBOT2_BROWSER_CDP`) | `browser_cdp` `browser_click` `browser_drag` `browser_evaluate` `browser_fill` `browser_get_bounding_box` `browser_highlight` `browser_mouse_click_xy` `browser_navigate` `browser_press_key` `browser_scroll` `browser_select_option` `browser_snapshot` `browser_tabs` `browser_take_screenshot` `browser_type` |
| Máy tính THẬT của người dùng | 4 | app Grok Bot đang mở trên máy đó | `local_browser` `local_machines` `local_read` `local_shell` |
| Box Linux — file & shell | 8 | box daemon | `delete_file` `edit_file` `edit_file_v2` `glob_file_search` `list_dir_v2` `read_file_v2` `ripgrep_raw_search` `run_terminal_command_v2` |
| Web | 2 | mạng ra ngoài | `web_fetch` `web_search` |
| MCP | 4 | server MCP đã cấu hình | `call_mcp_tool` `get_mcp_tools` `list_mcp_resources` `read_mcp_resource` |
| Trong backend | 41 | không gì cả | `ask_question` `attach_file` `attach_image` `await_task` `computer_use` `create_agent` `create_diagram` `create_group` `create_plan` `create_routine` `create_skill` `create_workflow` `demo_start` `demo_stop` `desktop_teach_start` `desktop_teach_stop` `email_draft` `generate_image` `knowledge_base` `message_agent` `rename_agent` `request_box_help` `request_secret` `request_user_form` `search_conversations` `send_to_user` `setup_plugin` `share_bot_template` `slack_draft` `task` `task_v2` `todo_read` `todo_write` `view_image` `watch_video` + 6 tool dev |

**6 tool dev không gửi cho model:** `echo` `time` `reverse` `upper` `count` `calc` — lọc bằng
`DEV_TOOLS` trong `runtime/tools.ts`. `demo_start`/`demo_stop` thì **có** gửi, cố ý: chúng có đoạn
lời nhắc riêng cho đường quay video.

**Đừng dựng bảng này bằng grep.** 16 tool `browser_*` và 8 tool box được nạp vào `TOOLS` bằng vòng
lặp ở mức module, nên bảng grep tĩnh ra 47 và thiếu đúng nhóm hay hỏng nhất — mà "thiếu trong bảng"
trông y hệt "không tồn tại".

---

## 2 · App gốc có tool gì — và vì sao không đếm được hết

Ba nguồn, ba câu trả lời khác nhau. Chỉ một cái dùng được.

| nguồn | ra gì | dùng được không |
|---|---|---|
| enum `ClientSideToolV2` trong `main.cjs` | 55 tên | **KHÔNG** — enum của Cursor IDE |
| renderer 0.30 | **0** — không chứa enum ấy một lần nào | chính nó là câu trả lời |
| transcript thật (cache client, 24 bản) | **0 mục `tool-call`** trên 457 tin bot | chính nó là câu trả lời |

**Enum 55 tên không phải danh sách tool của Grok Bot.** Nó khai `go_to_definition`, `fix_lints`,
`fetch_pull_request`, `apply_agent_diff`, `read_lints`, `search_symbols`, `reapply` — thứ chỉ có
nghĩa trong trình soạn mã, di sản Cursor. Ai so thẳng bảng của mình với enum này sẽ ra "app gốc có
32 tool ta thiếu" và đi làm 32 việc cho không ai.

**Renderer không biết enum đó.** `grep "COMPUTER_USE=54"` trong toàn bộ `renderer/assets`: 0 file.
Client không quyết định danh sách tool — nó chỉ VẼ những gì máy chủ hãng gửi xuống.

**Và máy chủ hãng không gửi tool-call xuống client.** 24 transcript, 457 `send-message`, **0
`tool-call`**. Kiểm bằng đường thứ hai: bản xuất Markdown `chat-goc-0.29.md` cũng 0 dòng 🔧. Hoạt
động tool của hãng ở lại trên box của họ; người dùng chỉ thấy tin nhắn và widget.

> Đây là bẫy §7 lặp lại lần thứ năm: **trường có trong hợp đồng ≠ trường có người ĐỌC.** Cách phân
> biệt vẫn là một: đếm chỗ đọc ở đầu bên kia.

### 2b · Chỗ tool hãng lộ tên: máy người dùng

Daemon local-exec của hãng khai đúng 7 hành động (`isSandLocalToolAction`, `local-exec-daemon/main.cjs`):

```
["run-command","send-input","read-file","list-directory","write-file","read-messages","send-imessage"]
```

và 7 dạng tham số RPC: `shellStreamArgs` · `backgroundShellSpawnArgs` · `forceBackgroundShellArgs` ·
`writeShellStdinArgs` · `readArgs` · `redactedReadArgs` · `lsArgs`.

**Bên mình có 5 trên 7, và 5 là TRẦN của chính daemon** (06/09) — `LocalOp` là
`shell | read | ls | write | spawn (| stdin chỉ để đo)`, `actionOf` trả đúng tên hành động của daemon.

| hãng có | ta có | ghi chú |
|---|---|---|
| `run-command` | ✅ `local_shell` | đồng bộ, trần 120s |
| `read-file` | ✅ `local_read` | |
| `list-directory` | ✅ `local_read` (ls) | |
| `write-file` | ✅ `local_write` (06/09) | khung `{kind:"upload", path, bytesBase64}` riêng, KHÔNG qua `serverMessage`; daemon giữ trong `localRoot`, quá 100 MiB từ chối; đo: 61 byte UTF-8 có dấu về nguyên |
| chạy nền vượt lượt (`backgroundShellSpawnArgs`, `outlivesScope`) | ✅ `local_shell_bg` (06/09) | trả `shellId`+`pid`; đầu ra ở `<localRoot>/terminals/<shellId>.txt` (đầu `status:`, cuối `exit_code:`), đọc bằng `local_read`; đo: tệp mọc 14–16 s SAU khi lượt model đã xong |
| `send-input` | ❌ **và hãng cũng không** | daemon trả *"No handler found for server message of type writeShellStdinArgs"*: `buildLocalExecManager` (0.29 lẫn 0.43) chỉ đăng ký 4 handler `shellStreamArgs · backgroundShellSpawnArgs · readArgs · lsArgs`. Tên có trong `isSandLocalToolAction` và nhánh có trong `describeLocalExec`, nhưng không có người thực thi |
| `forceBackgroundShellArgs` | ❌ và hãng cũng không | cùng lý do — không nằm trong 4 handler |
| `read-messages` · `send-imessage` | ❌ | Messages của macOS — không áp cho Windows |

Hai dòng "❌ và hãng cũng không" là bẫy §7 lần thứ sáu, đo bằng cách gửi khung thật xuống daemon thật
(`/internal/ops/local-exec` kind `stdin`) chứ không bằng đọc danh sách hành động. Đo đường model:
`scripts/e2e-may-nguoi-dung.mjs` 7/7 (thẻ `write-file` · tệp đúng nội dung · thẻ `run-command` · shellId
trong câu bot · tệp của lệnh nền xuất hiện khi không còn lượt nào chạy).

### 2c · Ba mặt tự soát — TRÙNG KHỚP

Transcript hãng ghi `surface` ở mỗi lần tự soát: `automation_write` (4) · `subagent` (1) ·
`computer` (1). Đúng ba mặt bên mình đã gắn trong `tools.ts` và đo 7/7. Không lệch.

Dạng thẻ xin quyền máy người dùng của hãng cũng khớp `actionOf` bên mình:

```json
{"type":"local-tool-permission","ask":{"action":"run-command",
 "target":"powershell -NoProfile -Command \"…\"","machineLabel":"Admin-PC","status":"always"}}
```

---

## 3 · Bẫy trả giá trong chính lượt đo này

**Sai khoá `owner` thì box trả lời "pool exhausted" — nghe hệt một sự cố hạ tầng.** Tôi dò
`/grok-exec/health` với header `x-grokbot2-owner: admin@cinai.tv` và nhận
`per-user mode: pool exhausted (5 in use)`, suýt báo "cả nhóm tool box đang chết". Owner thật là
`auth0|grokbot2-user` (`DEFAULT_USER.authId`), và với khoá đúng box trả `ok:true`. Box khoẻ suốt.

Điều đó vẫn để lộ một rủi ro THẬT: dải chỉ có **5 tài khoản** `gb2u001…005` và cả 5 đã cấp. Người
thứ 6 sẽ thấy **mọi tool box hỏng cùng lúc**, kèm một câu lỗi viết cho quản trị viên chứ không cho
người dùng. Trần này chặn sớm hơn nhiều so với trần RAM (14 bot).

**`boxHealth()` KHÔNG bao giờ ném** — hỏng thì nó *trả về* chuỗi lỗi. Bản đầu của
`tool-hien-co.mts` bọc `try/catch` rồi in `SỐNG` đè lên đúng câu `KHÔNG tới được`. Cùng họ với
`callPool` trong bảng bẫy: phải đọc giá trị trả về, không bắt ngoại lệ.

**Không đọc `connectedMachines()` từ script rời.** Hàng đợi local-exec nằm trong bộ nhớ tiến trình
server, nên script rời luôn thấy rỗng và sẽ báo "không máy nào nối" cho một máy đang nối. Cách hỏi
đúng: POST `/internal/ops/local-exec` với một tên máy KHÔNG tồn tại — nhánh 404 in ra danh sách máy
mà không chạy lệnh nào.
