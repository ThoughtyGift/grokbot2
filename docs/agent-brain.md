# The agent brain — what ships, what doesn't

Written after extracting the shipped client bundle, because the question "can we just take
the original brain?" has a hard answer that changes how the backend must be built.

Regenerate with:

```bash
# descriptors + tool catalog, from the RENDERER bundle
node services/grokbot-backend/scripts/extract-tools.mjs \
  <path-to>/renderer/assets/index-*.js docs/extracted

# prompts, from the BOX HOST bundle — a different file, and the one that matters
node services/grokbot-backend/scripts/extract-prompts.mjs \
  <path-to>/host/host-main.cjs docs/extracted
```

---

## 1. The short answer — corrected

> **Superseded.** The first version of this document concluded "the brain does not ship, and no
> amount of extraction will produce it." **That was wrong**, and the error is worth recording
> because it is a research trap, not a typo: the search was run against
> `dist/renderer/assets/index-*.js` only. The prompts live in `dist/host/host-main.cjs` — the
> **box host**, which ships inside the very same `app.asar`. Searching one bundle and concluding
> something about the app is how you miss 33 KB of prompt sitting in the next file over.

What actually ships, in `host-main.cjs`:

| | |
|---|---|
| `buildSandBaseSystemPrompt` | **32,829 chars** — Grok Bot's own base system prompt |
| `SAND_AUTO_REVIEW_CLASSIFIER_SYSTEM_PROMPT` | 58,221 chars |
| 38 more prompts | subagent reminders, compaction, summarisation, wake/revival prompts |
| 6 subagent configs | permission mode + model + which reminder |
| 7 tool allowlists | which tools each subagent may use |

Identified by content, not by name: the base prompt contains 14 mentions of `SendMessage`,
32 of `box`, 12 of `cloud agent`, 11 of `MCP`, and rules about routines and reaction-only
turns — i.e. it describes Grok Bot's behaviour, not a generic IDE assistant. It is assembled at
runtime from flags (`${cloudAgentsEnabled ? … : …}`), so it is a *template*, not a fixed string.

Everything is in `docs/extracted/subagent-prompts.{json,md}`.

**What still does not ship**: the agent *loop* — model choice per turn, when to stop, how tool
results re-enter context. The prompt is the instruction set; the server still runs the machine.

```
        ┌── agent loop ─────┐
        │  turn control     │   Cursor's servers (aiserver.v1)   ← still NEVER shipped
        │  model routing    │
        └───────────────────┘
                 │  emits ClientSideToolV2Call
                 ▼
        ┌───────────────────┐
        │  the box          │   Linux pod: bash, files, desktop
        │  host-main.cjs    │   ← the prompts ARE here
        └───────────────────┘
                 │  local-exec channel (box asks the desktop)
                 ▼
        ┌───────────────────┐
        │  Grok Bot desktop │   renders tool cards, executes local requests
        └───────────────────┘
```

So the loop in `services/grokbot-backend/src/chat.ts` must still be ours — but its **system
prompt no longer has to be guessed**.

## 2. What *is* extractable — and it is a lot

Two bundles, two different harvests. Search **both**.

| Extracted | Count | Bundle | File |
|---|---|---|---|
| Tools in `ClientSideToolV2` | **54** (48 with param schemas) | renderer | `docs/extracted/tool-catalog.json` |
| `aiserver.v1` + `agent.v1` messages | **2496** + **928** | renderer | `docs/extracted/proto-messages.json` |
| Enums | **182** | renderer | `docs/extracted/proto-enums.json` |
| Prompts (incl. the base system prompt) | **40** | **host** | `docs/extracted/subagent-prompts.json` |
| Subagent configs / tool allowlists | **6** / **7** | **host** | same |
| Browser MCP actions (`cursor-ide-browser`) | **16** | **host** | same |

### The browser surface

The browser is **not** bespoke code — it is an MCP provider, `cursor-ide-browser`, wrapped in a
`browserUse` subagent (`AGENT_ONLY`, model `claude-4.5-sonnet`, stateful/resumable, with
`READ/GLOB/GREP/TODO_WRITE/SEMANTIC_SEARCH` for local context). Its 16 actions:

```
browser_navigate · browser_snapshot · browser_take_screenshot · browser_click
browser_mouse_click_xy · browser_type · browser_fill · browser_select_option
browser_press_key · browser_scroll · browser_drag · browser_get_bounding_box
browser_highlight · browser_evaluate · browser_tabs · browser_cdp
```

That is near 1:1 with Playwright MCP, so "porting the browser" means pointing the loop at a
browser MCP — not writing an automation layer. The box-side browser it drives is plain
`google-chrome` on the desktop (see `box-architecture.md`).

### The 54 tools

Cursor's IDE heritage shows — many are repo tools the box never uses. The ones that matter
for a computer-using agent:

| Tool | Params |
|---|---|
| `computer_use` | `actions[]` → the desktop |
| `run_terminal_command_v2` | `command, cwd, new_session, is_background, require_user_approval` |
| `read_file_v2` | `target_file, offset, limit, chars_limit, enable_line_numbers` |
| `list_dir_v2` | `target_directory, ignore_globs[]` |
| `glob_file_search` | `target_directory, glob_pattern` |
| `ripgrep_raw_search` | `pattern, path, glob, output_mode, context_before/after, case_insensitive` |
| `web_search` / `web_fetch` | `search_term` / `url` |
| `ask_question` | `title, questions[], run_async` |
| `todo_write` / `todo_read` | `todos[], merge` / `read` |
| `task_v2` | `description, prompt, subagent_type, model, name, mode` |
| `create_plan` | `plan, title, steps[], todos[], overview` |
| `call_mcp_tool` / `get_mcp_tools` | `server, tool_name, tool_args` |
| `record_screen` | `mode, tool_call_id, save_as_filename` |
| `generate_image`, `reflect`, `await`, `send_to_user`, `ai_attribution` | no params |

Full list with every field: `docs/extracted/tool-catalog.json`.

### `computer_use` — the desktop contract

`agent.v1.ComputerUseAction` is a oneof over eleven actions:

```
mouse_move · click · mouse_down · mouse_up · drag · scroll
type · key · wait · screenshot · cursor_position
```

This is the vocabulary the VNC box speaks. Relevant when the viewer work resumes.

### `ask_question` — the "Your answer" widget

The widget seen in the original app but missing locally is this tool:

```
AskQuestionParams  { title, questions[], run_async }
  Question         { id, prompt, options[], allow_multiple }
  Option           { id, label }
AskQuestionResult.Answer { question_id, selected_option_ids[], freeform_text }
```

The FE already renders it; the backend has simply never emitted one.

## 3. Where the local brain stands

`chat.ts` today implements a small hand-written loop: the model is told to answer with
`TOOL_CALL: <name>(<arg>)`, and six pure tools are available — `echo, time, reverse, upper,
count, calc`. They touch nothing outside the process. **None of this came from the original**;
it was written to prove the approval pipeline end to end, and it does.

The gap is vocabulary, not architecture. The loop already does the right dance
(model → tool-call entry → approval card → result → follow-up answer). Renaming the tools to
the real ones and giving them real implementations is incremental work on a proven path.

### Suggested order

1. `run_terminal_command_v2`, `read_file_v2`, `list_dir_v2`, `glob_file_search`,
   `ripgrep_raw_search` — real, but executed **on the box over the exec daemon**, never on the
   user's Windows machine. This also builds the exec channel the VNC viewer may be waiting for.
2. `web_search` / `web_fetch` — no box needed.
3. `ask_question` — unlocks the widget surface the original has and we don't.
4. `computer_use` — after the viewer works.

### Known mismatch to fix while doing this

The FE renders a tool card by status: `pending` → spinner, **`failed`** → error icon,
anything else → wrench. The backend emits `error`, so a failed tool currently shows a plain
wrench instead of an error. Same class of bug as the five in `HANDOFF.md`.

## 4. Legal note

Extraction here is read-only inspection of a locally installed binary, for interoperability
with the owner's own account and infrastructure. No Cursor server prompt or model weight is
copied, because none is present. See `docs/legal.md`.

---

## Chọn bộ não: bảng đo 17/08/2026, và tại sao hai model không dùng được

Đo cùng một bộ tiêu chí qua pool `admin.halcion.vn`, prompt hệ thống thật (8.943 token):

| Model | streaming | latency | TOOL_CALL |
|---|---|---|---|
| **`gemini-3.7-flash`** ← đang dùng | rỗng → **fallback** | 4,8 s | **CÓ** (kèm JSON tên thật) |
| `gemini-3.6-flash` · `gemini-3.5-flash` | rỗng → fallback | 3,1 s | có |
| `gemini-2.5-flash` | rỗng → fallback | 2,7 s | có |
| `grok-4.5` | OK | **14 s** | **KHÔNG** |
| `claude-opus-5` | **RỖNG** | 0,9 s | **KHÔNG** |

Danh sách model có thật lấy từ `GET /v1/models` (18 model) — trang `docs-api-app` **không** liệt kê
`grok-4.5` / `claude-opus-5`, nên đừng đọc docs để chọn; hỏi endpoint.

### `claude-opus-5` — bị tắt ở tầng tổ chức

`Quản lÝ manager/services/openclaw-bridge/server.js`: **mọi** request Claude đi qua
`runViaCliProxy` → Claude Code CLI (:18803), xác thực bằng **subscription**, không phải API key.
`MODEL_MAP` có `'claude-opus-5': 'claude-opus-5'` nên tên được truyền thẳng xuống CLI.

**Đính chính (đo lại):** không phải "tắt Claude" nói chung — `claude-sonnet-5`, `claude-opus-4-5` và
`claude-haiku-4-5` đều trả `"OK"` bình thường. Chỉ **riêng `claude-opus-5`** bị chặn, nên đây là
vấn đề **entitlement theo từng model** (subscription không bao gồm opus-5), không phải cả kênh Claude.
Stdout của CLI *chính là* câu lỗi, và bridge trả nó về như một kết quả thành công:

```
success: true, result: "Your organization has disabled Claude subscription access for
Claude Code · Use an Anthropic API key instead, or ask your admin to enable access"
```

Đây là loại lỗi tệ nhất để gỡ: HTTP 200, `ok: true`, và câu lỗi **hiện ra như câu trả lời của bot**.

Dòng 89 cùng file: `{ messages, model, stream: false }` — **streaming bị tắt cứng** cho mọi model
Claude. Đó là lý do `claude-opus-5` và `sonnet` trả rỗng trên `/v1/chat/completions`.

Sửa được, nhưng ở phía pool: bật lại Claude Code cho org, hoặc cấp cho pool một Anthropic API key.

### `grok-4.5` — nó là một agent CLI có tool riêng

`Quản lÝ manager/services/grok-cli-proxy/proxy.mjs` spawn **xAI Grok Build CLI** (`grok -p`) trên
SuperGrok subscription. Ba hệ quả, đo được:

1. **Nó tự hành động bằng tool của nó.** Yêu cầu liệt kê thư mục, nó chạy `ls` thật trong
   `/tmp/grok-work/txt-747df521…` **trên VPS của pool** rồi báo "thư mục trống" — không phải box
   của người dùng. `WORKDIR = '/tmp/grok-work'` là thư mục ephemeral proxy tạo cho mỗi lần chạy.
   Bất kỳ yêu cầu file/shell nào định tuyến sang grok-4.5 sẽ tác động vào chỗ đó, không vào box.
2. **Nó có giao ước tool riêng, tên gần giống của ta.** Proxy inject marker `<<TOOL_CALL>>`
   (`TOOL_OPEN`, dòng 155) — khác `TOOL_CALL: <tên>(<đối số>)` của backend này. Nên hướng dẫn của ta
   là giao ước thứ ba mà nó không được mồi, và nó chọn tự làm.
3. **~14 s mỗi lượt** vì spawn một tiến trình CLI cho mỗi request.

Repo cũng ghi một bug đáng biết: truyền `-m grok-4.5` (đúng model mặc định) làm CLI 0.2.112
**treo vĩnh viễn**; họ lách bằng cách bỏ `-m` khi model trùng mặc định.

> Ghi chú đối chiếu: `subagents.ts` từng đo `grok-4.5` là ✅ với TOOL_CALL. Phép đo đó đã **lỗi thời** —
> repo nói CLI tự cập nhật 0.2.93 → 0.2.112 và xAI đã gỡ `grok-build`. Hành vi đổi theo.

### Giả thuyết đã bị phép đo phủ định

Vì `grok-cli-proxy` có `buildToolSystemBlock(tools, toolChoice)`, tôi đã kỳ vọng pool hỗ trợ
**native tool-calling** — thứ sẽ đóng được khoảng cách loại 3 của P5. Đo thì không:

- gửi `tools[]` (dạng Anthropic) tới `/v1/claude` với `gemini-2.5-flash` → `success: true`, `result: ""`
  (tức **làm hỏng** model đang chạy tốt)
- với `grok-4.5` → bị bỏ qua, nó vẫn dùng tool riêng

Nên P5 vẫn là loại 3: giao ước bằng chữ vẫn là lựa chọn bắt buộc trên route này.


### Đo lại 17/08 (muộn hơn): streaming hỏng với MỌI model Gemini

Ba lần mỗi model, cùng key, cùng prompt — trước khi có fallback:

| Model | stream có nội dung | non-stream |
|---|---|---|
| `gemini-3.7-flash` | **0/3** | OK |
| `gemini-3.6-flash` | **0/3** | OK |
| `gemini-3.5-flash` | **0/3** | OK |
| `gemini-2.5-pro` | 1/3 | OK |
| `gemini-2.5-flash` | 1/3 | OK |

Nên **đổi model chưa bao giờ là cách sửa** — nó chỉ đổi tần suất thua. Lần chuyển sang
`gemini-2.5-flash` trước đó dựa trên **một mẫu may mắn**; ở mức 1/3 đó là may, không phải fix.

Sửa đúng tầng: `streamPool` trong `packages/pool-client` tự gọi lại route non-stream khi stream
rỗng. Sau đó **3/3 cho cả ba model**, và bộ não trở về `gemini-3.7-flash` — model mới nhất, và là
model **duy nhất** phát TOOL_CALL đúng dạng JSON tên thật:

```
TOOL_CALL: list_dir_v2({"target_directory":".","depth":1})
```

### Vì sao model Claude không gọi được tool của ta (kể cả khi chạy được)

Đo với prompt thật 8.943 token, trên các model Claude **chạy bình thường**:

| Model | TOOL_CALL của ta | `<<TOOL_CALL>>` của proxy | Nó tự nói gì |
|---|---|---|---|
| `claude-sonnet-5` | KHÔNG | không | "tôi chỉ có công cụ để **đọc nội dung một file**" |
| `claude-opus-4-5` | KHÔNG | không | "Công cụ **Read** của tôi…" |
| `claude-opus-4-8` | KHÔNG | không | "công cụ hiện có của mình chỉ cho phép **đọc file**" |
| `claude-haiku-4-5` | KHÔNG | không | hỏi lại cho rõ |

### `claude-opus-4-8` — đo riêng, 17/08

Model này **không bị chặn** như `claude-opus-5`, và **stream chạy native** (không cần tới fallback
vừa thêm ở `streamPool` — khác hẳn mọi model Gemini). Nhưng nó **không dùng được** làm bộ não, vì
tầng tool. Bốn yêu cầu, mỗi yêu cầu nhắm đúng một tool đang có, so trực tiếp với model đang chạy:

| Yêu cầu | `claude-opus-4-8` | | `gemini-3.7-flash` | |
|---|---|---|---|---|
| đọc file | không | 14,2 s | `TOOL_CALL: read_file_v2("ghi-chu.md")` | 6,8 s |
| chạy lệnh | không | 10,4 s | `TOOL_CALL: run_terminal_command_v2({"command":"ls -la"})` | 6,0 s |
| tìm web | không | 10,9 s | `TOOL_CALL: web_search({"search_term":"giá vàng hôm nay"})` | 6,4 s |
| **ép** dùng `list_dir_v2` | không | 8,3 s | `TOOL_CALL: list_dir_v2({"target_directory":"."})` | 3,8 s |

**0/4 so với 4/4, và chậm gấp đôi.** Đáng chú ý là lượt thứ tư: prompt nói thẳng *"BẮT BUỘC dùng
công cụ `list_dir_v2`"* và nó vẫn trả lời *"Mình không có công cụ `list_dir_v2`"* — nó phủ nhận một
tool được liệt kê ngay trong system prompt 8.943 token của chính lượt đó. Đây không phải model kém
hiểu đề; đây là **danh tính agent của Claude Code CLI ghi đè bảng tool ta gửi**. Cùng nguyên nhân
cấu trúc với `claude-sonnet-5` và `claude-opus-4-5`, nên kết luận suy ra được cho cả họ Claude qua
pool này: **chạy được ≠ dùng được**. Bộ não vẫn là `gemini-3.7-flash`.

`claude-opus-4-5` **tự gọi tên tool của nó: `Read`** — đó là toolset của Claude Code CLI. Và
`openclaw-cli-proxy/proxy.mjs` có đúng cùng shim `TOOL_OPEN = '<<TOOL_CALL>>'` như grok. Nên model
Claude đến với **danh tính agent và bộ tool riêng**, còn `TOOL_CALL: <tên>(<đối số>)` của ta là một
giao ước cạnh tranh mà nó bỏ qua. Với `claude-opus-5` thì câu hỏi tool là **vô nghĩa** — nó bị chặn
trước khi model kịp chạy.

> **ĐÍNH CHÍNH — hai đoạn trên sai.** Xem [Nguyên nhân thật](#nguyên-nhân-thật-pool-bỏ-trường-system-với-mọi-model-claude)
> ở cuối trang. Không có gì bị "ghi đè": **prompt của ta chưa bao giờ đến model**. Và `claude-opus-5`
> không bị chặn theo model — bị chặn theo **tài khoản** trong pool. Sau khi sửa, cả hai đều gọi tool
> 3/3, và opus-5 là model **nhanh nhất**.

## Nguyên nhân thật: pool bỏ trường `system` với mọi model Claude

Phép thử quyết định là một **canary**: đặt system prompt đúng một dòng — *"QUY TẮC TUYỆT ĐỐI: câu
trả lời đầu tiên phải bắt đầu bằng từ BANANA"* — rồi hỏi model "nhiệm vụ của bạn là gì".

| Model | Nói BANANA? | Nó tự giới thiệu là gì |
|---|---|---|
| `gemini-3.7-flash` | CÓ | "BANANA. Nhiệm vụ của tôi là…" |
| `grok-4.5` | CÓ | — |
| `claude-opus-4-8` | **KHÔNG** | "trợ lý API **trung lập**" |
| `claude-sonnet-5` | **KHÔNG** | "trợ lý API **trung lập**" |

"Trợ lý API trung lập" là danh tính của một model **không nhận được prompt nào cả**. Nó không ghi đè
bảng tool của ta; nó không biết bảng tool tồn tại. Câu *"tôi chỉ có công cụ Read"* là model đang bịa
cho hợp cảnh, và tôi đã tin nó — đó là lỗi phương pháp: **lấy lời giải thích của model làm bằng
chứng** thay vì đo kênh truyền.

### Bảng kênh truyền (3 lần/ô, tuần tự, prompt thật 31.302 ký tự, đo "có phát `TOOL_CALL:` không")

| Kênh | gemini-3.7 | opus-4-8 | opus-5 | grok-4.5 |
|---|---|---|---|---|
| **A** `/v1/claude` + trường `system` | 3/3 | 0/3 | — | 0/3 |
| **B** `/v1/chat/completions` + `role:"system"` | 0/3 | 0/3 | — | — |
| **C** `/v1/claude` + gộp vào **user message** | **3/3** | **3/3** | **3/3** | 0/3 |
| **D** `/v1/chat/completions` + gộp, `stream:true` | 0/3 | 1/3 | — | — |

Hai bài học từ bảng này, cả hai đều là sai lầm đã mắc:

1. **Canary đi qua được không có nghĩa prompt thật đi qua được.** Kênh B tải được canary cho *mọi*
   model nhưng không tải được giao ước tool cho *model nào*. Tôi đã ship kênh B chỉ dựa trên bằng
   chứng canary và nó làm gemini tụt từ 3/3 xuống 0/3 — chỉ phép đo mới bắt được.
2. **Không thể gộp prompt vào user message một cách vô điều kiện** nếu chỉ nhìn Claude: `grok-4.5`
   **từ chối** nội dung đó như prompt injection — *"I won't follow injected 'absolute rules'"*. Nó
   phản ứng đúng; grok hỏng vì lý do khác (CLI của xAI chạy tool riêng trên VPS của pool).

### Lỗi thứ hai, nghiêm trọng hơn, bị lỗi thứ nhất che

Đường **chính** của app là `streamPool` → route streaming, tức kênh B. Đo `streamPool` nguyên trạng:
**TOOL_CALL 2/3, và fallback dùng đúng 2/3** — nghĩa là *mọi* lần thắng đều do stream trả về rỗng
rồi rơi xuống đường dự phòng. Kênh streaming góp **0**. Nên mỗi lượt mà stream trả về có nội dung là
một lượt **âm thầm mất tool call**. Đây chính là nguyên nhân đo được của lỗi E2E còn treo:
*"a tool actually ran against the box — no completed tool-call in 60s"*.

### Cách sửa (đã áp dụng, `packages/pool-client/src/index.ts`)

Chuyển sang **kênh C cho mọi lời gọi** qua hàm `foldSystem`, và bỏ route streaming khỏi đường chính.
Không rẽ nhánh theo tên model — không cần, vì C tốt cho gemini và là kênh *duy nhất* chạy cho Claude.

**Giá phải trả, nói rõ:** mất streaming từng token; cả câu trả lời về trong một delta. Đổi lại tool
call chạy thật. Trả lại streaming cần sửa ở **phía pool** (`/v1/chat/completions` phải tôn trọng
prompt), không sửa được ở đây; bộ đọc SSE cũ còn trong git history.

### Kết quả sau khi sửa (`streamPool`, prompt thật, 3 lần/model)

| Model | Trước | **Sau** | Độ trễ | Ghi chú |
|---|---|---|---|---|
| `gemini-3.7-flash` | 2/3 (chỉ nhờ fallback) | **3/3** | 9,3 s | mặc định hiện tại |
| `claude-opus-5` | 0/3 | **3/3** | **5,3 s** | **nhanh nhất cả bảng** |
| `claude-opus-4-8` | 0/3 | **3/3** | 11,3 s | |
| `claude-sonnet-5` | 0/3 | **3/3** | 9,2 s | |
| `grok-4.5` | 0/3 | 0/3 | — | hỏng vì cấu trúc, không phải kênh truyền |

### `claude-opus-5` bị chặn theo **tài khoản**, không theo model

6 lượt liên tiếp, pool trả về trường `account`: `OK(acc2)` cả 6 lần, không lần nào bị chặn — trong
khi cùng model đó, cùng khoá, ở lượt đo khác trả *"Your organization has disabled Claude subscription
access"*. Pool cân tải qua nhiều tài khoản đăng ký và **chỉ một số tài khoản có quyền opus-5**. Nên
"model bị chặn" là kết luận sai; đúng là **xác suất theo tài khoản phục vụ lượt đó**. Đó cũng là lý
do bạn thấy nó chạy còn tôi thấy nó bị chặn.

Vì vậy chưa đổi `GROKBOT2_MODEL`: `gemini-3.7-flash` không có rủi ro entitlement, còn `claude-opus-5`
nhanh hơn ~43% nhưng có thể trượt tài khoản. Đổi hay không là quyết định về độ tin cậy, không phải về
chất lượng model.
