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

## Đường 2 — VPS (ĐÃ CHẠY 26/08) · tên miền thêm sau

**Đang sống:** `http://103.75.186.63:8099/` — trang tải + file cài, gọi được từ bất kỳ mạng nào.

### Đã dựng gì

| | |
|---|---|
| Thư mục | `/opt/botnoibo/` — `index.html` · `serve-static.mjs` · `dist/` |
| Dịch vụ | `botnoibo-site.service` (systemd, `Restart=always`, tự chạy lại sau reboot) |
| Cổng | **8099** — cổng riêng, **không đụng nginx** |
| Log | `/var/log/botnoibo-site.log` |

Lệnh quản: `systemctl status|restart botnoibo-site` · `journalctl -u botnoibo-site`

### Vì sao KHÔNG cài Caddy, KHÔNG sửa nginx

VPS này đang chạy **hạ tầng thật của bạn**: `admin.halcion.vn` (pool Claude), `foodaymart.vn`,
`api.foodaymart.vn`, `media.halcion.vn`, `convex`… nginx đã giữ 80/443. Cài Caddy vào là hai thứ
tranh cổng — rủi ro sập cái đang chạy để được một trang tải. Nên: **cổng riêng 8099, không chạm gì
khác.** Kiểm sau khi dựng: `nginx -t` OK, và `admin.halcion.vn` 200 · `foodaymart.vn` 301 ·
`media.halcion.vn` 200 — vẫn nguyên.

### Máy chủ dùng ở đây khác `serve-site.mjs`

[`infra/vps/serve-static.mjs`](../../infra/vps/serve-static.mjs) — Node thuần, **không import gì**,
không `node_modules`. `serve-site.mjs` kéo theo cả backend (store, auth, mcp); đưa khối đó lên một
VPS đang chạy sản xuất là mang rủi ro vào chỗ không cần.

Bốn đường, không hơn: `/` · `/download/windows` · `/download/mac` · `/healthz`. Đo qua Internet
(26/08): `/` **200** 19 KB · `/download/windows` **200** đúng tên file · `/v1/me`, `/gw/api/…`,
`/admin`, `/../etc/passwd` đều **404**.

### Chưa có tên miền thì dùng được không? **Được — trừ một ma sát có thật**

`http://103.75.186.63:8099/` chạy ngay, không cần tên miền. Nhưng **Chrome giữ lại file `.exe` tải
qua HTTP**. Đo thật (26/08, bấm nút bằng trình duyệt thật):

- file về đủ **2.066.496 byte** nhưng nằm ở dạng `.crdownload`, chờ người bấm **Keep**
- console nói đúng lý do:
  `The file at 'http://…/download/windows' was loaded over an insecure connection. This file should be served over HTTPS.`

**Không phải hỏng** — bấm **Keep / Giữ lại** trong thanh tải là có file. Nhưng người dùng lạ sẽ chột
dạ, và vài phiên bản Chrome chặn thẳng không cho giữ.

**Ba cách, chọn theo mức vội:**

| cách | được gì | mất gì |
|---|---|---|
| Dùng luôn `http://…:8099` | chạy ngay, 0 công | phải bấm "Keep" mỗi lần tải |
| **Mượn tên miền đã có** (`halcion.vn`) — thêm một server block nginx trỏ về `127.0.0.1:8099` | HTTPS ngay, chứng chỉ đã có | phải chạm nginx (thêm block mới, không sửa block cũ) |
| Tên miền riêng `tai.halcion.vn` + certbot | sạch nhất | chờ DNS |

Cách 2 là đường ngắn nhất tới HTTPS mà **không cần đợi DNS**, vì `*.halcion.vn` đã trỏ về đúng VPS này.

### Hai bản, và ai cần bản nào

| máy nhận | bản | đường tải |
|---|---|---|
| **đã có client desktop + Node** | 2 MB (chỉ cấu hình) | công khai: `/download/windows` |
| **máy trắng, chưa từng cài gì** | **118 MB (chở cả app)** | **sau token**: `/download/full/<token>` |

Bản 2 MB **không chạy** trên máy trắng — nó vá client bạn đã có chứ không mang app theo; máy trắng
chạy nó sẽ báo `Chua thay client desktop` rồi dừng. Trang tải nay nói rõ chỗ này ngay dưới nút, vì
đó chính là chỗ đã gây nhầm khi thử trên máy thứ hai (26/08).

**Vì sao bản 118 MB nằm sau token, không công khai:** nó mang **client của nhà phát hành**. Ở một URL
ai cũng đoán được thì đó là **phân phối phần mềm của họ**; sau một token 24 ký tự thì nó là "chép
sang máy khác của chính mình" — đúng ranh giới [legal.md](../legal.md).

Token nằm ở **tên thư mục** trên VPS (`/opt/botnoibo/full/<token>/`), và bản sao ở
`services/grokbot-backend/.data/full-download-token.txt` (thư mục này **gitignore**, token không vào
kho). Sai token trả **404** giống hệt mọi đường lạ — không báo "sai token", vì báo ra là xác nhận có
thứ đáng đoán.

Đổi token: đổi tên thư mục trên VPS, không cần sửa code.



### Thêm tên miền (bước sau)

1. Trỏ bản ghi **A** của `tai.halcion.vn` → `103.75.186.63`
2. Thêm một server block nginx (KHÔNG sửa block nào đang có):
```nginx
server {
    listen 80;
    server_name tai.halcion.vn;
    location / { proxy_pass http://127.0.0.1:8099; proxy_set_header Host $host; }
}
```
3. `nginx -t && systemctl reload nginx`
4. HTTPS: `certbot --nginx -d tai.halcion.vn` (nginx đã có sẵn, không cần Caddy)

## Vì sao chỉ phát trang tải, không phơi cả backend

Backend chính (`pnpm backend`) nghe `127.0.0.1` **cố ý** — nó mang dữ liệu, agent, và các route
`/v1`,`/gw` chưa siết đủ cho Internet (chặng 4 + 5 mới xong việc đó). `serve-site.mjs` là mặt công
khai **tối thiểu**: một file HTML + hai file cài, không có gì khác để tấn công. Ngày làm xong chặng
4, backend đầy đủ mới nên ra mạng — và lúc đó trang tải này vẫn dùng lại được y nguyên.
