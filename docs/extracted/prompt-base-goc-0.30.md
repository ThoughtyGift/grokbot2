# System prompt bản gốc **0.30.0** — không trích được văn xuôi

> Đo 2026-08-30 trên asar đang cài:
> `C:\Program Files\Grok Bot\resources\app.asar`
> `package.json`: `"name":"sand"`, `"version":"0.30.0"`, `"productName":"Grok Bot"`.
> mtime asar: 2026-08-28 22:46 ICT. Đây là client gốc mới nhất trên máy này (lớn hơn bản Desktop 29.7 MB).

So với [`prompt-base-goc-0.20.md`](./prompt-base-goc-0.20.md) (trích đủ) và [`prompt-base-hien-hanh.md`](./prompt-base-hien-hanh.md) (port grokbot2).

## Kết luận

**Không có file văn xuôi** `"You are Grok Bot, a warm, concise desktop assistant."` trong client 0.30.

`dist/host/host-main.cjs` — chỗ 0.20 chứa `buildSandBaseSystemPrompt` — **không còn trong asar** (0 file tên `host*`).

Grep các bundle lớn nhất (electron-main 7.2 MB, renderer 4.3 MB, local-exec-daemon 3.5 MB, coordinator 0.5 MB):

| Chuỗi | 0.20 host | 0.30 asar |
|---|---|---|
| `You are Grok Bot` | có | **0** |
| `warm, concise desktop assistant` | có | **0** |
| `buildSandBaseSystemPrompt` | có | **0** |
| `SendMessage is your only voice` | có | **0** |
| `How a turn works` | có | **0** |
| `system_prompt` / `SystemPromptSpec` | — | có (tên field proto) |
| `sand_grok_bot_slim_system_prompt` | — | có (feature gate) |

Prompt sống do **server hãng bơm** mỗi request (`system_prompt` / `system_prompt_spec` replace|append, `custom_system_prompt`). Client chỉ mang hợp đồng. Xem [`0-30-hop-dong-luot-noi-va-prompt.md`](./0-30-hop-dong-luot-noi-va-prompt.md).

Muốn văn xuôi 0.30 thật: phải bắt payload lúc app gốc (chưa trỏ về grokbot2) gửi chat lên `api2.cursor.sh` — không lấy từ đĩa.

## Hợp đồng còn đọc được (không phải prompt)

```
agent.v1.SystemPromptSpec
  oneof spec {
    1  replace  string
    2  append   string
  }

RequestContextRulesPart
  53   system_prompt_override   SystemPromptSpec
  29   system_prompt_spec       SystemPromptSpec
  121  system_prompt_spec       SystemPromptSpec
   8   custom_system_prompt     string

feature gate: sand_grok_bot_slim_system_prompt
```

Đó là *ô chứa*, không phải lời dạy model.
