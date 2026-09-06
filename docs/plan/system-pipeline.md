# Lộ trình làm hệ thống — đánh giá cấp độ hiện tại và chỗ còn hổng

Đối chiếu quy trình bạn đưa với **những gì repo này đang thật sự có**, rồi chỉ ra chỗ thiếu. Không
đề xuất thêm quy trình cho đẹp: mỗi mục dưới đây phải trả lời được "thiếu nó thì hỏng cái gì".

## 1. Chấm điểm từng chặng

| Chặng | Repo đang có gì | Cấp độ | Hổng ở đâu |
|---|---|---|---|
| **IDEA / TODO** | ý tưởng nằm trong hội thoại; checklist rải trong `ROADMAP.md` | 🟡 | không có **một** hàng đợi. Việc sống nhờ trí nhớ phiên làm việc — chính vì vậy mới cần `session/HANDOFF.md` |
| **PLAN** (Execution Roadmap) | `ROADMAP.md` có phase, exit criteria, và **gate chạy được** (`pnpm phase:gate`) | 🟢 **mạnh** | — |
| **Chọn stack** | chưa bao giờ làm tường minh cho FE | 🔴 **yếu nhất** | không có ADR nào cho "vì sao vanilla TS". Hệ quả: bốn lỗi cùng gốc trong một phiên (xem [fe/fe-xray-roadmap.md](../history/fe-xray-roadmap.archived.md) §2) |
| **Design** (X-ray hệ cũ) | số đo thật: [extracted/ui-design-spec.md](../extracted/ui-design-spec.md), `ui-xray.json`, `pnpm ui:diff`, `pnpm ui:shots` | 🟢 | thiếu **sơ đồ**: không có C4 mức 1–2, không có sequence diagram cho luồng nào |
| **BUILD** | pnpm workspaces + Turborepo, module theo domain | 🟢 | hợp đồng `/v1` chỉ tồn tại trong `native.ts` — FE tự khai lại type |
| **TEST** | 63 script, gate theo phase, nhật ký nối thêm (`pnpm e2e:history`) | 🟢 **mạnh** | script phẳng một thư mục; đã có lúc `import` một script làm chạy luôn bài đo của nó |
| **SYSTEM X-RAY** (soi hệ **của mình**) | `pnpm self-xray` — **9 mục**, mỗi mục một đáp số | 🟢 | — (T4 xong) |
| **REFACTOR ENGINE** | ngưỡng KHÔNG TĂNG cho code chết và kích thước code, cộng luật "đỏ hai lượt liền" | 🟢 | còn T5.2 (chạm > 3 file / tính năng) làm tay khi review |

**Tóm lại:** mạnh ở PLAN và TEST — mạnh hơn phần lớn dự án cùng cỡ. Yếu ở **quyết định stack**,
**sơ đồ thiết kế**, **tự soi mình**, và **vòng refactor**. Bốn chỗ yếu này cùng một bản chất: repo
rất giỏi kiểm *thứ đã làm*, và chưa có gì kiểm *cách sẽ làm*.

## 2. Ba thứ tiêu chuẩn nên lấy (và chỉ ba)

Đã tra 2026-08-22. Ba thứ này là mặc định của ngành, nhẹ, và giải đúng ba chỗ hổng ở trên.

### ADR — ghi *vì sao*, không chỉ *cái gì*

`docs/adr/NNNN-tieu-de.md`, định dạng MADR: **Context · Decision · Consequences · Alternatives**.
Nằm trong repo, review trong PR như code.

Repo đã có [architecture/architecture-decisions.md](../architecture/architecture-decisions.md) — một
file gộp **19 ADR**.

> **Sửa một lời phê sai của chính tài liệu này.** Bản đầu viết rằng file gộp "không nói được quyết
> định nào còn hiệu lực" và đề xuất tách ra 19 file. Đọc kỹ thì nó nói được: mỗi ADR có `Status`, có
> liên kết `superseded by`, và ADR-P0-4 còn có hai mục *"What still holds"* / *"What does not"*. Tách
> ra chỉ là dời chữ và làm chết mọi anchor. Việc thật sự thiếu chỉ là **một mục lục có trạng thái** —
> đã làm ở [adr/README.md](../adr/README.md).

Những quyết định đã có hiệu lực nhưng chưa ai ghi (số dành sẵn ở sổ ADR):

- `0001` patch client bằng pipeline dữ liệu, không sửa tay `resources/app`
- `0002` avatar dùng `bloub` (MIT) thay vì asset của hãng
- `0003` hợp đồng `/v1` là một khai báo TypeBox cho cả FE và BE
- ~~`0004` stack FE~~ — **đã viết** ([0004-stack-fe.md](../adr/0004-stack-fe.md))

Hai cái tôi từng liệt kê là "chưa ghi" thì hoá ra **đã có**: ACL là lõi vĩnh viễn là `ADR-F0-1`, và
SQLite là đường nóng là `ADR-P3-1`. Cả hai đều nằm trong file gộp mà tôi chưa đọc lúc viết danh
sách.

### C4 — sơ đồ theo bốn mức, thực tế chỉ cần mức 1–2

Mức 1 *System Context*: grokbot2 · client hãng · Claude pool · box. Mức 2 *Container*: BFF 8788 ·
runtime 8789 · computer 8790 · ops 8791 · FE 5173 · SQLite. Mức 3 chỉ khi cần. Mức 4 bỏ.

Viết bằng **Mermaid ngay trong markdown** — sơ đồ rẻ để dựng lại thì mới không mục. Kèm 3–5
sequence diagram cho luồng thật: *gửi một tin* · *tool call cần xin phép* · *handoff sang box*.

### Diátaxis — bốn loại tài liệu, đừng trộn

*tutorial* (làm theo là chạy được) · *how-to* (giải quyết một việc) · *reference* (tra cứu) ·
*explanation* (vì sao). `docs/README.md` mới đã là điểm vào; còn thiếu đúng loại **tutorial**:
không có file nào cầm tay một người mới từ `git clone` tới "chat được với bot".

## 3. Chỗ hổng thành việc làm được

### T1 — quyết định stack cho ra quyết định (chặng 🔴 nặng nhất)
- [ ] T1.1 Viết `adr/0004-stack-fe.md`: React + `react-resizable-panels` + `@tanstack/react-virtual`, kèm **giá phải trả** và điều kiện *không* làm (nếu FE chỉ còn là chỗ debug thì đừng viết lại)
- [x] **T1.2** [adr/README.md](../adr/README.md) — **một mục lục cho cả hai chỗ ở**, 20 ADR kèm trạng thái đọc thẳng từ file gộp: 18 ✅ · 1 ⚠️ (P7-1, mệnh đề cutover đã bị thay) · 1 ⛔ (P0-4). **Không tách file** — xem ghi chú ở trên về lời phê sai.

### T2 — sơ đồ thiết kế (chặng Design)
- [x] T2.1 C4 mức 1 + mức 2 bằng Mermaid, đặt trong [architecture.md](../architecture.md) — **có từ 25/08** (`0d9cfef`), ô này quên tick; 06/09 thêm nhánh daemon local-exec trên máy người dùng vào mức 2
- [x] T2.2 Ba sequence diagram: gửi tin · tool call xin phép · handoff box — **có từ 25/08**, mục "Ba luồng quan trọng (C4 dynamic)"
- [x] T2.3 Sơ đồ triển khai: process nào nghe cổng nào, ai ghi SQLite — bản 25/08 tả máy dev; **06/09 vẽ lại theo máy thật**: VPS (Cloudflare Tunnel → nginx `cinai-app` → `grokbot2-be` MỘT tiến trình :8788 → `shared/data`; router box :1337 → daemon `gb2uNNN` :13400+N; màn :77 Xvfb · Chrome :9224 · x11vnc 5977 · websockify 7077) + máy người dùng (daemon local-exec SSE) + máy dev (4 tiến trình). Bảng bất biến thêm 4 dòng từ các sự cố 03–06/09

### T3 — hợp đồng API thành nguồn sự thật — ✅ xong 2026-08-22

`packages/api-contract` (TypeBox) là **một** khai báo cho ba chỗ dùng: BE lấy kiểu, FE
`import type`, và `pnpm api:gen` sinh OpenAPI.

- [x] **T3.1** FE thôi tự khai lại. Gộp lại lộ ra **6 chỗ lệch** giữa hai bản: `presence` 4 trường
  vs 2 · `notificationsEnabled` · `notifyOnUpdates` · `role` · `rawArgs` · `lastEntry` (union 3
  nhánh vs `{kind, text?}` đoán). FE đang làm việc trên một **tập con đoán được**.
- [x] **T3.2** [api/grokbot2-v1.yaml](../api/grokbot2-v1.yaml) máy sinh: 19 route · 23 schema · 0
  `$ref` chết, YAML đã parse kiểm. Bản viết tay `v0` (666 dòng, **633 là schema**) chuyển sang
  `history/` — nó thiếu route avatar/reaction/sidebar và dùng `{agentId}` trong khi route thật là
  `{id}`. Văn xuôi 33 dòng tách sang [api/README.md](../api/README.md).
- [x] **T3.3** Lệch thì đỏ: `gen-openapi --check` là mục thứ năm của `pnpm self-xray`.

**FE không tăng một byte nào**: 51.69 KB JS / 20.11 KB gzip trước và sau, vì `import type` không
vào bundle.

Hai điều gate mới bắt được ngay trong lượt sửa này, cả hai do chính tôi gây ra: một link chết
(`api/grokbot2-v0.yaml` sau khi chuyển) và **code chết tăng 128 → 129** vì `native-map.ts`
re-export ba kiểu không ai import. Đã bỏ re-export thay vì nâng mốc.

### T4 — SYSTEM X-RAY soi hệ **của mình** — ✅ xong 2026-08-22
`pnpm self-xray` — sáu mục, mỗi mục một đáp số, ghi vào nhật ký như mọi bài đo khác:

| Mục | Kết quả lượt đầu | Đỏ thì hỏng gì |
|---|---|---|
| ✅ T4.1 code chết (`knip`) | **128** phát hiện: 94 export + 33 type + 1 dependency không ai dùng | ngưỡng là **KHÔNG TĂNG**, mốc ghi ở `state/self-xray-baseline.json`; giảm thì tự cập nhật mốc |
| ✅ T4.2 ranh giới tầng | 7 luật đạt (`boundaries.test.ts`) | domain nhập ngược lên transport là bước đầu của khối bùi nhùi |
| ✅ T4.3 ngân sách bundle | 66 KB thô / 23 KB gzip (ngưỡng 320/90) | ngưỡng nới sẵn cho React theo ADR 0004; chạm thì đọc ADR trước khi nâng số |
| ✅ T4.4 trôi hợp đồng | khớp bản đã trích | hãng đổi tên lệnh/kênh mà mình không biết thì client im lặng hỏng |
| ✅ T4.5 docs | 0 link chết · 0 mồ côi | tài liệu sai không làm build đỏ, chỉ làm người sau mất buổi sáng |
| ✅ T4.6 nhật ký e2e | 35 lượt đã ghi, 2/20 lượt gần nhất đỏ | không có nhật ký thì một lượt đỏ giữa hai lượt xanh mất dấu |

**128 phát hiện code chết** là nợ thật, và là số đầu vào cho T5: 94 export không ai dùng nghĩa là
có lớp trừu tượng dựng ra rồi bỏ.

### T5 — REFACTOR ENGINE: ngưỡng, không phải cảm giác — ✅ phần đo được đã xong 2026-08-22

Ngưỡng là **KHÔNG TĂNG**, không phải 0. Mốc ghi ở `docs/state/self-xray-baseline.json`, giảm thì tự
cập nhật. Đặt 0 là đòi điều sai: `buildCommands` 351 dòng chính là bảng 120 lệnh của hãng, tách nó
ra không làm nó dễ đọc hơn. Nhưng **thêm** một file 800 dòng nữa thì phải có người nói vì sao.

- [x] **T5.1** `pnpm code:size` → mục "kích thước code" trong `self-xray`. Mốc hôm nay:
  **3 file > 800 dòng · 15 hàm > 50 dòng**.

  | | dòng | |
  |---|---|---|
  | `runtime/turn.ts` | 1120 | file dài nhất |
  | `apps/grokbot-web/src/main.ts` | 906 | ADR 0004 nói React sẽ tách được nó |
  | `runtime/tools.ts` | 857 | |
  | `handleNative` (`native.ts:151`) | 384 | hàm dài nhất — một `if` dài theo route |
  | `buildCommands` (`cursor-acl`) | 351 | bảng 120 lệnh; **không** nên tách |
  | `paint` (`main.ts:570`) | 280 | dựng lại cả DOM — gốc của bốn lỗi ở ADR 0004 |

- [x] **T5.4** mục "không lặp lại": đọc lại chính nhật ký `self-xray` và **đỏ khi cùng một mục đỏ
  hai lượt liền**. Luật này trước đây chỉ là câu viết ra; giờ nó tự kiểm.
- [x] **T5.3** đã thi hành trong thực tế, không cần công cụ: nhật ký e2e sinh ra vì cùng một lỗi
  "mất bằng chứng lượt đỏ" xảy ra hai lần trong một ngày.
- [ ] **T5.2** một sửa đổi chạm > 3 file cho một tính năng → sai chỗ trừu tượng. **Chưa tự động
  hoá**: cần đọc lịch sử git theo commit-tính-năng, và số đó nhiễu (một commit gộp nhiều việc trông
  y như một lớp trừu tượng sai). Để làm tay khi review, đừng dựng thước cho nó chỉ để có thước.

**Phép đo tự nó phải được kiểm.** `code-size.mjs` đi qua **bốn** bản trước khi tin được:

| bản | cách đo | kết quả |
|---|---|---|
| 1 | khoảng cách tới khai báo kế tiếp | 93 hàm "dài" — `killTree` 321 dòng, vô lý |
| 2 | khớp ngoặc, tìm `{` trong 2 dòng đầu | 13 hàm — **mất** `handleNative` 384 (chữ ký nhiều dòng) |
| 3 | nới thành 10 dòng | `handleNative` về, nhưng arrow một biểu thức bắt `{` của code sau (`seqOf` 133 dòng) |
| 4 | phân biệt bản chất: arrow một biểu thức **kết bằng `;` ở độ sâu ngoặc 0 trước khi có `{`** | 15 hàm, kiểm tay khớp |

Ba bản đầu đều in ra một con số trông như thật. Nếu lấy bản 1 làm ngưỡng thì T5 sẽ được dựng trên
một con số sai gấp sáu lần.

### T6 — cho người mới vào việc (đọc được cho team)
- [x] **T6.1** [onboarding.md](../onboarding.md) — README gốc trả lời *chạy thế nào*; file này trả lời *sửa được code và chứng minh không hỏng gì*. Có cả vòng đo (`typecheck` · `self-xray` · `ui:diff`) và việc đầu tiên nên nhận
- [x] **T6.2** [runbooks/](../runbooks/README.md) — **5** sự cố thật, khuôn *Triệu chứng → Xác nhận bằng lệnh → Sửa → Vì sao → Phòng*. Ba trong năm cái **trông giống mất dữ liệu** mà không mất gì, nên bước *Xác nhận* là bước quan trọng nhất
- [x] **T6.3** [`.github/pull_request_template.md`](../../.github/pull_request_template.md) — bảng số trước/sau, 9 mục `self-xray`, và ô tick theo *loại* thay đổi (route mới → schema + `api:gen`; vùng UI mới → anchor; quyết định → ADR)
- [~] **T6.4** — làm phần có giá trị, **không** làm phần chỉ có rủi ro:
  - [x] Mục lục [`scripts/README.md`](../../services/grokbot-backend/scripts/README.md): 129 script nhóm theo việc, kèm bảng lệnh `pnpm` và danh sách helper
  - [x] **Dọn 155 file `_tmp-*` khỏi git** (170 KB; 126 file `.txt` là **trích đoạn bundle minify của hãng** — vi phạm `legal.md` + ROADMAP R5). Đã `git rm --cached` + thêm luật `.gitignore`; file vẫn trên đĩa
  - [ ] **Không** di chuyển vật lý sang `{e2e,measure,gate}/`: **22 script tự tính đường dẫn repo theo độ sâu** (`resolve(HERE, "..", "..", "..")`), chuyển sâu một cấp là `REPO` trỏ sai **mà không báo lỗi** — file ghi vào `services/grokbot-backend/docs/…` thay vì `docs/…`. Muốn chuyển thì phải bỏ phép tính theo độ sâu trước (helper `repo-root.mjs` đi ngược lên tới `pnpm-workspace.yaml`), rồi mới di chuyển

  Con số tôi từng nói — "63 file phẳng" — **sai**: thật ra 158 file, trong đó 155 là `_tmp` rác và
  129 là script thật. Thư mục không phải bị sắp xếp tệ; nó bị **rác**. Dọn rác giải quyết gần hết
  vấn đề mà không cần chạm vào đường dẫn nào.

## 4. Một điều phải nói thẳng về "đọc được cho team dev"

**Toàn bộ docs và comment trong repo đang là tiếng Việt.** Với team Việt thì đó là lợi thế. Với
người ngoài, hoặc nếu sau này mở nguồn, đó là rào chắn lớn hơn mọi vấn đề kỹ thuật trong tài liệu
này. Cần quyết sớm và ghi thành ADR, vì càng viết thêm thì càng đắt để đổi:

- giữ tiếng Việt (nhanh cho bạn, khó cho người ngoài), hoặc
- code + comment tiếng Anh, docs tiếng Việt (thông lệ phổ biến), hoặc
- cả hai tiếng Anh.

Không có lựa chọn nào sai — nhưng **không chọn** thì mặc định thành lựa chọn thứ nhất, do quán tính.

## 5. Thứ tự đề nghị

1. **T1.1** — ADR stack FE. Mọi việc FE phía sau đều phụ thuộc nó, và nó đang trống.
2. **T2.1** — C4 mức 1–2. Rẻ, và là thứ người mới đọc đầu tiên.
3. **T4** — gộp `self-xray`. Phần lớn mảnh đã có, chỉ thiếu chỗ ghép và `knip`.
4. **T3** — `api-contract`. Trả nợ chỗ FE tự khai lại type.
5. **T6.1 + T6.2** — onboarding và runbook, viết từ sự cố **đã** gặp nên không phải bịa.
6. **T5** — ngưỡng refactor. Làm sau khi `self-xray` có số, vì ngưỡng không có số thì vô nghĩa.
7. **T2.2, T2.3, T1.2, T6.3, T6.4** — theo sức.

Song song với X0–X6 của [fe/fe-xray-roadmap.md](../history/fe-xray-roadmap.archived.md): T-series là *cách làm*,
X-series là *cái làm*. Không nên đổi chỗ hai cái.
