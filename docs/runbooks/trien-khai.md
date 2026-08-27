# Triển khai và lùi bản

Một trang. Nếu đang hoảng thì đọc §1 rồi thôi.

---

## 1 · Lùi ngay

```bash
ssh -p 24700 root@103.75.186.63 'bash /opt/grokbot2/bin/rollback.sh'
```

**2 giây.** Về bản ngay trước bản đang chạy, khởi động lại, tự kiểm sức khoẻ. Không mất dữ liệu —
tin nhắn, bot, routine, tài khoản sống ở `shared/data`, ngoài mọi bản.

Xem có những bản nào: `bash /opt/grokbot2/bin/rollback.sh --list`
Về đúng một bản: `bash /opt/grokbot2/bin/rollback.sh 20260827-100623`

Trên GitHub: Actions → **Rollback VPS** → Run workflow.

---

## 2 · Triển khai

Trên GitHub: Actions → **Deploy VPS** → chọn nhánh → Run.

Từ máy cá nhân, khi GitHub có việc — **cùng một đường**, vì việc thật nằm trong `deploy.sh` trên
máy đích chứ không nằm trong workflow:

```bash
git archive --format=tar.gz -o /tmp/g.tar.gz HEAD
scp -P 24700 /tmp/g.tar.gz root@103.75.186.63:/tmp/
ssh -p 24700 root@103.75.186.63 'bash /opt/grokbot2/bin/deploy.sh /tmp/g.tar.gz'
```

`git archive` chỉ lấy **file đã theo dõi**: không kéo theo `node_modules`, `.data`, hay rác trong
cây làm việc. Đó là chủ ý — cây làm việc của bạn không phải thứ đáng đưa lên máy chủ.

---

## 3 · Bố cục trên máy đích

```
/opt/grokbot2/
├── bin/                    deploy.sh · rollback.sh   ← công cụ, KHÔNG nằm trong bản nào
├── shared/                 data/ · .env · plugin-registry.json · node_modules.lock-hash
├── releases/
│   ├── 20260827-100404-goc   ← bản trước khi chuyển bố cục
│   ├── 20260827-100623
│   └── 20260827-100952
└── current -> releases/20260827-100952
```

`systemd` trỏ vào `current`, nên đổi bản = đổi một liên kết + `restart`.

**`shared/data` là ranh giới quan trọng nhất trong tài liệu này.** Nó giữ SQLite, khoá cổng, khoá
JWT, đính kèm. `deploy.sh` không bao giờ chép hay xoá nó — mỗi bản chỉ có một liên kết trỏ tới. Bỏ
qua chuyện này thì mỗi lần triển khai người dùng lại thấy kho trống, và mỗi lần lùi lại nhảy về một
tập dữ liệu khác.

---

## 4 · Ba cái bẫy đã trả giá khi dựng cái này

- **`node_modules` dùng chung không đủ.** pnpm workspace cần `node_modules` **trong từng gói**, nên
  chỉ trỏ liên kết ở gốc là build chết với *"Local package.json exists, but node_modules missing"*.
  Nay `deploy.sh` luôn `pnpm install --frozen-lockfile` trong bản mới; pnpm liên kết cứng từ kho
  chung của nó nên gần như không tốn thêm đĩa lẫn thời gian.
- **CRLF giết script bash.** Sửa file `.sh` trên Windows rồi `scp` sang thì bash báo
  *"pipefail: invalid option name"* — và thông báo đó không nói gì về xuống dòng.
  `.gitattributes` nay ép `*.sh text eol=lf`.
- **Công cụ lùi không được sống trong bản.** Bản đầu gọi `current/infra/vps/rollback.sh`; thử lùi
  thật về một bản cũ hơn ngày viết script thì **chính cái nút lùi biến mất**. Nay chúng ở
  `/opt/grokbot2/bin/`, được cập nhật sau mỗi lần triển khai thành công.

---

## 5 · Cửa nào chặn cái gì

| cửa | ở đâu | chặn gì |
|---|---|---|
| typecheck · 337 test · kích thước mã · hợp đồng 48 bài | `.github/workflows/ci.yml`, mọi lần đẩy | mã sai vào nhánh |
| build gói | `deploy.sh`, trên máy đích | bản không dựng được thì **không đổi liên kết** — dịch vụ cũ chạy tiếp |
| sức khoẻ trong máy | `deploy.sh` | không lên trong 40s → **tự lùi** |
| sức khoẻ ngoài Internet | `deploy.yml` | nginx/Cloudflare không theo kịp |

CI **không** tự triển khai. Một lần merge không phải một lần quyết định triển khai, và máy đó đang
có người dùng thật.

---

## 6 · Secret cần đặt trên GitHub

Settings → Secrets and variables → Actions:

| tên | giá trị |
|---|---|
| `VPS_HOST` | `103.75.186.63` |
| `VPS_PORT` | `24700` |
| `VPS_USER` | `root` |
| `VPS_SSH_KEY` | khoá riêng SSH, dạng OpenSSH đầy đủ (giữ cả dòng `BEGIN`/`END`) |

Chưa đặt thì hai workflow triển khai sẽ đỏ ở bước SSH; `ci.yml` không cần secret nào.
