# Máy thứ hai — làm theo đúng thứ tự, mỗi bước có "sẽ thấy gì"

Mục tiêu: một máy Windows **chưa từng cài gì** tải app về, cài, đăng nhập, và nói chuyện với backend
đang chạy trên Internet.

**Không cần** cài Node, không cần cài client của hãng trước, không cần cùng mạng với máy này.

Mỗi bước ghi rõ **sẽ thấy gì** — vì bốn màn hình dưới đây *trông như lỗi* nhưng là bình thường, và
đó là chỗ đã làm mất thời gian ở lần thử trước.

---

## Trước khi bắt đầu

| cần | giá trị |
|---|---|
| Đường tải | `https://cinai.app/tai/?k=1bab09366834373317dc8ecb` |
| Địa chỉ backend | `https://cinai.app/agent/` |

> **Gạch chéo cuối: nên có, nhưng thiếu cũng không sao nữa (sửa 26/08).**
>
> Ứng dụng ghép địa chỉ tương đối, nên base thiếu gạch chéo làm **rụng mất `/agent`** và mọi lời gọi
> bay ra gốc tên miền. Đó chính là màn hình **"Grok Bot couldn't finish setting up · Can't reach your
> computer"** mà máy 2 gặp: đo được `EnsureSandBox` trả **404**.
>
> Bảo người dùng "nhớ gõ dấu gạch chéo" là một cái bẫy chờ nổ lại, nên nginx nay **nhận cả hai
> dạng**. Đo lại: có gạch chéo **200**, thiếu gạch chéo **200**.

---

## T1 · Tải app

1. Trên **máy 2**, mở trình duyệt vào đúng đường link ở trên (**kèm cả phần `?k=…`**).
2. Bấm **⊞ Tải cho Windows**.

**Sẽ thấy:**

- ✅ Ngay dưới nút có dòng chữ **"Bạn đang dùng đường tải đầy đủ… bản chở cả ứng dụng (118 MB)"**.
  Dòng này là cách biết token đã ăn. **Không thấy dòng đó** nghĩa là link bị mất phần `?k=…` — quay
  lại, dán lại link đầy đủ.
- ✅ File tải về tên `Bot-Noi-Bo-Setup-*.exe`, **khoảng 118 MB**.
- ✅ Tải thẳng, **không** phải bấm "Keep". (Trước đây trang chạy trên HTTP nên Chrome giữ file lại;
  nay là HTTPS thật.)

⚠️ **Nếu file chỉ ~2 MB** thì token không ăn — đó là bản chỉ-cấu-hình, **không chạy được** trên máy
chưa có app. Kiểm lại link.

---

## T2 · Cài

1. Bấm đúp file `.exe` vừa tải.

**Sẽ thấy — và đây là màn hình trông giống lỗi nhất:**

- ⚠️ Windows hiện **"Windows protected your PC"** với một nút **Don't run** duy nhất.
  **Đây là bình thường.** Bấm chữ **More info** trước — nút **Run anyway** chỉ hiện ra sau đó.
  Nguyên nhân: bộ cài chưa ký số. Bản của hãng không bị vì họ có chứng chỉ ký số; xem
  [spike-findings.md](../reverse/spike-findings.md).
- ✅ Cửa sổ cài đặt hiện ra, chạy vài chục giây (nó đang chép ~118 MB).
- ✅ Hộp thoại hỏi **địa chỉ backend**.

2. Điền đúng: `https://cinai.app/agent/`

> Nếu bạn lỡ bấm Enter mà chưa điền, hoặc muốn đổi sau: mở file `backend.txt` trong thư mục cài đặt
> và sửa, rồi mở lại app.

---

## T3 · Mở app và đăng nhập

1. Mở app bằng lối tắt trên Desktop tên đúng là **`Bot Noi Bo`**.

> ❗ **Trên Desktop có thể có HAI icon, và chỉ một cái đúng.**
>
> | icon | của ai | mở nó thì |
> |---|---|---|
> | **`Bot Noi Bo`** | **của ta** — bộ cài chỉ tạo cái này | đặt đủ bốn biến, nói với backend của bạn |
> | `Grok Bot` | của hãng, sót lại từ lần cài trước | **không có biến nào** → nói với máy chủ của hãng |
>
> Mở nhầm cái thứ hai thì ra đúng màn hình **"Grok Bot couldn't finish setting up · Can't reach your
> computer"** — không phải vì backend hỏng, mà vì app đang gọi sang chỗ khác. Hai cửa sổ **trông y
> như nhau**, nên không phân biệt được sau khi đã mở.
>
> Nó cũng có thể **tự cập nhật** và xoá sạch bản vá, nên đừng mở.

**Kiểm chắc app đang trỏ đâu — chạy trong Command Prompt trên máy 2:**

```
type "%LOCALAPPDATA%\Programs\Bot Noi Bo\backend.txt"
curl -s -o nul -w "%%{http_code}" https://cinai.app/agent/v1/health
```

- Dòng đầu phải in **`https://cinai.app/agent/`**
- Dòng sau phải in **`200`**

Không thấy thư mục đó thì thử `%LOCALAPPDATA%\Bot Noi Bo` (bản cài 2 MB dùng đường khác). Không có
cả hai nghĩa là bộ cài chưa chạy xong — làm lại T2.

**Sẽ thấy:**

- ✅ Màn hình chào **"Your team of always-on Bots…"** với nút **Sign in**.

2. Bấm **Sign in**.

**Sẽ thấy:**

- ✅ Trình duyệt mặc định tự mở, địa chỉ là **`https://cinai.app/agent/app/?login_uuid=…`**.
- ✅ Trang hiện ô **Email** + **Mật khẩu**, có nút **Đăng nhập** và **Tạo tài khoản**.

⚠️ Nếu trình duyệt mở **`cursor.com`** thì bộ cài là bản cũ — tải lại từ T1.

---

## T4 · Tạo tài khoản rồi vào

1. Bấm **Tạo tài khoản**, điền email + mật khẩu (**từ 8 ký tự**).

**Sẽ thấy:**

- ✅ Trang đổi thành **"Xong — Quay lại ứng dụng"**.
- ✅ Quay sang cửa sổ app: sau vài giây nó **tự vào**, không phải bấm gì thêm.

> **Bạn là người đầu tiên nên đăng ký đang mở.** Sau tài khoản này nó **tự đóng** — người thứ hai
> muốn vào thì cần bật `GROKBOT2_ALLOW_REGISTER=1` trên VPS.

**Sẽ thấy trong app — và đây là ba màn hình trông như lỗi:**

- ⚠️ **Danh sách bot trống.** Đúng như vậy: kho trên VPS là kho **mới**, không phải kho trên máy 1.
  9 bot và 2.040 tin nhắn của bạn vẫn nằm nguyên trên máy 1.
- ⚠️ Panel **Plugins → Marketplace** có thể hiện *"The marketplace isn't available right now"* trong
  vài giây đầu rồi tự hiện danh sách. Đó là lúc nó còn đang hỏi backend.
- ⚠️ Panel **máy tính (computer)** trống. Backend trên VPS chưa được khai địa chỉ box — cố ý.

2. Bấm **New Bot**, đặt tên gì cũng được.

- ✅ Bot hiện ra trong thanh bên sau chưa tới một giây.

---

## T5 · Gửi một câu — **chưa chạy được, và không phải lỗi**

Gõ một câu cho bot, bạn sẽ nhận:

```
Your group's usage limit is set to $0
```

Câu này **không có trong mã nguồn dự án** — `admin.halcion.vn` trả về. Hạn mức của nhóm trên pool
đang là **0 đô**. Hai việc phải làm trước khi T5 chạy:

1. Nâng hạn mức trên pool (việc tài khoản, không sửa được bằng code).
2. Đặt `CLAUDE_POOL_KEY` vào `/opt/grokbot2/.env` trên VPS rồi `systemctl restart grokbot2-be` —
   **cố ý chưa đặt**, để không có bí mật nào bị chuyển lên VPS mà chưa hỏi.

---

## Bốn màn hình trông như lỗi mà **không phải** lỗi

| thấy gì | thật ra là |
|---|---|
| "Windows protected your PC", chỉ có nút Don't run | Bộ cài chưa ký số. **More info → Run anyway** |
| Danh sách bot trống sau khi đăng nhập | Kho trên VPS là kho mới; dữ liệu máy 1 vẫn nguyên trên máy 1 |
| "The marketplace isn't available right now" vài giây | Đang hỏi backend, sẽ tự hiện |
| Panel máy tính trống | Backend VPS chưa khai địa chỉ box — cố ý |

## Hỏng thật thì trông thế nào

| thấy gì | nguyên nhân | cách chữa |
|---|---|---|
| File tải về chỉ ~2 MB | Link mất phần `?k=…` | Dán lại link đầy đủ |
| App báo **"couldn't finish setting up · Can't reach your computer"** | **Hay gặp nhất: mở nhầm icon `Grok Bot` của hãng thay vì `Bot Noi Bo`.** Hoặc `backend.txt` trỏ sai chỗ. *(Trước 26/08 còn do thiếu gạch chéo cuối — nay nginx nhận cả hai dạng, không còn là nguyên nhân)* | Sửa thành `https://cinai.app/agent/` rồi mở lại app |
| Bấm Sign in mà trình duyệt mở **cursor.com** | Bộ cài dựng trước 26/08 06:00 | Tải lại từ T1 |
| Đăng nhập xong mà app vẫn ở màn hình Sign in | Phiên đăng nhập quá 10 phút | Bấm Sign in lại, làm lại T3–T4 |
| Trang đăng nhập **trắng** | Giao diện web trên VPS chưa dựng | Báo lại — cần `pnpm --filter @grokbot2/web build` trên VPS |

## Xong T1–T4 thì đã chứng minh được gì

- Một máy trắng tải và cài được app từ Internet, không cần chuẩn bị gì
- Ứng dụng nói chuyện được với backend đặt ở nơi khác, qua HTTPS
- Đăng nhập là **thật**: có mật khẩu, có tài khoản, và token chỉ cấp sau khi một con người duyệt

Còn lại là T5 (cần hạn mức pool) và chặng 5 (tách người dùng trên box).
