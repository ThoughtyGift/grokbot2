# Onboarding — ngày đầu làm việc trên grokbot2

[README ở gốc repo](../README.md) trả lời "chạy nó thế nào". File này trả lời câu khác: **sửa được
code và chứng minh mình không làm hỏng gì**. Làm theo từ trên xuống là chạy được, không cần đọc gì
khác trước.

---

## 0. Cần có gì

| | |
|---|---|
| Node ≥ 20 · pnpm 9 | `node -v` · `pnpm -v` |
| Windows | bản patch client và `run.ps1` mới chỉ có đường Windows |
| Khoá pool `hal_…` | không có thì chat không chạy; mọi thứ khác vẫn chạy |
| Google Chrome | các bài đo giao diện dùng nó (`playwright-core` không tự tải browser) |

## 1. Dựng

```bash
pnpm install
echo "hal_xxxxxxxx" > services/grokbot-backend/pool-key.txt   # gitignored
cp .env.example .env                                          # sửa VNC/token nếu cần
pnpm backend                                                  # 4 process: 8788 · 8789 · 8790 · 8791
```

Kiểm sống:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8788/v1/health   # 200
```

Rồi mở giao diện — **hai** cái, và biết mình đang xem cái nào:

```powershell
pnpm dev:app      # app gốc đã patch — UI SẢN XUẤT, mở kèm CDP :9222
pnpm web          # FE dự phòng ở 127.0.0.1:5173
```

> Đừng mở app bằng shortcut Desktop. Shortcut không set `SAND_DISABLE_UPDATES`,
> `CURSOR_API_BASE_URL`, và cờ CDP — thiếu cái đầu thì app tự update và **ghi đè bản patch**.

## 2. Hiểu chỗ nào là chỗ nào trong năm phút

Đọc [architecture.md](architecture.md) — có sơ đồ C4 mức 1–2. Bản tóm:

| Muốn sửa | Sửa ở |
|---|---|
| Một lệnh app gốc gọi (`/gw/api/...`) | `packages/cursor-acl/src/commands.ts` |
| Một RPC bootstrap (protobuf) | `packages/grokbot-proto/src/bootstrap.ts` |
| Một route `/v1` (FE của mình gọi) | `services/grokbot-backend/src/native.ts` + khai schema ở `packages/api-contract` |
| Nghiệp vụ (bot, transcript, tool call) | `services/grokbot-backend/src/{directory,conversation,runtime}/` |
| Giao diện dự phòng | `apps/grokbot-web/src/` |
| Bản patch client | `infra/patches/` — **không bao giờ** sửa tay `resources/app` |

## 3. Vòng làm việc

```bash
pnpm typecheck        # 11 package
pnpm self-xray        # 7 mục: code chết · ranh giới tầng · bundle · hợp đồng · spec · docs · nhật ký
pnpm docs:check       # link chết · file mồ côi · thiếu mục lục
```

Sửa **route `/v1`** thì thêm cả schema và sinh lại spec:

```bash
# 1. khai schema + thêm dòng vào ROUTES trong packages/api-contract/src/v1.ts
pnpm api:gen          # sinh docs/api/grokbot2-v1.yaml
pnpm self-xray        # mục "spec /v1" phải xanh
```

Sửa **giao diện** thì đo, đừng nhìn:

```bash
pnpm ui:diff          # so từng thuộc tính với app gốc (cần app trên CDP :9222)
pnpm ui:shots         # so bằng hình, chồng chênh lệch
```

Trước khi coi là xong:

```bash
pnpm phase:gate       # gate của phase hiện tại
pnpm e2e:history      # xem lượt vừa chạy đã được ghi
```

## 4. Ba luật của dự án này, và vì sao

**Không có số thì không xong.** Dự án từng có bốn lần "đã sửa" mà thật ra chưa: bốn thước đo cùng
báo sai một lúc (`docs/parity.md`). Nên mọi khẳng định phải kèm lệnh chạy lại được. Đó là lý do có
`self-xray`, `ui-diff`, nhật ký e2e.

**Đo code đang chạy, đừng grep code nguồn.** `parity-report` từng báo `0/120` vì nó grep một file đã
bị di chuyển — và một gate đã chạy trên con số đó.

**Không copy asset/CSS/bundle của hãng.** Bundle client là proprietary
([legal.md](legal.md)). Muốn giống thì **đo rồi tự viết**. Avatar dùng
`bloub` (MIT) chính vì vậy.

## 5. Sáu cái bẫy — biết trước thì mất một phút, không biết thì mất một giờ

| Thấy gì | Đọc |
|---|---|
| Roster đổi thành 4 bot lạ | [runbooks/wrong-bots-in-roster.md](runbooks/wrong-bots-in-roster.md) |
| `127.0.0.1:5173` bị từ chối | [runbooks/ipv4-refused.md](runbooks/ipv4-refused.md) |
| App gốc sidebar trống | [runbooks/app-empty-roster.md](runbooks/app-empty-roster.md) |
| Patch như không có tác dụng | [runbooks/patch-half-applied.md](runbooks/patch-half-applied.md) |
| Gate đỏ ở `verify-client-patch` | [runbooks/gate-red-unapplied-patch.md](runbooks/gate-red-unapplied-patch.md) |
| Bot "biến mất" | **đọc SQLite trước khi kết luận** — [runbooks/README.md](runbooks/README.md) §Luật vàng |

## 6. Việc đầu tiên nên nhận

Chọn một mục trong [plan/fe-xray-roadmap.md](history/fe-xray-roadmap.archived.md) nhóm **X1** — chúng là nguyên
tử: chỉ sửa FE, không cần route mới, và có tiêu chí nghiệm thu bằng số sẵn. Vòng làm:

1. `pnpm ui:diff` → ghi con số **trước**.
2. Sửa.
3. Thêm anchor cho vùng vừa dựng vào `services/grokbot-backend/scripts/ui-anchors.mjs` — **bắt buộc**:
   không thêm thì vùng đó nằm ngoài mẫu số và con số % thành nói dối.
4. `pnpm ui:diff` → ghi con số **sau**. `pnpm self-xray`.

## 7. Một điều về ngôn ngữ

Docs và comment trong repo đang là **tiếng Việt**. Đây là lựa chọn chưa được chốt thành ADR — nếu
bạn là người mới và thấy đó là rào chắn, hãy nói: nó nằm trong
[plan/system-pipeline.md](plan/system-pipeline.md) §4 như một quyết định đang treo, và **không chọn
thì mặc định thành giữ nguyên do quán tính**.
