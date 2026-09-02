# Quy trình phát hành app local — và vì sao banner chỉ hiện SAU khi nghiệm thu

> Viết 03/09/2026. Trả lời đúng một câu hỏi: *làm sao mỗi lần sửa code KHÔNG làm người dùng thấy
> "New update available", mà chỉ khi ta đã nghiệm thu xong mới thấy?*

## 1 · Ý chính, một câu

**Cái quyết định banner KHÔNG phải code — mà là một file công bố (manifest) trên máy chủ.**
Sửa code bao nhiêu lần cũng không ai thấy gì. Chỉ khi ta ghi một dòng vào file ấy thì máy người dùng
mới biết "có bản mới". Giống hệt website: đẩy code lên nhánh không làm ai thấy gì; chỉ khi bấm
*deploy* thì người dùng mới nhận bản mới.

## 2 · App gốc làm sao (đã trích, không đoán)

Client hỏi máy chủ theo nhịp:

```
GET {feed}/api/update/{nền}/{kênh}/{phiên bản đang chạy}/{máy}/stable
   → 204 No Content     = "không có gì mới"   ← 99% thời gian là câu trả lời này
   → {url, version, sha256hash}                = "có bản mới, tải ở đây"
```

Ba điểm đáng học:

1. **Máy chủ là người quyết định**, không phải kho code. Client chỉ biết hỏi.
2. **Có KÊNH (track)**: `stable → sand`, `nightly → sand-nightly`, `dogfood → sand-dogfood`. Cùng một
   máy chủ, ba câu trả lời khác nhau tuỳ người hỏi đang ở kênh nào. Nội bộ ở `dogfood` thấy bản mới
   trước; người dùng ở `stable` chưa thấy gì. Client có sẵn `setUpdateTrack` để đổi kênh.
3. **Có `sha256hash`**: tải xong client tự kiểm; sai băm là bỏ. Máy chủ nói dối không lừa được client.

Cộng thêm `autoUpdateWhenIdleOptIn` — người dùng chọn có cho tự cài lúc rảnh hay không.

## 3 · Sơ đồ cho app local

```
   SỬA CODE                          NGHIỆM THU                        PHÁT HÀNH
   ────────                          ──────────                        ─────────
   commit, push                      pnpm typecheck                    ① dựng gói cài
   (bao nhiêu cũng được)             pnpm test  (597 bài)                 build-setup.mjs
        │                            e2e-reply · e2e-teach              ② tính sha256
        │                            parity-lap --lan 3                 ③ GHI MANIFEST  ← CÔNG TẮC
        │                                  │                                  │
        └────── KHÔNG ai thấy gì ──────────┘                                  │
                                                                              ▼
                                                            manifest.json trên máy chủ
                                                            { "stable": {version, url, sha256},
                                                              "dogfood": {…} }
                                                                              │
                                            máy người dùng hỏi mỗi ~1 giờ ────┘
                                                                              ▼
                                             bản đang chạy < version trong manifest?
                                                  KHÔNG → 204, im lặng
                                                  CÓ    → banner "New update available  [Install]"
                                                              ↓ bấm Install
                                                       tải · kiểm sha256 · cài lúc thoát app
```

**Công tắc là bước ③.** Trước nó: sửa gì, xoá gì, hỏng gì cũng không ai thấy. Sau nó: mọi máy đang
chạy bản cũ hơn sẽ thấy banner ở lần hỏi kế tiếp.

## 4 · Đối chiếu với deploy website

| website | app local |
|---|---|
| push nhánh | commit — không ai thấy |
| môi trường staging | kênh `dogfood` — chỉ máy mình thấy |
| bấm Deploy | ghi manifest kênh `stable` |
| CDN phát bản mới | client hỏi feed, thấy version cao hơn |
| người dùng F5 | người dùng bấm **Install** |
| rollback = deploy lại bản cũ | sửa manifest về version cũ |

Khác biệt duy nhất đáng kể: web thì F5 là xong, app phải **tải + cài + mở lại** — nên phiên bản trong
manifest phải là một gói đã dựng và đã kiểm băm, không phải một commit.

## 5 · Cần dựng gì (chưa có cái nào)

| # | việc | mô tả ngắn |
|---|---|---|
| 1 | **Vá hằng feed** | `var JBn="https://api2.cursor.sh/updates"` → backend của mình. Xuất hiện ĐÚNG 1 lần trong bundle 0.29 nên vá an toàn. Sau khi vá, app **không còn đường nào** hỏi máy chủ hãng — kể cả mở trần. |
| 2 | **Gỡ `sandLab`** | Nó chặn updater ở nhánh TRƯỚC nhánh feed-override (`envDisabled → isLabBuild → hasDevFeedOverride`), nên còn nó thì banner không bao giờ hiện. Gỡ chỉ AN TOÀN sau khi (1) xong. |
| 3 | **Route feed** | `GET /api/update/{nền}/{kênh}/{ver}/{máy}/stable` → 204 hoặc `{url, version, sha256hash}`. Đọc từ manifest, không đọc từ git. |
| 4 | **Lệnh phát hành** | `phat-hanh.mjs`: chạy test + E2E → dựng gói → tính sha256 → ghi manifest. **Từ chối ghi nếu test đỏ** — đó là chỗ "nghiệm thu" thành cơ chế chứ không phải lời hứa. |

## 6 · Thứ tự bắt buộc, và vì sao

**(1) trước (2).** Gỡ `sandLab` khi hằng feed còn trỏ hãng = mở lại đúng cái bẫy nó sinh ra để đóng:
một lần app tự cập nhật lên bản hãng là `resources/app` bị xoá, mất sạch bộ vá, app quay về nói
chuyện với server hãng **trong im lặng**.

**(4) trước khi công bố lần đầu.** Nếu ghi manifest bằng tay thì sớm muộn cũng có lần ghi nhầm một
bản chưa nghiệm thu — và khác với web, người dùng đã cài thì không "F5 về bản cũ" được, phải chờ ta
phát hành bản sửa.

## 7 · Cái giá phải nói trước

Bộ cài của ta **chưa ký số**. Client tự kiểm `sha256` nên không có rủi ro bị tráo file, nhưng
**Windows SmartScreen vẫn cảnh báo** mỗi lần cài — khác app gốc đúng ở chỗ đó, và chỉ chứng chỉ ký số
mới xoá được. Trước khi có chứng chỉ, cân nhắc để `autoUpdateWhenIdleOptIn` mặc định TẮT: một bản tự
cài lúc rảnh mà bật màn cảnh báo đỏ giữa lúc người dùng đang làm việc thì tệ hơn là không tự cài.
