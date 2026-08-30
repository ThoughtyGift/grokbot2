# scripts/ — 129 script, nhóm theo việc

Thư mục này **phẳng có chủ ý**, và mục lục này là lý do: 22 script tự tính đường dẫn repo bằng độ
sâu tương đối (`resolve(HERE, "..", "..", "..")`). Chuyển chúng sâu thêm một cấp thì `REPO` trỏ sai
mà **không báo lỗi** — file bị ghi vào `services/grokbot-backend/docs/…` thay vì `docs/…`. Đổi lấy
một cấp thư mục không đáng cái rủi ro đó. Muốn chuyển thật thì phải bỏ phép tính theo độ sâu trước
(một helper `repo-root.mjs` đi ngược lên tới khi thấy `pnpm-workspace.yaml`), rồi mới di chuyển.

## Chạy bằng `pnpm` (đã đăng ký ở `package.json` gốc)

| Lệnh | Làm gì |
|---|---|
| `pnpm self-xray` | **9 mục** soi hệ thống của mình: code chết · kích thước code · ranh giới tầng · bundle · hợp đồng client · spec `/v1` · docs · nhật ký · không lặp lại |
| `pnpm code:size` | file > 800 dòng · hàm > 50 dòng (đầu vào cho ngưỡng refactor) |
| `pnpm docs:check [--mermaid]` | link chết · file mồ côi · thiếu mục lục · sơ đồ có parse được |
| `pnpm api:gen` | sinh `docs/api/grokbot2-v1.yaml` từ `packages/api-contract` |
| `pnpm phase:gate` / `phase:advance` | gate của phase hiện tại · dời con trỏ |
| `pnpm soak` / `soak:status` | ghi một ngày dùng thật (F7) |
| `pnpm ui:diff` / `ui:shots` / `ui:xray` | so giao diện với app gốc: bằng số · bằng hình · bóc tách tương tác |
| `npx tsx scripts/do-auto-review.mts [--surface subagent]` | lớp tự soát có chặn đúng 3 ca app gốc chặn không — báo riêng lượt **không đo được** (hết hạn mức pool) thay vì tính thành "cho qua" |
| `pnpm test:avatar` / `test:avatar-ui` / `test:reaction` | ba bộ e2e có ghi nhật ký |
| `pnpm e2e:history` | đọc nhật ký các lượt e2e |

## Nhóm theo tiền tố

| Tiền tố | Số | Là gì |
|---|---|---|
| `e2e-*` | 55 | bài end-to-end. Bốn cái ghi nhật ký (`e2e-avatar`, `e2e-avatar-ui`, `e2e-reaction`, `e2e-native`); còn lại chỉ in ra stdout — gate ghi hộ chúng |
| `test-*` | 10 | thử nghiệm nhỏ, chạy tay |
| `verify-*` | 6 | kiểm một hệ con còn sống (`runtime`, `computer`, `ops`, `sqlite`, `native`, `client-patch`) |
| `measure-*`, `parity-*`, `extract-*` | 11 | đo và trích số từ app gốc → `docs/extracted/`, `docs/parity-runs/` |
| `ui-*`, `x-ray`, `code-size` | 5 | thước đo giao diện và kích thước code |
| `dump-*`, `capture-*`, `grep-*`, `diff-*`, `open-*`, `replay-*` | 15 | công cụ dịch ngược, chạy tay |
| còn lại | ~27 | helper (`gw-auth`, `kill-port`, `run-history`, `ui-anchors`, `tool-registry`), `dev-bff`, `soak-day`, `gen-openapi`, `docs-check`, `self-xray`, `phase-gate` |

## Helper — import được, không phải script

| File | Cho gì |
|---|---|
| `gw-auth.mjs` | header bearer cho `/gw` (34 bài dùng) |
| `kill-port.mjs` | dọn theo **cổng**, không theo pid — pid bị tái sử dụng và đã có lần hạ mất BFF |
| `run-history.mjs` | `recordRun` / `recordScript` → `docs/parity-runs/e2e-history.jsonl`, kèm lớp xoá bí mật |
| `ui-anchors.mjs` | bảng anchor dùng chung cho `ui-diff` và `ui-shots` |
| `tool-registry.mts` | nguồn duy nhất cho danh sách tool |

`ui-anchors.mjs` tồn tại vì một lỗi thật: `ui-shots` từng `import` thẳng `ui-diff.mjs`, và vì file
đó **làm việc ở top-level** nên chỉ riêng việc import đã chạy lại cả bài đo. Script làm việc ở
top-level thì đừng import; tách phần dữ liệu ra file riêng.

## `_tmp-*` — đừng commit

155 file `_tmp-*` (170 KB) từng bị commit, trong đó **126 file `.txt` là trích đoạn bundle minify
của hãng** — vi phạm `docs/legal.md` và ROADMAP R5. Đã bỏ khỏi git và thêm luật vào `.gitignore`;
đã xoá nốt khỏi đĩa ngày 31/08/2026 — dựng lại được bằng `extract-*.mjs` từ `app.asar` nếu cần tra.
Đặt tên `_tmp-` cho mọi file dò dùng một lần thì `.gitignore` lo phần
còn lại.
