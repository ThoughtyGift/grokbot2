# Migration baseline — Phase 0

**Ngày:** 2026-08-19  
**Backend:** `http://127.0.0.1:8788` (process sẵn, `/health` ok, `isBusy` true lúc đo)  
**App version hợp đồng:** 0.20.0  
**Git HEAD lúc Gate A:** `2cb55e9` (trường `backendCommit` trong JSON Cửa A)

Đây là mốc **trước** Strangler Phase 1. Không đổi code nghiệp vụ trong lần ghi này.

---

## 1. Lệnh kiểm thử (chạy đúng thứ tự)

Cwd mặc định: repo `grokbot2`. Backend phải lắng nghe `:8788` trừ khi ghi chú.

### 1.1 Không cần Electron

```powershell
# A. Độ phủ lệnh gateway vs docs/extracted (số 111/120; cột tool của script này LỖI — dùng B)
node services/grokbot-backend/scripts/parity-report.mjs

# B. Tool map LIVE vs catalog 54 (cần tsx; import chat.ts)
npx tsx services/grokbot-backend/scripts/tool-coverage.mjs

# C. Extractor vs JSON đã commit. Đường asar CÀI ĐẶT trên máy này KHÔNG tồn tại.
# Dùng bản gitignore trong repo:
node services/grokbot-backend/scripts/extract-contract.mjs --check --asar "Grok Bot/resources/app.asar"

# D. Cửa A đầy đủ (cần backend :8788 + GROKBOT2_AUTH=enforce ⇒ file .data/gateway-token.txt)
node services/grokbot-backend/scripts/contract-test.mjs --plan strangler-baseline --run 1
```

### 1.2 Regression plan P0–P3 (cần backend; P1 vỡ nếu không có asar mặc định)

```powershell
# P1 Gate A gọi extract-contract KHÔNG --asar → fail trên install unpacked.
node services/grokbot-backend/scripts/e2e-run.mjs --regression --no-goc
```

Sửa tạm **không đổi source:** copy/symlink asar tới  
`%LOCALAPPDATA%\Programs\Grok Bot\resources\app.asar`  
hoặc vá sau (Phase 1+) `e2e-run` truyền `--asar`.

### 1.3 Cần Grok Bot.exe + CDP (không chạy xong trong phiên Phase 0 này)

```powershell
# Local UI
# CDP 9222 = app local (run.ps1). CDP 9333 = app gốc profile .data/profile-real

node services/grokbot-backend/scripts/e2e-run.mjs --regression
# Gate C (parity-gate) cần :9333; thiếu thì dùng --no-goc và ghi skipped-with-reason.

node services/grokbot-backend/scripts/e2e-ordered-sequence.mjs
node services/grokbot-backend/scripts/e2e-standing-permission.mjs
node services/grokbot-backend/scripts/e2e-box-push.mjs
```

`pnpm --filter @grokbot2/backend test` = unit `src/**/*.test.ts` (không phải Cửa A/B/C).

---

## 2. Kết quả đã chạy (phiên này)

| Lệnh | Kết quả | Ghi chú |
|---|---|---|
| `parity-report.mjs` | **Chạy được** | Gateway **111/120**. 9 rooms skip. Tool **9/54** trong script này **lỗi đo** (hardcode list cũ). **Đã sửa F0:** số đúng là [`fe-goc-baseline.json`](../parity-runs/fe-goc-baseline.json) — tools **28/54**, cộng SSE + bootstrap. |
| `tsx .../tool-coverage.mjs` | **Chạy được** | **HAVE 28 / MISSING 26 / extra 31**. Dùng số này, không dùng parity-report tool. |
| `extract-contract --check --asar "Grok Bot/resources/app.asar"` | **PASS** `contract unchanged` | 9 routes, 16 channels, 120 commands |
| `extract-contract --check` (default install path) | **FAIL** | Không có `...\Programs\Grok Bot\resources\app.asar` (app unpacked) |
| `contract-test.mjs --plan strangler-baseline` | **FAIL channels 7/9** | routes 16/16, auth 6/6, commands 10/10. Artifact: `docs/parity-runs/strangler-baseline-gateA-run-01.json` |
| `e2e-run.mjs --regression --no-goc` | **FAIL P1 Gate A** | P0 A PASS. Dừng ở extract default asar. P2/P3 **không chạy**. |
| Gate C / e2e CDP | **Không chạy trong bước ghi file** | CDP 9222 và 9333 **đang lên** lúc probe, nhưng regression đã dừng trước P2 C |

### Mismatch Cửa A (loại 1 — protocol)

`gateway.ts` `broadcast("agents-automation", ...)` — coordinator **không** có kênh đó; wire name là `automations`. Cùng class lỗi `roster`. **Không sửa ở Phase 0.**

---

## 3. Số liệu freeze

| Metric | Giá trị baseline |
|---|---|
| Gateway implemented / catalog | 111 / 120 |
| Intentionally skipped rooms | 9 |
| Tools HAVE (live map) | 28 / 54 |
| Tools IDE-heritage hoặc không dùng desktop | ~14 trong 26 missing |
| SSE broadcast đúng tên | `transcript`, `agents`, `agent-upserted`, `forever-box` |
| SSE broadcast sai tên | `agents-automation` |
| SSE catalog chưa push | 11 kênh còn lại |
| Runtime đọc asar | **0** file `src/` |
| `@grokbot2/proto` trên đường nóng | chỉ `index.ts` bootstrap |
| `GROKBOT2_STRICT_404` | **1** (đã bật trong `.env`) |
| `GROKBOT2_AUTH` | **enforce** |
| Docker | không có |
| Unknown `/gw` trong `coverage.json` | chủ yếu probe `definitely-not-a-real-route-*` trả **404** (strict đã bật). `GET /` một lần 404. Không thấy URL production mới ngoài probe. |

`parity-report` “live transcript updates late” là mô tả cũ; ordered sequence đã có e2e riêng — không re-verify Phase 0.

---

## 4. Pool / hạ tầng (không phải project gốc)

`CLAUDE_POOL_URL` / `admin.halcion.vn` = não. Giữ. Không liệt kê là coupling Grok Bot.

---

## 5. JSON máy đọc

- Cửa A: `docs/parity-runs/strangler-baseline-gateA-run-01.json` (`pass: false`)
- Tóm tắt Phase 0: `docs/parity-runs/strangler-baseline.json`

---

## 6. Phase 0 chưa đóng vì

1. `e2e-run --regression` không xanh (asar mặc định).  
2. Cửa A channels đỏ (`agents-automation`).  
3. README vẫn mô tả “point stock app” là sản phẩm, chưa gắn “FE gốc = adapter tạm” (wall nằm ở `architecture-decisions.md`).  
4. Regression Gate B/C chưa chạy hết trong phiên này.
