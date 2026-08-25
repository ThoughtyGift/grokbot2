# Kịch bản test máy thứ hai — biết trước sẽ thấy gì

**Đọc hết trang này TRƯỚC khi bắt đầu.** Mục đích của nó: trong luồng cài đặt có **bốn màn hình
trông như lỗi nhưng là bình thường**. Không biết trước thì mỗi cái đều làm người ta dừng lại tưởng
hỏng — đúng chuyện đã xảy ra ngày 26/08.

Ký hiệu: ✅ = đúng, đi tiếp · ⚠️ = trông như lỗi nhưng bình thường · ❌ = lỗi thật, có cách sửa bên dưới.

---

## Chuẩn bị (làm trên MÁY CHÍNH, trước khi động vào máy 2)

| # | việc | lệnh | thấy gì là đúng |
|---|---|---|---|
| C1 | Backend mở ra mạng | trong `.env`: `GROKBOT2_BIND=0.0.0.0` + `GROKBOT2_AUTH=enforce`, rồi khởi động lại | `netstat` hiện `0.0.0.0:8788` |
| C2 | Mở tường lửa (**cần quyền admin**) | xem lệnh dưới | không báo lỗi |
| C3 | Biết IP máy chính | `ipconfig` | ví dụ `192.168.100.203` |
| C4 | Máy 2 **cùng mạng** với máy chính? | trên máy 2: `ping 192.168.100.203` | có phản hồi. **Không có → xem "Khác mạng" cuối trang** |

PowerShell **quyền admin**, chạy một lần trên máy chính:

```powershell
New-NetFirewallRule -DisplayName "grokbot2-backend-8788" -Direction Inbound `
  -Protocol TCP -LocalPort 8788 -Action Allow -Profile Private
New-NetFirewallRule -DisplayName "grokbot2-site-8080" -Direction Inbound `
  -Protocol TCP -LocalPort 8080 -Action Allow -Profile Private
```

---

## Trên máy thứ hai — bảy bước, kèm màn hình

### B1 · Mở trang tải
```
http://103.75.186.63:8099/?k=<token>
```
✅ Dòng nhỏ dưới nút phải ghi **"bộ cài 118 MB · không cần chuẩn bị gì trước"**.
❌ Ghi "bộ cài 2 MB" → **thiếu token**, dán lại link đầy đủ.

### B2 · Bấm "Tải cho Windows"
⚠️ **Chrome giữ file lại, hiện cảnh báo tải xuống.** Bấm **Keep / Giữ lại**.
*Vì sao:* trang chạy HTTP chưa có HTTPS. Không phải file bẩn.
✅ File về đúng **≈118 MB** (`120.972 KB`). Nếu chỉ 2 MB → sai bản, xem B1.

### B3 · Bấm đúp file `.exe`
⚠️ **"Windows protected your PC"** — chỉ thấy nút **Don't run**.
👉 Bấm chữ **More info** (gạch chân) → mới hiện nút **Run anyway** → bấm.
*Vì sao:* bộ cài chưa ký số. Bản của hãng không bị vì họ mua chứng chỉ ký mã.

### B4 · Màn hình cài đặt hỏi địa chỉ backend
✅ **ĐÂY LÀ BƯỚC QUAN TRỌNG NHẤT.** Xoá `http://localhost:8788`, điền **IP máy chính**:
```
http://192.168.100.203:8788
```
❌ Để nguyên `localhost` → app sẽ treo ở B6. Sửa được sau (xem "Sửa backend.txt").

### B5 · Cài xong, app tự mở → "Meet Grok Bot"
✅ Màn hình onboarding, có nút **Next**. Bấm qua.

### B6 · "Setting up your Grok Bot…"
✅ Chạy vài giây rồi vào giao diện chính → **xong, T4 + T2 đạt**.
❌ Đứng mãi, rồi hiện **"Grok Bot couldn't finish setting up — Can't reach your computer right now"**
→ app không gọi được backend. Ba nguyên nhân, theo thứ tự hay gặp:

| nguyên nhân | kiểm thế nào | sửa |
|---|---|---|
| `backend.txt` còn `localhost` | mở file xem | sửa thành IP máy chính (dưới đây) |
| Tường lửa máy chính chặn | trên máy 2: mở `http://192.168.100.203:8788/v1/health` bằng trình duyệt | chạy lệnh C2 |
| Hai máy khác mạng | `ping` không thông | xem "Khác mạng" |

### B7 · Vào được giao diện chính
✅ Thấy danh sách bot của backend máy chính → **chat được**. Đây là lúc T2 đóng.

---

## Sửa `backend.txt` sau khi đã cài

Trên máy 2, mở bằng Notepad:
```
%LOCALAPPDATA%\Programs\Bot Noi Bo\backend.txt
```
Sửa thành `http://192.168.100.203:8788` (một dòng, không thêm gì), lưu, rồi mở lại app **bằng shortcut
"Bot Nội Bộ"** trên Desktop — không bấm thẳng `Grok Bot.exe`.

## Nếu hai máy KHÁC MẠNG

IP `192.168.x.x` chỉ dùng được trong cùng mạng. Khác mạng thì backend phải có địa chỉ công khai —
**chưa làm**, và không nên làm vội: backend giữ toàn bộ dữ liệu, mà `/oauth/token` hiện phát token cho
bất kỳ ai gọi tới. Đưa nguyên nó ra Internet là mở cửa cho cả thế giới.

Ba lối, theo mức an toàn:
1. **Đưa máy 2 vào cùng mạng** (chung Wi‑Fi) — rẻ và an toàn nhất.
2. **VPN riêng** giữa hai máy (Tailscale/WireGuard) — máy 2 thấy IP nội bộ như cùng mạng.
3. **Backend lên VPS + HTTPS + siết token** — việc thật, thuộc chặng 4–5, chưa xong.

---

## Bốn màn hình "trông như lỗi" — tóm tắt

| thấy gì | thật ra là | làm gì |
|---|---|---|
| Chrome giữ file, cảnh báo | trang HTTP chưa có HTTPS | bấm **Keep** |
| "Windows protected your PC" | bộ cài chưa ký số | **More info → Run anyway** |
| "Setting up your Grok Bot…" lâu | đang gọi backend | chờ ~10s |
| "Can't reach your computer" | **backend không tới được** | xem bảng B6 |

