# Architecture

Sơ đồ theo **C4** (Simon Brown), chỉ mức 1 và 2 — mức 3 khi cần, mức 4 bỏ. Viết bằng Mermaid ngay
trong file này chứ không dùng công cụ vẽ ngoài: sơ đồ rẻ để dựng lại thì mới không mục. Quyết định
*vì sao* nằm ở [adr/](adr/README.md).

> Đường đi của một NGƯỜI DÙNG — vào bằng cửa nào, cài ra sao, tiền tính thế nào, dữ liệu ở đâu —
> nằm ở [plan/ship-to-users.md](plan/ship-to-users.md). Tài liệu này là cấu trúc hệ thống; tài liệu
> kia là hành trình người dùng và kế hoạch A→Z.

## C4 mức 1 — System Context

Ai dùng hệ thống, và hệ thống dựa vào cái gì bên ngoài.

```mermaid
graph TB
    user["👤 Chủ máy<br/>một người, máy của mình"]
    app["Grok Bot.exe (đã patch)<br/>Electron sand v0.20.0<br/>UI sản xuất"]
    web["apps/grokbot-web<br/>FE dự phòng + đang clone"]
    gb2["grokbot2<br/>backend tự chủ"]
    pool["admin.halcion.vn/v1/claude<br/>Claude pool — subscription CLI"]
    box["Box Linux<br/>Xvfb + x11vnc + exec daemon"]

    user --> app
    user --> web
    app -->|"CURSOR_API_BASE_URL<br/>protobuf + /gw"| gb2
    web -->|"/v1 (hợp đồng riêng)"| gb2
    gb2 -->|"HTTP, có failover"| pool
    gb2 -->|"exec · VNC · handoff"| box
```

Hai điều đọc ra được ngay từ sơ đồ này, và cả hai đều là quyết định chứ không phải tình cờ:
**hai FE nói hai hợp đồng khác nhau** (app hãng nói protobuf + `/gw`, FE của mình nói `/v1`), và
**pool là phụ thuộc ngoài duy nhất** — hỏng nó thì chat chết, mọi thứ khác vẫn sống.

## C4 mức 2 — Container

Bốn process, một FE, một file dữ liệu. Cổng là phần quan trọng: mỗi process một cổng, không dùng chung.

```mermaid
graph TB
    subgraph client["Máy của chủ máy"]
        app["Grok Bot.exe<br/>CDP :9222"]
        web["Vite dev :5173"]
    end

    subgraph gb2["grokbot2"]
        bff["BFF :8788<br/>services/grokbot-backend<br/>auth · bootstrap · /gw · /v1"]
        rt["runtime :8789<br/>lượt chat, tool call, subagent"]
        comp["computer :8790<br/>box, VNC, handoff"]
        ops[":8791<br/>cron, webhook, automation"]
        db[("SQLite<br/>.data/grokbot.sqlite")]
    end

    acl["packages/cursor-acl<br/>120 lệnh /gw ↔ domain"]
    proto["packages/grokbot-proto<br/>10 RPC bootstrap"]
    pool["Claude pool"]

    app -->|protobuf| proto
    app -->|"/gw/api"| acl
    web -->|"/v1"| bff
    proto --> bff
    acl --> bff
    bff --> rt
    bff --> comp
    bff --> ops
    bff --> db
    rt --> pool
    comp -->|"exec · VNC"| box2["Box Linux"]
```

`cursor-acl` và `grokbot-proto` là **lõi vĩnh viễn**, không phải adapter tạm — đảo hướng
2026-08-20 làm chúng thành đường sản xuất duy nhất của app hãng. Mọi comment nào nói "Phase 8 xoá
ACL" đều đã hết hiệu lực (`ROADMAP.md` §0.2).

Vì sao **tách bốn process** mà không một khối: gate của phase P4–P6 đòi chứng minh từng phần chết
riêng được — `e2e-runtime-down`, `e2e-computer-down`, `e2e-ops-down` là ba bài kiểm đúng điều đó.
BFF chết thì mất hết; ba cái kia chết thì chỉ mất phần của nó.

## Ba luồng quan trọng (C4 dynamic)

Ba luồng này chọn vì chúng là ba chỗ đã từng hỏng và khó chẩn đoán. Tên trong sơ đồ là tên **thật**
trong code, không phải nhãn cho đẹp — tra được bằng `grep`.

### 1. Gửi một tin

```mermaid
sequenceDiagram
    autonumber
    participant App as Grok Bot.exe
    participant BFF as BFF :8788
    participant RT as runtime :8789
    participant Pool as Claude pool
    participant DB as SQLite

    App->>BFF: POST /gw/api/sendPrompt
    BFF->>DB: ghi entry của người dùng (gán seq)
    BFF-->>App: SSE /gw/events — transcript.append
    BFF->>RT: POST /internal/turns
    RT->>Pool: streamPool()
    loop từng đoạn
        Pool-->>RT: token
        RT-->>BFF: NDJSON delta
        BFF-->>App: SSE — entry đang stream
    end
    Pool-->>RT: hết
    RT-->>BFF: NDJSON done
    BFF->>DB: chốt entry của bot
    BFF-->>App: SSE — transcript.append
```

Hai điều đọc ra được, và cả hai là quyết định:

- **`seq` không bao giờ sinh ở `runtime`.** BFF giữ thứ tự transcript (`docs/parity.md` §2ac). Nếu
  runtime tự đánh số thì client — vốn giữ một bản sao có thứ tự — sẽ thấy hai nguồn số va nhau.
- **`runtime` là process duy nhất nói với pool.** Nên "pool chết" chỉ làm chết một process, và
  `e2e-runtime-down.mjs` kiểm đúng điều đó.

### 2. Tool call cần xin phép

```mermaid
sequenceDiagram
    autonumber
    participant User as Chủ máy
    participant UI as App / FE
    participant BFF as BFF :8788
    participant RT as runtime :8789
    participant VM as Box Linux

    RT-->>BFF: văn bản có chứa TOOL_CALL:
    BFF->>BFF: parseToolCalls()
    BFF->>BFF: entry tool-call, needsApproval = true
    BFF-->>UI: SSE — transcript.append
    UI-->>User: hiện Allow / Deny
    User->>UI: bấm Allow
    UI->>BFF: POST /v1/agents/{id}/permissions
    BFF->>VM: chạy tool
    VM-->>BFF: kết quả
    BFF->>RT: POST /internal/turns (kèm kết quả tool)
    RT-->>BFF: câu trả lời bằng văn xuôi
    BFF-->>UI: SSE — transcript.append
```

`needsApproval` do bảng tool quyết định (`src/tools.ts`), không do model. Model chỉ *đề nghị*;
quyền là của chủ máy.

Chỗ này từng hỏng đúng một kiểu: khi người dùng bấm dừng giữa lượt, `TOOL_CALL:` **thô** lọt vào
transcript và hiện ra như văn bản. Gate có một bước riêng cho nó — *"the turn ends with a prose
answer, not raw TOOL_CALL"*.

### 3. Bàn giao màn hình (handoff)

```mermaid
sequenceDiagram
    autonumber
    participant A as Bot A
    participant BFF as BFF :8788
    participant CP as computer :8790
    participant B as Bot B

    A->>BFF: xin dùng màn hình
    BFF->>CP: POST /internal/begin
    CP-->>BFF: vncUrl + state running
    BFF-->>A: SSE — computer.status
    A->>BFF: bàn giao cho B
    BFF->>CP: POST /internal/handoff/start
    CP-->>BFF: handoff data
    BFF-->>B: SSE — computer.status
    B->>BFF: xong, trả lại
    BFF->>CP: POST /internal/handoff/back
    BFF->>CP: POST /internal/release
```

Phân vai cố ý: **`computer` giữ *dữ liệu* handoff và biết ai đang chiếm màn hình; BFF giữ *Promise*
và bộ đếm nhả màn hình.** Ghi rõ ở đầu `services/grokbot-computer/src/index.ts`. Trộn hai thứ vào
một chỗ thì lúc process kia chết sẽ treo vô hạn — `e2e-computer-down.mjs` là bài kiểm cho điều đó.

## Triển khai — process nào nghe cổng nào, ai ghi dữ liệu

```mermaid
graph LR
    subgraph win["Máy Windows của chủ máy"]
        app["Grok Bot.exe<br/>CDP :9222"]
        vite["Vite :5173<br/>bind 127.0.0.1"]
        subgraph node["pnpm backend — 4 process node"]
            bff["BFF :8788<br/>DUY NHẤT ghi SQLite"]
            rt["runtime :8789<br/>DUY NHẤT gọi pool"]
            cp["computer :8790"]
            ops["ops :8791"]
        end
        db[("SQLite<br/>services/grokbot-backend/.data/grokbot.sqlite")]
        patched["resources/app<br/>bản patch, app.asar dời sang một bên"]
    end
    pool["admin.halcion.vn"]
    box["Box Linux — Xvfb · x11vnc · exec daemon"]

    app --> bff
    vite --> bff
    bff --> rt
    bff --> cp
    bff --> ops
    bff --> db
    rt --> pool
    cp --> box
    app -.- patched
```

Bốn điều bất biến đáng nhớ, vì mỗi cái đã từng là một sự cố:

| Bất biến | Sai thì sao | Runbook |
|---|---|---|
| **Chỉ BFF ghi SQLite** | hai process ghi cùng lúc thì `seq` va nhau | — |
| Mỗi process **một cổng riêng**, 8788–8791 | tiến trình rò rỉ chiếm cổng và chạy dữ liệu fixture | [runbooks/wrong-bots-in-roster.md](runbooks/wrong-bots-in-roster.md) |
| Vite bind **`127.0.0.1`**, không phải `localhost` | trên Windows `localhost` ra `::1` trước, `127.0.0.1` bị từ chối | [runbooks/ipv4-refused.md](runbooks/ipv4-refused.md) |
| App boot từ **`resources/app`**, `app.asar` phải dời sang một bên | `app.asar` thắng thứ tự nạp → boot bản hãng, patch vô tác dụng | [runbooks/patch-half-applied.md](runbooks/patch-half-applied.md) |

## The seam

The Grok Bot desktop app (Electron) resolves its backend base URL from:

```js
new URL(process.env.SAND_BACKEND_URL ?? process.env.CURSOR_API_BASE_URL ?? "https://api2.cursor.sh")
```

Setting `CURSOR_API_BASE_URL=http://localhost:8788` routes **all** backend traffic to this
backend. There is no TLS pinning or response signing that blocks a localhost server;
`x-cursor-checksum` is an outbound-only header the server can ignore.

## Request flow

```
Grok Bot desktop (Electron, unchanged)
   │  CURSOR_API_BASE_URL → http://localhost:8788
   ▼
grokbot-backend
   ├─ /oauth/token, /auth/*          → mint JWT (auth.ts)
   ├─ /aiserver.v1.*/<method>        → protobuf gate responses (@grokbot2/proto)
   ├─ /gw/health, /gw/events (SSE)   → box "healthy" so the window shows (gateway.ts)
   ├─ /gw/api/<method>               → JSON host/agent methods (gateway.ts)
   │     └─ sendPrompt               → chat.ts → @grokbot2/pool-client
   ▼
admin.halcion.vn/v1/claude  (your Claude pool: subscription CLI, LB + failover)
```

## Why the app is a thin client

The desktop app is architected as a viewer onto a cloud **box** (a Linux sandbox pod):
`EnsureSandBox` returns `cluster / pod_id / vnc_url / gateway_url / exec_daemon_url`. The
workspace pane is a VNC stream of that Linux desktop (`Xvfb + x11vnc + websockify + xfwm4`).

For **chat**, we stub the box: `EnsureSandBox` points the gateway at this backend, and the
gateway serves healthy JSON so the window renders. Chat is implemented directly in the
gateway (the box's agent host role), backed by the Claude pool.

For a **working workspace/VNC**, run a real box — see [roadmap.md](../ROADMAP.md).

## Layers in this repo

- **auth.ts** — JWT minting + `/oauth/token`. The client decodes but never verifies the sig.
- **@grokbot2/proto** — a tiny protobuf wire encoder + the bootstrap gate responses (field
  numbers/enums extracted from the client bundle; see [protocol-reference.md](protocol-reference.md)).
- **gateway.ts** — the `/gw/*` box-host API as JSON + an SSE event channel.
- **chat.ts** — an in-memory transcript store; `sendPrompt` calls the pool and appends the reply.
- **@grokbot2/pool-client** — the HTTP client for the OpenClaw Claude pool.
