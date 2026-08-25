# BẢNG THEO DÕI — một chỗ duy nhất

Gộp X-quang · lộ trình · danh sách việc · E2E vào **một tài liệu để theo dõi**. Mọi thứ ở đây đo từ
hệ đang chạy ngày **25/08/2026**. Tài liệu sâu nằm chỗ khác (xem §6) — chỗ này chỉ giữ **trạng thái
và việc**, để không phải mở tám file mới biết đang ở đâu.

Chạy lại phần đo: `node services/grokbot-backend/scripts/self-xray.mjs`

---

## 1 · Hôm nay đang ở đâu

| | |
|---|---|
| **Backend** | 4 tiến trình · 15.687 dòng TS · 29 route `/v1` · 120 lệnh cổng (103 đã gọi thật) |
| **Dữ liệu** | 14 bảng · 2.036 tin nhắn · 8 bot · 8 routine · **10 bảng có `owner_id`** |
| **Bot** | 60 công cụ · 4 loại thợ phụ · màn hình ảo 1920×1080 trên box |
| **Trang tải** | `/` + `/download/windows` (**.exe 2 MB**) + `/download/mac` (.command 27 KB) |
| **Kiểm thử** | 26 file unit · 58 bộ e2e · máy đo tự động **7/9 xanh** |
| **Chưa mở ra ngoài** | cả 4 cổng nghe `127.0.0.1` — đó là thứ đang giữ an toàn, không phải xác thực |

**Đọc một dòng nếu chỉ đọc một dòng:** phần khó nhất (bot làm việc thật) đã chạy; phần còn lại là
**dọn nhà và mở cửa cho người thứ hai**.

---

## 2 · Máy đo tự động — **9/9** *(25/08, sau chặng 0)*

| mục | trạng thái |
|---|---|
| code chết (knip) | ok · 72 phát hiện (đúng mốc) |
| **kích thước code** | **ĐỎ** · 5 file > 800 dòng · 28 hàm > 50 dòng — **tăng** từ 3/16 |
| ranh giới tầng | ok · 7 luật đạt |
| ngân sách bundle | ok · 95 KB thô / 31 KB gzip |
| hợp đồng client | ok · khớp bản đã trích |
| spec `/v1` | ok · 29 route · 32 schema |
| docs | ok · 0 link chết · 0 mồ côi |
| nhật ký e2e | ok · 98 lượt — *xem cảnh báo §5* |
| **không lặp lại** | **ĐỎ** · cùng mục đỏ hai lượt liền → **dừng tính năng, sửa cái sinh ra nó** |

Năm file quá dài, theo thứ tự nên tách:

```
1840  apps/grokbot-web/src/main.ts
1224  services/grokbot-backend/src/runtime/tools.ts
1195  services/grokbot-backend/src/runtime/turn.ts
 936  services/grokbot-backend/src/mcp.ts
 863  packages/grokbot-proto/src/bootstrap.ts
```

Bốn hàm dài nhất: `handleNative` **564** · `buildCommands` **408** · `createGatewayRouter` **270** ·
`runTurn` **251**.

---

## 3 · Việc còn lại — mỗi việc kèm cách kiểm

Thứ tự ở đây là **cái gì chặn cái gì**, không phải theo độ khó. Mỗi việc có một dòng **kiểm** — chạy
được, ra kết quả nhìn thấy. Không có dòng kiểm thì không tính là xong.

Lệnh chạy từ `services/grokbot-backend/` trừ khi ghi khác.

### Chặng 0 · Dọn — ✅ **XONG 25/08, cổng 9/9**

| # | việc | kiểm bằng | kết quả |
|---|---|---|---|
| 0.1 | ✅ Tách 6 hàm dài (backend) | `node scripts/code-size.mjs` | 28 → 22 |
| 0.2 | ✅ Sửa 5 bài `store.test` đỏ im lặng | `npx tsx --test src/store.test.ts` | 9/9 |
| 0.3 | ✅ `httpTransport` 182 → 6 hàm nhỏ | `npx tsx --test src/mcp-http.test.ts` | 28/28 |
| 0.4 | ✅ `oauthPortFor` → `pendingPort` + `tokenPort` | như trên | 28/28 |
| 0.5 | ✅ `mcp.ts` 936 → dưới 800 | `node scripts/code-size.mjs` | rời danh sách |
| 0.6 | ✅ `bootstrap.ts` 862 → dưới 800 | `node scripts/contract-test.mjs` | 46/46 |
| 0.7 | ✅ FE: `mdToHtml`·`renderRuns`·`messageActions`·`bootApp` | `npx tsx --test src/markdown.test.ts` | 10/10 |
| 0.8 | ✅ Xoá 3 export chết mới sinh | `npx knip` | về mốc 72 |
| 0.9 | ✅ **Sửa bẫy tự quy chiếu của cổng** | `node scripts/self-xray.mjs` | **9/9** |
| 0.10 | ✅ **Chạy E2E thật, không chỉ unit** | `e2e-native` · `e2e-mcp` · 3× `verify-*` | 60/60 · MCP xanh · 3/3 |
| 0.11 | ✅ Sửa bài kiểm ôm hợp đồng cũ (X8) | `node scripts/e2e-native.mjs` | 58/1 → **60/0** |

**Kết quả chốt chặng:** 3 file > 800 · 16 hàm > 50 — **đúng mốc**. BE 272/272 · FE 16/17 · hợp
đồng 46/46 · `/v1` đầu-cuối **60/60** · MCP xanh · ba cổng tiến trình xanh · self-xray **9/9**.

> **Một bài FE đỏ, và nó KHÔNG phải do chặng này:** `avatar.test.ts` — "SVG có thân, có hai mắt".
> Đã kiểm trên cây trước khi sửa: đỏ y hệt. Xếp vào nợ lẻ N8, đừng tính vào chặng 0.

### Chặng 1 · Đo được tiền *(chạy song song — chỉ một biến môi trường)*

| # | việc | kiểm bằng | ĐẠT khi |
|---|---|---|---|
| 1.1 | ⬜ Seed bảng `plans` (đang **rỗng**) | `sqlite: SELECT * FROM plans` | có `free` và `pro` |
| 1.2 | ⬜ Bật `GROKBOT2_BILLING=warn` | `curl -s localhost:8788/v1/me` | có trường `overQuota` |
| 1.3 | ⬜ Chạy 1 tuần rồi đọc số | `SELECT COUNT(*) FROM usage` | **> 0 dòng** (nay 0) |
| 1.4 | ⬜ Chỉ khi 1.3 có số: cân nhắc `enforce` | `GROKBOT2_BILLING=enforce` + gửi 1 tin | vượt hạn thì bị chặn, kèm lý do |

**E2E chốt chặng 1**
```
node scripts/e2e-native.mjs         → /v1/me và webhook thanh toán còn đúng
node scripts/e2e-run.mjs            → một lượt chat vẫn chạy khi bật đo
```

### Chặng 2 · Vá ba lỗ đăng nhập — bắt buộc trước khi rời `127.0.0.1`

| # | việc | kiểm bằng | ĐẠT khi |
|---|---|---|---|
| 2.1 | ⬜ Thu hồi được token | `POST /v1/logout` rồi gọi lại `/v1/me` bằng token cũ | **401** (nay vẫn 200) |
| 2.2 | ⬜ Chặn đoán mật khẩu | gọi `POST /v1/login` sai 6 lần | lần thứ 6 bị **429** |
| 2.3 | ⬜ Khoá `/v1/register` | `POST /v1/register` khi chưa bật cờ mở | **403** |
| 2.4 | ⬜ Rút hạn JWT (nay **365 ngày**) | đọc `exp` trong token | ≤ 30 ngày |

**E2E chốt chặng 2**
```
npx tsx --test src/auth-cinapi.test.ts src/site.test.ts   → xanh
node scripts/gw-auth.mjs                                  → app gốc vẫn vào được
```
> Cửa của app desktop dùng **token cổng**, không dùng mật khẩu. Sửa đường web mà làm hỏng đường app
> là kiểu lỗi chỉ lộ ra khi mở app lên — nên `gw-auth.mjs` là bắt buộc, không phải tuỳ chọn.

### Chặng 3 · Test trên máy thứ hai — cái thước đo ranh giới

Chi tiết mang gì / không mang gì: [system-xray.md §6c](system-xray.md).

| # | việc | kiểm bằng | ĐẠT khi |
|---|---|---|---|
| 3.1 | ⬜ **T1** BE tự dựng từ 0 | `pnpm backend` rồi `curl /v1/health` | `ok:true` · `.data/grokbot.sqlite` **tự sinh** · 0 bot |
| 3.2 | ⬜ **T2** một lượt chat thật | `pnpm web` → gõ một câu | có câu trả lời |
| 3.3 | ⬜ **T3** box qua hầm | `node scripts/verify-computer.mjs` | liệt kê được `/home/box/workspace` · VNC hiện hình |
| 3.4 | ⬜ **T4** bộ cài `.exe` trên máy sạch | chạy `Cai-dat-Bot-Noi-Bo-*.exe` | shortcut mang **logo app** · app tự mở · `check-app.cmd` đếm được RPC |
| 3.5 | ⬜ **T5** hai máy một box | cả hai cùng sai bot mở trình duyệt | *(dự đoán **ĐỎ**)* — ghi lại đúng cái xảy ra, **đừng sửa vội** |

**E2E chốt chặng 3**
```
node scripts/verify-sqlite.mjs      → sổ mới dựng đúng schema
node scripts/verify-runtime.mjs     → tiến trình chạy lượt trả lời
infra\scripts\check-app.cmd         → app nói chuyện với backend local, không phải server hãng
```

### Chặng 4 · Đưa BE ra khỏi máy cá nhân *(cần Chặng 2 xong)*

| # | việc | kiểm bằng | ĐẠT khi |
|---|---|---|---|
| 4.1 | ⬜ Đổi `listen(port, "127.0.0.1")` | `netstat -ano \| findstr 8788` | nghe `0.0.0.0` |
| 4.2 | ⬜ CORS cho đúng nguồn | `curl -H "Origin: https://…" /v1/me` | header CORS đúng, không phải `*` |
| 4.3 | ⬜ HTTPS | `curl -I https://<vps>/` | 200, chứng chỉ hợp lệ |
| 4.4 | ⬜ `host_settings` theo người | hai tài khoản đặt hai múi giờ | không đè nhau (nay **một dòng chung**) |
| 4.5 | ⬜ **T6** máy khách trỏ vào VPS | mở app trên máy 2 | máy 1 và máy 2 thấy **cùng** dữ liệu |

**E2E chốt chặng 4**
```
node scripts/e2e-native.mjs         → 29 route còn đúng qua mạng
node scripts/contract-test.mjs      → hợp đồng không đổi khi đổi chỗ đứng
```

### Chặng 5 · Tách người dùng trên box — **ba tầng**

Kế hoạch đầy đủ: [per-user-on-one-box.md](../plan/per-user-on-one-box.md).

| # | việc | kiểm bằng | ĐẠT khi |
|---|---|---|---|
| 5.1 | ⬜ Bước root một lần (`useradd` + sudoers) | `sudo -n -l` trên box | daemon chạy được lệnh dưới `gb2u*` |
| 5.2 | ⬜ Chuyển Chrome profile sang home user | `ls -ld /home/gb2u001/.config` | chủ sở hữu là `gb2u001` |
| 5.3 | ⬜ Chuyển `grok-memory` + `workspace` | như trên | như trên |
| 5.4 | ⬜ **Thử rò**: bot của A đọc file của B | `run_terminal_command_v2` đọc chéo | **Permission denied** |
| 5.5 | ⬜ Thu hồi khi nghỉ | để idle quá ngưỡng | tiến trình bị thu, đĩa giảm |
| 5.6 | ⬜ Mượn hình dạng `SandboxPolicy` | policy có `additional_readwrite_paths` | lệnh ngoài allowlist bị từ chối |

**E2E chốt chặng 5**
```
node scripts/e2e-box-tools.mjs      → công cụ box còn chạy sau khi đổi user
node scripts/e2e-desktop.mjs        → 29 mục · điều khiển máy tính không vỡ
node scripts/test-real-box.mjs      → box thật, không phải giả lập
```

### Chặng 6 · FE riêng

| # | việc | kiểm bằng | ĐẠT khi |
|---|---|---|---|
| 6.1 | ⬜ Routines: danh sách + tạo + sửa | `node scripts/e2e-routine-ui.mjs` | tạo được routine ngay trên web |
| 6.2 | ⬜ Đối chiếu với app gốc | `node scripts/ui-diff.mjs` | không lệch vùng đã dựng |

**E2E chốt chặng 6**
```
node scripts/e2e-routines.mjs       → routine nổ đúng điều kiện
node scripts/measure-routines-ui.mjs → giao diện khớp bản gốc
```

### Nợ lẻ — không chặn ai, nhưng đừng quên

| # | việc | kiểm bằng |
|---|---|---|
| N1 | ⬜ Thử Cloudflare thật rồi thêm bước nhận biết trang chặn | mở một trang có CF, xem bot nói gì |
| N2 | ⬜ Bộ cài macOS chạy trên máy Mac thật | `bash Cai-dat-Bot-Noi-Bo-mac-*.command` |
| N3 | ⬜ `.exe` cài thử trên máy sạch | chạy file, xem Apps & features có mục |
| N4 | ⬜ `self-xray` **tự ghi mình vào nhật ký e2e** → làm hỏng chỉ số | sửa chỗ ghi log, xem §5 |
| N5 | ⬜ 6 bot xoá 24/08 — **chờ bạn quyết** cứu hay bỏ | `grokbot.sqlite.7.bak` |
| N6 | ⬜ `bot.log` in token Telegram | đổi token + xoay log |
| N7 | ⬜ `publishSkill` cần registry | thuộc hạ tầng |
| N8 | ⬜ `avatar.test.ts` đỏ từ trước — "SVG có thân, có hai mắt" | `npx tsx --test apps/grokbot-web/src/avatar.test.ts` |

---

## 4 · E2E — quy trình và danh sách

### Quy trình (bắt buộc theo thứ tự)

```
1. Kiểm bot có rảnh      curl -s localhost:8788/v1/health   → isBusy phải là false
2. Chạy bộ của chặng     (bảng dưới)
3. ĐỎ?  → sửa NGAY tại gốc, không ghi nợ, không bỏ qua
         → trước khi sửa: bài kiểm sai hay code sai?  (xem ô dưới)
4. Chạy lại tới khi XANH
5. Xanh rồi mới cập nhật docs + commit
```

> **Bài kiểm sai hay code sai?** Mặc định là **code sai**. Chỉ kết luận bài kiểm sai khi tìm được
> chỗ hợp đồng đã cố ý đổi, kèm lý do — và khi sửa bài kiểm thì phải kiểm **chặt hơn** trước, đừng
> chỉ nới cho qua.
>
> Ví dụ thật (25/08): `e2e-native` đỏ ở "POST non-image is 400" nhưng nhận 201. Route đã đổi ở X8 —
> app gốc đính kèm được **mọi loại tệp**, nên `400` mới là hợp đồng sai. Sửa bài kiểm, và thêm một
> khẳng định nữa: **tệp phải giữ đúng tên**, vì chỉ so mã 201 thì một lần âm thầm lưu nhầm thành
> ảnh vẫn lọt.

### Runner: `node` hay `npx tsx`?

**61 bộ chạy bằng `node`. Bốn bộ này BẮT BUỘC `npx tsx`** vì chúng import thẳng `src/*.ts`:

```
npx tsx scripts/e2e-mcp.mjs        npx tsx scripts/e2e-browser.mjs
npx tsx scripts/e2e-attachment.mjs npx tsx scripts/e2e-drafts-todo.mjs
```

Chạy nhầm bằng `node` thì lỗi là `ERR_UNKNOWN_FILE_EXTENSION ".ts"` — trông như hỏng code, thực ra
chỉ là sai runner. Tìm ra được cũng vì chạy thật (25/08).

### Danh sách — bộ nào phủ cái gì

| bộ | lệnh | phủ | lần chạy gần nhất |
|---|---|---|---|
| **Unit backend** | `npx tsx --test src/*.test.ts` | 272 bài · store, auth, mcp, site, đường dẫn client | ✅ 272/272 · 25/08 |
| **Unit FE** | `cd apps/grokbot-web && npx tsx --test src/*.test.ts` | markdown, avatar | ⚠️ 16/17 — **N8 đỏ từ trước** |
| **Hợp đồng client** | `node scripts/contract-test.mjs` | 46 · routes·auth·commands·channels | ✅ 46/46 · 25/08 |
| **`/v1` đầu-cuối** | `node scripts/e2e-native.mjs` | 60 · roster CRUD·gửi·ngắt·SSE·đính kèm | ✅ 60/60 · 25/08 |
| **MCP** | `npx tsx scripts/e2e-mcp.mjs` | liệt kê tool·gọi tool·lỗi tool·args hỏng | ✅ · 25/08 |
| **Cổng tiến trình** | `node scripts/verify-native.mjs`<br>`node scripts/verify-runtime.mjs`<br>`node scripts/verify-ops.mjs` | BFF·runtime·ops còn đúng vai | ✅ cả ba · 25/08 |
| **Điều khiển máy tính** | `node scripts/e2e-desktop.mjs` | 29 · chuột·phím·dạy việc | 27–29/29 · *chập chờn 10–20%* |
| **Việc song song** | `node scripts/e2e-tasks.mjs` | 14 · `task`/`await_task` | ✅ 14/14 |
| **Routine** | `node scripts/e2e-routines.mjs` | nổ đúng điều kiện·bộ lọc | — |
| **Trình duyệt** | `npx tsx scripts/e2e-browser.mjs` | 16 công cụ trình duyệt | — |
| **Box** | `node scripts/e2e-box-tools.mjs` | chạy lệnh·đọc/ghi file trên box | — |

Còn **58 bộ e2e** khác trong `scripts/`; bảng này chỉ liệt kê những bộ **đã dùng để chốt một chặng**.

### Bộ nào chạy cho chặng nào

| chặng | chạy tối thiểu |
|---|---|
| **0 · Dọn** | unit BE + unit FE + hợp đồng + `e2e-native` + `e2e-mcp` + ba `verify-*` |
| **1 · Đo tiền** | `e2e-native` + `e2e-run` |
| **2 · Đăng nhập** | `auth-cinapi.test` + `site.test` + `gw-auth` |
| **3 · Máy thứ hai** | `verify-sqlite` + `verify-runtime` + `check-app.cmd` |
| **4 · Ra ngoài** | `e2e-native` + `contract-test` |
| **5 · Tách user** | `e2e-box-tools` + `e2e-desktop` + `test-real-box` |
| **6 · FE** | `e2e-routine-ui` + `e2e-routines` |

### Ba cái bẫy đã trả giá

1. **Đừng chạy bộ đụng màn hình khi `isBusy` là `true`** — cắt ngang một bot đang làm việc thật.
2. **Nhóm dựa vào thị giác chập chờn 10–20%** (đo 5 lượt: 29·27·28·29·28). Đỏ một lượt ở **chỗ khác
   nhau mỗi lần** là hình dạng của bài toán, không phải một lỗi sửa bằng một commit. Đỏ **cùng một
   chỗ** hai lượt mới là lỗi thật.
3. **Số "x/20 lượt gần nhất đỏ" đang bị nhiễu** — `self-xray` ghi chính nó vào `e2e-history.jsonl`.
   Xem §5, và nợ N4.

---

## 5 · Chưa chắc chắn — và cảnh báo về chính số đo

- **"12/20 lượt e2e gần nhất đỏ" là số bị nhiễu.** `self-xray` ghi mỗi lần chạy của chính nó vào
  `e2e-history.jsonl` với `pass:false` khi cổng đỏ. Hôm nay tôi chạy nó nhiều lần, nên phần lớn
  "lượt đỏ" là chính nó. **Đừng đọc con số này là "e2e đang hỏng"** cho tới khi sửa chỗ ghi log.
- **Mất mạng:** lịch sử chắc chắn đọc được (SQLite cục bộ), nhưng **chưa thử rút mạng** xem app có
  boot trọn không.
- **Cloudflare có nhận ra Chrome của mình không** — chưa thử trang thật.
- **Tên binary cưỡng chế sandbox của hãng** — hàm trả đường dẫn bị minify, chưa truy ra.
- **File tên hỏng** `{"contents_after_edit":…}` trong workspace — chưa truy được lượt nào tạo ra.

---

## 6 · Tài liệu nào giữ cái gì

Bảng này để **không chép lại nội dung** — mỗi thứ có đúng một chỗ ở.

| tài liệu | giữ gì |
|---|---|
| **bảng này** | trạng thái + việc còn lại + E2E |
| [system-xray.md](system-xray.md) | x-quang toàn hệ cho người không rành kỹ thuật · vận hành · test máy thứ hai |
| [ship-to-users.md](../plan/ship-to-users.md) | website → tải → cài · billing · cái gì ở máy khách cái gì ở VPS |
| [per-user-on-one-box.md](../plan/per-user-on-one-box.md) | tách OS user · thu hồi khi nghỉ · cách hãng cô lập |
| [one-display-per-bot.md](../plan/one-display-per-bot.md) | một màn hình mỗi bot · sức chứa box |
| [desktop-computer-use.md](../plan/desktop-computer-use.md) | điều khiển máy tính · dạy việc |
| [fe-clone-plan.md](../plan/fe-clone-plan.md) | FE riêng, chia việc theo API |
| [protocol-reference.md](../protocol-reference.md) | hợp đồng với client — **đọc trước khi đổi shape** |
| [architecture.md](../architecture.md) | kiến trúc tổng |
| [legal.md](../legal.md) | ranh giới: dùng cá nhân / nghiên cứu |

---

## 7 · Ba câu hỏi nên trả lời trước khi code tiếp

1. **Dọn trước hay làm tiếp?** Luật của dự án nói dọn (đỏ hai lượt liền). Tôi cũng nghĩ vậy — chặng
   0 mất khoảng một lượt làm việc, và mọi chặng sau đều đụng vào đúng mấy file đó.
2. **6 bot đã xoá — cứu hay bỏ?** Bản sao còn đó, nhưng càng để lâu càng dễ lẫn với dữ liệu mới.
3. **Test máy thứ hai bằng máy nào?** Một laptop khác, hoặc một tài khoản Windows khác trên chính
   máy này cũng đủ cho T1–T4. Riêng **T5 cần hai máy thật**.
