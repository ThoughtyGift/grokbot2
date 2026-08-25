# Spike findings

How the self-host was validated, milestone by milestone.

## 1. The redirect seam works
Setting `CURSOR_API_BASE_URL=http://localhost:PORT` routes every backend call to localhost.
No TLS pinning, no cert check, no response signing. `x-cursor-checksum` is outbound-only.

**Gotcha:** if `ELECTRON_RUN_AS_NODE=1` is set in the environment, the Electron exe runs as
plain Node (no GUI) and exits immediately. Unset it before launching.

## 2. Auth is stubbable
First call is `POST /oauth/token` with a stored refresh token. Returning a self-minted JWT is
accepted — the client decodes the payload (exp/email/sub) but does **not** verify the signature.

## 3. Bootstrap gates → UI enters
~15 ConnectRPC calls gate rendering. Returning valid protobuf (esp. `GetSandAccessStatus=GRANTED`,
`GetMe`, `EnsureSandBox`) moves the app past auth/paywall. The React renderer loads (a 1440×759
BrowserWindow is created) but stays **hidden** pending a healthy box.

## 4. Box gateway → window shows
The app connects to `gateway_url` and polls `/gw/api/*` + `/gw/health` + `/gw/events` (SSE).
Returning healthy JSON shapes (`getHostStatus.isBusy=false`, `listAgents:[]`, SSE kept open)
makes the app show its **main workspace UI** — verified with a screenshot: sidebar, composer
("Ask anything…"), account chip, all rendered against localhost.

## 5. Chat → Claude pool
Typing calls `sendPrompt` (not `StreamChat` directly — the agent loop lives in the box). The
gateway plays the box's agent-host role: append the user turn, call the Claude pool, append the
assistant turn; the frontend reads it back via `getAgentTranscriptTail`. Validated end-to-end at
the HTTP layer (`createAgent → sendPrompt → transcript`).

## What's NOT done
- The **VNC/exec box** — a real Linux desktop for the workspace pane. Chat doesn't need it.
- Rich transcript features (tool calls, streaming deltas, widgets) — only plain text so far.

## Reuse from OpenClaw (admin.halcion.vn)
- **Brain:** the Claude pool endpoint — subscription CLI, LB+failover, no API-token cost.
- **Box (future):** the VPS already runs `Xvfb + x11vnc + websockify + noVNC` per-account
  (`flow-chrome@`, `flow-vnc.sh`) — the same stack the Grok Bot box needs. See [roadmap.md](../../ROADMAP.md).

---

## Bản gốc đã đi tới 0.24.0 — bộ vá của mình chỉ chạy trên 0.20.0 (đo 26/08/2026)

Tải bản gốc từ chính trang `x.ai/bot` và bung ra so, **không chạy nó** (chạy sẽ thay bản 0.20.0 đã vá
trên máy):

```
https://downloads.cursor.com/grokbot/stable/win32-x64/0.24.0/Grok_Bot_0.24.0_Setup.exe
```

| | 0.24.0 (vừa tải) | 0.20.0 (máy đang chạy) |
|---|---|---|
| Bộ cài | **118,3 MB**, NSIS (electron-builder) | 120,0 MB |
| Payload | `$PLUGINSDIR/app-64.7z` → **656 file · 447 MB** | 1.385 file · 540 MB (đã bung + đã vá) |
| `resources/` | `app.asar` **49 MB** + `app.asar.unpacked` | `app/` (đã vá) + `app.asar.disabled-by-grokbot2` |

**Cấu trúc khớp hoàn toàn** — cùng bố cục Electron, cùng `resources/`, `locales/`, cùng bộ `.dll`.
Cây mình đóng gói giống cây họ phát.

### Cái KHÔNG khớp: cả ba bản vá đều trượt

Kiểm từng bản vá bằng chuỗi `find` của chính nó, trên bundle 0.24.0 vừa bung:

| bản vá | kết quả trên 0.24.0 |
|---|---|
| `win-drive-path` | ✗ **0 chỗ khớp** (cần 1) |
| `attach-upload-observable` | ✗ **0 chỗ khớp** (cần 1) |
| `get-ultra-redirect` | ✗ **file đích không còn**: `dist/renderer/assets/index-DNC736IO.js` |

Vì sao — đo được, không đoán:

- **Tên rút gọn đã đổi nghĩa.** Trong 0.20.0, `cOt` là hàm xử lý đường dẫn ảnh. Trong 0.24.0, `cOt`
  là `function cOt(r){return typeof r=="number"&&Number.isFinite(r)?r:void 0}` — **một hàm hoàn toàn
  khác**. Hàm xử lý đường dẫn nay mang tên khác (dấu vết dẫn tới `nde`, chưa xác minh).
- **Bundle renderer đổi tên theo hash mỗi lần build** — `index-DNC736IO.js` không tồn tại ở 0.24.0.
  Đây là hành vi bình thường của Vite, không phải họ cố tình.

**Đây chính là cơ chế an toàn đã thiết kế đang làm đúng việc:** `expected: 1` khiến bản vá **trượt và
báo đỏ** thay vì vá nhầm vào chỗ trông giống. Không có nó thì bộ vá sẽ ghi bừa vào bundle 0.24.0.

### Nghĩa là gì cho dự án

1. **Bộ cài 118 MB mình phát đang chở 0.20.0** — bản đã vá, chạy được, nhưng **chậm hơn bản gốc 4
   phiên bản**.
2. **Nâng lên 0.24.0 = dò lại cả 3 bản vá từ đầu**, vì tên rút gọn đã trôi. Đó là chi phí đã biết
   trước của Đường A (vá client của hãng) — xem [ship-to-users.md](../plan/ship-to-users.md), và là
   lý do Đường B (FE riêng) tồn tại.
3. **Đừng chạy bộ cài 0.24.0 trên máy này**: nó sẽ thay bản 0.20.0 đã vá, và bộ vá chưa dò lại được.

