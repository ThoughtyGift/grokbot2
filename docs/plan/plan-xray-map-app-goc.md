# Plan x-ray — sửa app local cho khớp app gốc

> 2026-08-30. App **local đang chạy**: BE grokbot2 `127.0.0.1:8788` + `Grok Bot.exe` (vá, trỏ `CURSOR_API_BASE_URL`).
> App **gốc**: client 0.30.0 (`C:\Program Files\Grok Bot`) nói `api2.cursor.sh`.
> Không trộn ba loại lệch: **sửa được** · **thiếu dữ liệu** · **không map được**.

Nguồn đo đã có, không đo lại cho vui:

- BE ↔ BE: [so-sanh-be-goc-vs-grokbot2.md](./so-sanh-be-goc-vs-grokbot2.md)
- Số 0.30: [con-thieu-so-voi-0-30.md](./con-thieu-so-voi-0-30.md)
- Prompt: [../extracted/prompt-base-mapping-live-vs-grokbot2.md](../extracted/prompt-base-mapping-live-vs-grokbot2.md)
- Chặng sống: [../state/bang-theo-doi.md](../state/bang-theo-doi.md) (một số ⬜ đã xong 28/08)

---

## 0 · X-ray local lúc viết plan

| Mặt | Gốc 0.30 | Local grokbot2 | Lệch |
|---|---|---|---|
| Client | 0.30.0 asar, prompt **server bơm** | 0.20 portable `C:\cai` **và/hoặc** 0.29 đã vá; `SAND_DISABLE_UPDATES=1` | Mixed. `getHostStatus.version` hardcode `0.20.0` |
| Cổng `/gw` | 147 lệnh | 135 trả lời (9 shared-room = refuse) | 12 thiếu; lạ → 200 `{}` |
| Tool | ~56 tên enum + prompt server | ~63 đăng ký | thiếu `deep_search`; thừa tool riêng |
| Subagent | 12 loại, resume được | 5 loại, chạy xong mới trả | `vm_setup_helper` không có |
| Thẻ transcript | 17 loại | phát 8 | thiếu secret-request, user-form (handler đã có), cursor-agent, … |
| SSE | 18 kênh | đẩy 12 | producer trống cố ý |
| Box | pod disposable, ~39 op streaming | VPS/local daemon 12 op HTTP | không recreate; thiếu stdin/nền |
| Prompt | live SendToUser + CloudAgent + Origin | port 81/179 chương 0.20, plain text = chat | DROP only-voice là đúng |
| Não | Cursor | Claude pool | cố ý |
| Cookie Chrome | inject vào box | chưa | 5 bot Shopee chờ login |
| Catalog plugin | chợ Cursor | ~25 local | thiếu **dữ liệu** |

Cờ **không được bật** khi sửa: `sand_roster_via_server`, `sand_send_via_server`, `sand_attachments_via_server`, `sand_transcript_*_server`. Bật là client bỏ `/gw`, emulation chết.

---

## Nguyên tắc sửa

1. Sửa **BE + prompt-base**, không vá renderer trừ khi patch as-code đã có sẵn (`infra/patches`).
2. Mỗi chặng một lệnh **kiểm** nhìn thấy được. Xanh mới sang chặng sau.
3. Không copy prompt live nguyên — sẽ gọi `SendToUser` / `CloudAgent` không tồn tại.
4. Việc “không map được” để cuối, không nhét vào sprint.

Chạy từ `services/grokbot-backend/` trừ khi ghi khác. BE local phải sống `:8788`.

---

## Chặng A · Không làm hỏng local (nửa ngày)

| # | Việc | Kiểm | Đạt khi |
|---|---|---|---|
| A1 | Xác nhận client local đang trỏ 8788, không `cursor.com` | đọc `backend.txt` / env launcher `run.ps1` | `CURSOR_API_BASE_URL` + `CURSOR_WEBSITE_URL` = `http://localhost:8788` |
| A2 | Cờ `*_via_server` tắt | `packages/grokbot-proto/src/feature-gates.ts` + `/gw` coverage sau 1 lượt mở app | `sand_teach_by_demonstration` on; bảy cờ server off |
| A3 | `SAND_DISABLE_UPDATES=1` | env process | không bị 0.30 đè bản vá |
| A4 | Ghi `getHostStatus.version` đúng client đang chạy | gọi `getHostStatus` | không còn `"0.20.0"` nếu đang 0.29 |

**E2E:** `node scripts/contract-test.mjs` · `node scripts/self-xray.mjs`

---

## Chặng B · Prompt map (rẻ, không thêm cổng)

Sửa `scripts/build-prompt.mjs` rồi regenerate `src/prompt-base.ts`. Không dán live.

| # | Việc | Kiểm | Đạt khi |
|---|---|---|---|
| B1 | Thêm chương **Untrusted content** (fence tool result ≠ lệnh) | diff `prompt-base.ts` | có đoạn; không có chữ `SendToUser`/`SendMessage` |
| B2 | Thêm **Time** (timezone user, host_settings) | gửi “mấy giờ” | bot báo ICT, không UTC trần |
| B3 | Siết thang: browser tools trước computerUse | prompt + 1 lượt “mở shopee.vn” | không nhảy computerUse trước |
| B4 | Không KEEP CloudAgent / Origin / Purchases / only-voice / ExternalShell | `rg SendToUser src/prompt-base.ts` = 0 | 0 hit `CloudAgent` `SendToUser` `ListMachines` |
| B5 | Xuất lại `docs/extracted/prompt-base-hien-hanh.md` | file mới hơn plan này | số chương KEEP ghi đúng |

**E2E:** `node scripts/e2e-native.mjs` (chat không gãy) · đọc `prompt-base.ts` header còn “PORT not copy”.

---

## Chặng C · Thẻ đã có ruột, chưa phát

Đây là ① trong `con-thieu-so-voi-0-30.md`.

| # | Việc | Kiểm | Đạt khi |
|---|---|---|---|
| C1 | Phát `secret-request` khi bot cần credential | e2e gửi lượt cần token | transcript có thẻ; `submitSecret` chạy |
| C2 | Phát `user-form` (schema đã có 29/08) | e2e form 2 field | thẻ hiện; submit/dismiss không 404 |
| C3 | Bật `GROKBOT2_STRICT_404=1` lúc dev | gọi lệnh không map | không còn 200 `{}` im |

**E2E:** bài mới trong `scripts/` · không regress `e2e-native` 60/60.

---

## Chặng D · Cookie Chrome → box (đau Shopee)

Chặn: VNC từng slot **đã xong** (7.5/N17). Origin grants **theo người**.

| # | Việc | Kiểm | Đạt khi |
|---|---|---|---|
| D1 | Implement `injectChromeCookies` + grants (`list/put/removeCookieOriginGrants`) | coverage `/gw` | không unmapped; 404 mềm hết |
| D2 | Gate `sand_import_chrome_cookies` chỉ khi D1 xanh | BootstrapStatsig | bật → UI hiện; tắt → ẩn |
| D3 | Bơm cookie vào Chrome **slot của đúng user** | 1 origin Shopee | bot mở seller centre đã login, không “Waiting for you” |
| D4 | Không bơm khi `PER_BOT_DISPLAY`/slot chết | e2e từ chối | không rò cookie sang slot khác |

Không làm nửa IPC `importChromeCookies` (app-main, không phải `/gw`).

---

## Chặng E · Box gần gốc hơn (exec, không recreate pod)

| # | Việc | Kiểm | Đạt khi |
|---|---|---|---|
| E1 | Toolbelt trong ảnh: `ffmpeg` đã có; thêm obs-studio **hoặc** snap/flatpak documented | `which obs` trên box | bot không phải apt |
| E2 | `BackgroundShellSpawn` + `WriteShellStdin` trên daemon | e2e lệnh 5 phút + gõ stdin | không timeout 300s cho live |
| E3 | `vm_setup_helper` = “dùng toolbelt, không sudo” trong prompt | lượt “cài OBS” | bot dùng binary có sẵn / nói không root, không giả thành công |

Không làm: recreate/snapshot box, ConnectRPC 39 op, `apt` root trên multi-tenant.

---

## Chặng F · Cổng lẻ + DX

| # | Việc | Kiểm | Đạt khi |
|---|---|---|---|
| F1 | `getMcpPluginLogo` / `generateAgentAvatarImage` / `getAgentNotificationAvatar` | bấm UI | không chết lặng |
| F2 | `ErrorButton` markdown đã có; envelope RPC nếu bắt được client đọc | màn over-quota | có đường nâng cấp, không bắt buộc ErrorButton hãng |
| F3 | `deep_search` | chỉ khi có nhà cung cấp (pool hoặc API) | tool thật, không stub rỗng |
| F4 | Workflow / skillsCatalog stub | hoặc honest-refuse hoặc nối đĩa skill | UI không “tạo xong biến mất” |

---

## Chặng G · Không làm trong plan này

Ghi để khỏi lọt sprint:

- Shared room relay, CloudAgent/Origin, Stripe virtual card, voice (5 lệnh), marketplace Cursor.com
- Tự cập nhật (chặng 8) khi chưa ký Authenticode
- FE riêng chặng 6 (`apps/grokbot-web` routines)
- `GrokBotUserComputer` đầy đủ / `sand_multi_machine_local_exec`
- Bật `*_via_server`
- Copy prompt live nguyên vào `prompt-base.ts`

---

## Thứ tự chạy (local)

```
A  không gãy local
B  prompt (1–2 phiên)
C  secret-request + user-form     ← rẻ nhất, đóng mẫu “khai không điền”
D  cookie Chrome                  ← đau Shopee
E  toolbelt + stdin               ← đau OBS
F  logo/avatar/404/deep_search    ← nếu còn sức
```

D và E song song được (khác process: BFF vs computer/daemon).

## Cổng ra mỗi chặng

- Unit BE không đỏ hơn mốc `self-xray`
- `contract-test` 48/48 (hoặc số mới nếu thêm lệnh — phải cập nhật extract)
- Một lượt chat thật trên app local (roster + sendPrompt + SSE)
- Cập nhật `bang-theo-doi.md` + file extracted tương ứng **cùng commit**

## Việc đầu tiên (không hỏi lại)

A1–A4 rồi B1–B4. Prompt không đụng Shopee nhưng chặn việc copy live làm hỏng chat. Sau đó C rồi D.
