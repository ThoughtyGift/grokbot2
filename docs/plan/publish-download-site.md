# Đưa trang tải cho máy khác tải app về

Mục tiêu: máy **chưa từng cài Grok Bot** tải được `Bot-Noi-Bo-Setup-*.exe` rồi bấm đúp — để làm
xong **T4** (và mở đường cho T2). Có hai đường; đường 1 chạy được **ngay hôm nay, không cần VPS**.

Chỉ phát **trang tải + file cài**, không phơi backend. Máy chủ dùng là
[`scripts/serve-site.mjs`](../../services/grokbot-backend/scripts/serve-site.mjs) — nó chỉ biết ba
đường `/`, `/download/windows`, `/download/mac`; mọi thứ khác trả 404. Dữ liệu, agent, `/v1`, `/gw`
**không có cửa** ở đây.

**Cần trước:** có bản cài chở app — chạy một lần:
```
node services/grokbot-backend/scripts/build-setup.mjs --with-app
```

---

## Đường 1 — máy khác CÙNG MẠNG LAN (nhanh nhất, không cần VPS/tên miền)

Đủ để làm T4 nếu máy thứ hai ở cùng nhà/văn phòng.

**1. Bật máy chủ tĩnh trên máy này:**
```
node services/grokbot-backend/scripts/serve-site.mjs
```
Nó in ra địa chỉ máy khác cần mở, ví dụ: `http://192.168.100.203:8080/`

**2. Mở cổng 8080 trên tường lửa** — chạy PowerShell **quyền admin** một lần:
```powershell
New-NetFirewallRule -DisplayName "grokbot2-site-8080" -Direction Inbound `
  -Protocol TCP -LocalPort 8080 -Action Allow -Profile Private
```

**3. Trên máy thứ hai:** mở trình duyệt vào `http://192.168.100.203:8080/` → bấm **Tải xuống** →
**bấm đúp** file `.exe` → điền địa chỉ backend → app tự mở.

> IP `192.168.100.203` là của máy này hôm đo; `serve-site.mjs` tự in IP thật mỗi lần chạy.

**Backend điền gì ở bước cài:** nếu máy thứ hai cũng cần backend thật thì điền
`http://192.168.100.203:8788` — **nhưng** backend chính đang nghe `127.0.0.1`, nên máy khác chưa gọi
tới được cho đến khi làm **chặng 4** (đổi `listen`). Để chỉ thử T4 (cài + mở app) thì địa chỉ nào
cũng được; app vẫn cài và mở lên.

---

## Đường 2 — VPS + tên miền (cho máy KHÁC MẠNG, ai cũng tải được)

Khi máy thứ hai không cùng LAN, hoặc muốn một địa chỉ công khai như hãng.

**Cần:** một VPS Linux + một tên miền trỏ về IP VPS (bản ghi A).

**1. Chép ba thứ lên VPS:**
- `services/grokbot-backend/.data/dist/Bot-Noi-Bo-Setup-*.exe` (bản chở app)
- `apps/grokbot-site/index.html`
- toàn bộ repo (hoặc chỉ phần cần để `serve-site.mjs` chạy — nó import `src/site.js`)

**2. Chạy máy chủ tĩnh trên VPS:**
```
PORT=8080 node services/grokbot-backend/scripts/serve-site.mjs
```

**3. Đặt reverse proxy + HTTPS trước nó.** Caddy là gọn nhất — một dòng Caddyfile:
```
tai.tenmiencuaban.com {
    reverse_proxy 127.0.0.1:8080
}
```
Caddy tự xin chứng chỉ Let's Encrypt. Xong: `https://tai.tenmiencuaban.com/` là trang tải công khai.

**4. Giữ nó chạy:** `pm2 start`, hoặc một systemd unit — mẫu ở
[`infra/grokbot2.service`](../../infra) (đơn vị cho backend; sửa lại `ExecStart` cho `serve-site.mjs`).

**KHÔNG CHẮC CHẮN / chưa làm được ở đây:** tôi không tạo được VPS hay tên miền hộ. Phần đo được là
máy chủ tĩnh phát đúng qua IP LAN (25/08: `/` 200, `/download/windows` 118 MB, `/v1`·`/gw`·`/admin`
đều 404). Bước Caddy + DNS là thao tác trên VPS của bạn.

---

## Vì sao chỉ phát trang tải, không phơi cả backend

Backend chính (`pnpm backend`) nghe `127.0.0.1` **cố ý** — nó mang dữ liệu, agent, và các route
`/v1`,`/gw` chưa siết đủ cho Internet (chặng 4 + 5 mới xong việc đó). `serve-site.mjs` là mặt công
khai **tối thiểu**: một file HTML + hai file cài, không có gì khác để tấn công. Ngày làm xong chặng
4, backend đầy đủ mới nên ra mạng — và lúc đó trang tải này vẫn dùng lại được y nguyên.
