---
name: tai-lieu-trang-thai
description: Giữ tài liệu trạng thái của grokbot2 khỏi phình và khỏi trôi. Dùng khi cần trả lời "đang ở đâu, còn gì", khi cập nhật docs/state/bang-theo-doi.md, khi dọn docs/, hoặc khi thêm một tài liệu mới và không chắc nó nên nằm đâu.
tools: Read, Write, Edit, Bash, Grep, Glob
---

# Tài liệu trạng thái — đo trước, viết sau

Kỹ năng này tồn tại vì một chuyện đã xảy ra thật: trạng thái dự án từng nằm ở **ba** tài liệu, đo
vào **ba** ngày khác nhau, và một trong ba đã phải tự ghi *"bản trước ghi ngày 25–26/08 và đã lệch
khá xa"*. Ba nguồn sự thật thì luôn có ít nhất hai cái sai, và không ai biết cái nào.

## Luật một: một câu hỏi, một tài liệu

`docs/state/bang-theo-doi.md` là chỗ **duy nhất** trả lời *"đang ở đâu, còn gì"*.

Muốn thêm một tài liệu trạng thái mới? Đừng. Sửa cái đó. Nếu nội dung không vừa, đó là dấu hiệu nó
**không phải trạng thái** — nó là tài liệu sâu, và thuộc bảng §9 trong chính file ấy.

Kiểm nhanh trước khi tạo file mới: *câu hỏi này đã có tài liệu nào trả lời chưa?* Nếu có, sửa nó.

## Luật hai: tách ĐO khỏi VIẾT

Số trong tài liệu phải do một **script** in ra, không do người gõ tay.

```bash
node services/grokbot-backend/scripts/trang-thai.mjs
```

In ra: lệnh gateway (hợp đồng vs có handler vs thiếu), cờ tính năng ở client, client thực sự gọi
gì, số file test/nguồn, parity.

Vì sao quan trọng: ba tài liệu kia trôi ra khỏi nhau chính vì mỗi lần cập nhật là gõ tay một chỗ.
Tách ra thì số cũ sai chỉ tốn một lệnh, không tốn ba lần sửa.

Chép số vào tài liệu thì **ghi ngày đo** ngay dòng đầu. Số không có ngày là số không kiểm được.

## Luật ba: "thiếu" phải kèm "có ai gọi không"

Đếm suông là cách một danh sách việc biến thành một danh sách lo lắng.

> "thiếu 17 lệnh" → đọc như một đống việc
> "thiếu 17, trong đó **15 cái client tự tắt bằng cờ tính năng**" → quyết định được

Nên mỗi mục "còn thiếu" đều phải có cột *chặn bởi cái gì* hoặc *client có gọi được không*. Cách đo:
tìm tên lệnh trong bundle đang cài, và tìm cờ mặc định của nó:

```bash
grep -o 'ten_co:{client:!.,default:!.}' "C:/cai029/resources/app/dist/electron-main/main.cjs"
```

## Luật bốn: dọn thì phải quét lại link

```bash
node services/grokbot-backend/scripts/kiem-docs.mjs          # link gãy · mồ côi · chỗ phình
node services/grokbot-backend/scripts/kiem-docs.mjs --link   # chỉ link, thoát 1 nếu gãy
```

Đo được 31/08: dọn 79 file làm gãy **19 link**, và không có cách nào biết ngoài quét. Sửa xong quét
lại tới khi về **0**.

Ba con số script in ra, ba ý nghĩa **khác nhau**:

| số | nghĩa |
|---|---|
| **link gãy** | luôn là lỗi — sửa hoặc xoá dòng |
| **mồ côi** | *ứng viên* xoá, không phải án tử. README mồ côi là bình thường; bản ghi đo trong `parity-runs/` mồ côi là **đúng bản chất** |
| **chỗ phình** | một mục chiếm ≥35% tài liệu thường là nội dung bị nhét sai chỗ — nhưng transcript và bản ghi đo thì đúng là một khối dài, đừng cắt |

## Luật năm: việc đã xong thì một dòng, cái bẫy nó để lại thì nguyên văn

Đây là luật cắt được nhiều nhất. Tài liệu từng có một mục tên *"Cửa cấp token"* dài **567/1.249
dòng (45%)**, và bên trong nó là nhật ký của cả bốn chặng khác.

- **Việc đã xong** → một dòng trong bảng "Đã xong", kèm con số chứng minh (`403/403/200/403`).
- **Bẫy đã trả giá** → chép nguyên văn vào §7, vì đó là thứ duy nhất ngăn trả giá lần hai.
- **Nhật ký từng bước** → bỏ. Lịch sử git giữ rồi.

## Khi nào xoá, khi nào chuyển `history/`

| tình huống | làm gì |
|---|---|
| tài liệu về hướng **đã bỏ** nhưng ghi lại *cách đo* | `git mv` sang `docs/history/`, thêm hậu tố `.archived.md` |
| bản ghi đo của phase đã qua | xoá — **nhưng kiểm script nào đọc chúng trước** |
| tài liệu bàn giao phiên, nội dung đã lỗi thời | xoá |
| ảnh/tệp mồ côi không tài liệu nào nhắc | xoá |
| bundle giải nén của hãng | **không bao giờ commit** — `.gitignore`, xem `docs/legal.md` |

Cạm bẫy đã gặp: `parity-gate.mjs` đọc `P4-latency.json` và `P6-latency.json` để so p50. Xoá nhầm là
cổng đo hỏng im lặng. **Luôn `grep` tên file trong `scripts/` trước khi xoá.**

## Quy trình đầy đủ khi được nhờ "cập nhật trạng thái"

1. `node services/grokbot-backend/scripts/trang-thai.mjs` — lấy số.
2. Cập nhật `docs/state/bang-theo-doi.md`: §1 (số), §2–§5 (trạng thái + việc còn lại).
3. Có bẫy mới trả giá trong phiên? Thêm vào §7, **nguyên văn**, kèm con số.
4. `node services/grokbot-backend/scripts/kiem-docs.mjs` — link gãy phải về 0.
5. Commit, ghi rõ số nào đổi và vì sao.

## Đừng làm

- Đừng viết "khoảng", "gần như", "hầu hết" cho một thứ đếm được. Đếm đi.
- Đừng chép nội dung giữa hai tài liệu — trỏ link. Bảng §9 tồn tại chính vì việc đó.
- Đừng tạo `TRANG-THAI.md`, `STATUS.md`, `TODO.md` mới. Đã có một chỗ.
- Đừng xoá tài liệu chỉ vì nó mồ côi. Đọc nó trước.
