# Lên bản client mới — quy trình chuẩn cho app local

> Viết 03/09/2026, sau khi đã đi trọn một lần (0.20 → 0.29) và moi xong cơ chế Install/Update của
> app gốc 0.30. Mọi bước đều có lệnh kiểm — không bước nào "chắc là xong".

## 0 · App GỐC cập nhật thế nào (đã moi, để đối chiếu)

```
kiểm định kỳ (SandUpdateService.start → initial + periodic)
  GET {feed}/api/update/{platform}/{sand|sand-nightly|sand-dogfood}/{ver}/{machineId}/stable
  → 204 = không có gì · JSON {url, version, sha256hash?} = có bản mới
banner "New update available" (i18n OaoXkB, state `available`)
  → bấm Install = downloadAndStage: tải %TEMP%\sand-update-*\sand-update-<ver>.exe, KIỂM sha256
  → state `ready` → "Restart to apply" (menu `resolveUpdateItem` → quitAndInstall)
  → lúc thoát: forceRunOnQuit chạy NSIS detached → cài đè → mở lại là bản mới
```

**Trên app local banner này KHÔNG BAO GIỜ hiện, và đó là chủ ý:** `sandLab: true` trong
`resources/app/package.json` làm updater bất động ở mọi đường mở (state `disabled` → mục update ẩn).
Một lần app tự cập nhật là `resources/app` bị xoá sạch — mất cả bộ vá, app quay về nói chuyện với
server hãng trong im lặng. Nên cập nhật app local là **một việc chủ động theo quy trình dưới**, không
phải một cái nút.

## 1 · Lấy bộ cài chính chủ

Nguồn rẻ nhất: app GỐC tự tải sẵn về `%TEMP%\sand-update-*\sand-update-<ver>.exe` (115 MB). Không
có thì hỏi thẳng feed bằng URL ở mục 0. **Bắt buộc kiểm chữ ký trước khi chạy:**

```powershell
Get-AuthenticodeSignature "$env:TEMP\sand-update-XXXX\sand-update-<ver>.exe"
# phải là: Valid · CN="Anysphere, Inc."
```

Đã dùng thật 03/09: chính file này cứu app gốc (cài đè sửa được bản cài hỏng mà sáu giả thuyết
không tìm ra bệnh).

## 2 · Dọn bản vá cũ RỒI mới cài đè

```powershell
# đóng app local (lọc theo ĐƯỜNG DẪN — máy này có hai bản cài)
Get-Process "Grok Bot" | Where-Object { $_.Path -like "C:\cai029\*" } | Stop-Process

# trả bản cài về nguyên bản của hãng: xoá resources/app, phục hồi app.asar
GROKBOT2_CLIENT_DIR=C:/cai029 node infra/scripts/patch-client.mjs --undo
```

Vì sao PHẢI undo trước: cài đè khi `resources/app` (bản vá CŨ) còn nằm đó là để lại một cây mã cũ
thắng thứ tự nạp — app boot mã 0.29 trên native 0.31, hỏng kiểu im lặng khó thấy nhất.

Rồi chạy bộ cài vào đúng thư mục riêng (NSIS nhận `/D=` — phải là tham số CUỐI, không ngoặc kép):

```powershell
& "$env:TEMP\sand-update-XXXX\sand-update-<ver>.exe" /S /D=C:\cai029
```

## 3 · Dò lại bộ vá trên bundle mới

```
GROKBOT2_CLIENT_DIR=C:/cai029 node infra/scripts/patch-client.mjs --dry-run
```

Patch nào không khớp biến thể nào sẽ **dừng đỏ kèm id** — đó là thiết kế, không phải lỗi: tìm lại
hàm trong bundle mới (tên minify TRÔI giữa các bản — đã trả giá 0.20→0.29: `cOt` thành `vht`), thêm
`{version, find, replace, marker}` mới vào `infra/patches/<id>.mjs`. Patch hết thời thì khai
`obsoleteWhenMissing` (tiền lệ: `attach-upload-observable` — 0.29 viết lại đường đính kèm).

`--dry-run` cũng kiểm **fuses** của bundle mới. Fuses cấm `resources/app` fallback = hướng FE-gốc
chết (rủi ro R2) — dừng ở đây, KHÔNG ép.

## 4 · Áp + kiểm

```
GROKBOT2_CLIENT_DIR=C:/cai029 node infra/scripts/patch-client.mjs --apply    # tự thêm sandLab
GROKBOT2_CLIENT_DIR=C:/cai029 node infra/scripts/patch-client.mjs --verify   # phải xanh TOÀN BỘ
```

`--apply` từ chối khi app đang chạy (kiểm theo đường dẫn, không theo tên). `--verify` có chốt riêng
cho `sandLab` — thiếu là đỏ, vì mất khoá ấy là app lại tự cập nhật được.

## 5 · Mở lại và đo

Mở bằng shortcut "Grok Bot (local)" / `run.ps1` (bốn biến môi trường + giết theo đường dẫn). Đo:
`e2e-reply.mjs`, `e2e-teach.mjs`, và `parity-lap --lan 3` nếu bundle đổi renderer. Cuối cùng dựng
lại bộ cài cho máy khác (`build-setup.mjs`) — nó bundle chính patcher nên máy nhận được trọn quy
trình này.

## Kênh tự cập nhật của MÌNH (tương lai)

Giao thức đã moi đủ (docs/reverse/spike-findings.md): `SAND_UPDATE_FEED_BASE_URL` bật lại updater và
trỏ vào feed riêng; feed chỉ cần một route trả JSON `{url, version, sha256hash}` hoặc 204. **Chặn
bởi chữ ký số, không bởi mã**: bộ cài của ta `NotSigned` nên mỗi bản đẩy xuống là một lần SmartScreen
chặn. Có chứng chỉ thì đường này mở.
