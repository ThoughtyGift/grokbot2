# Máy thứ hai — bốn thứ chỉ phần cứng thật trả lời được

> Bài E2E `e2e-may-lan-dau.mts` đã phủ **đường dây** của "người mới đăng nhập lần đầu, máy local nối
> lần đầu": vé, kênh `local-exec`, sổ máy, cô lập theo người, câu từ chối. Nó chạy trên một máy, không
> cần phần cứng thứ hai, và nó đã tìm ra một lỗ thật (bảng theo dõi §6 mục 43).
>
> Tài liệu này là **phần còn lại** — bốn thứ bài đo ấy không thể chạm tới, mỗi thứ vì một lý do khác
> nhau, và cả bốn chỉ đo được khi có một máy Windows thứ hai trong tay. Đây là T2 · T3 · T5 của
> [bảng theo dõi §5](../state/bang-theo-doi.md).

| # | thứ chưa đo được | vì sao E2E không chạm được |
|---|---|---|
| A | Bộ cài chạy trên Windows **sạch** | máy dev đã có sẵn Node, bộ vá, hồ sơ, khoá registry của các lần cài trước |
| B | Daemon **THẬT của hãng** gửi `hello` | bài đo tự gửi khung `hello` bằng `fetch` — nó đo hợp đồng, không đo binary |
| C | `computerId` do **client tự đúc** | bài đo dùng một UUID hằng số; id thật do client sinh và nhét vào keychain/hồ sơ máy |
| D | **Hai máy nối cùng lúc** (T5) | một tiến trình, một danh tính, một luồng SSE |

**Mỗi mục dưới đây có một câu hỏi, một phép đo, và một câu trả lời XANH cụ thể.** Không mục nào được
kết luận bằng "trông có vẻ chạy".

---

## 0 · Chuẩn bị (10 phút, làm trước khi ngồi vào máy 2)

| kiểm | lệnh (máy dev) | phải thấy |
|---|---|---|
| VPS đang chạy bản nào | `ssh -p 24700 root@103.75.186.63 'readlink /opt/grokbot2/current'` | một thư mục `releases/<ngày>-<giờ>` |
| bản đang phát trên feed | `curl -s "https://cinai.app/agent/updates/ban-moi?nen=windows&ver=0.0.0"` | JSON có `version` + `sha256hash` + `ten`. **Chú ý**: không kèm token thì đây là gói **cấu hình 50 KB** (`Cai-dat-…win-….cmd`), KHÔNG phải gói chở-app mà nút Tải phát ra — hai thứ khác băm |
| băm của gói nút Tải sẽ phát | `ssh -p 24700 root@103.75.186.63 'ls -t /opt/grokbot2/shared/data/dist/Bot-Noi-Bo-Setup-*.exe | head -1 | xargs sha256sum'` | một dòng — **chép lại**, đây mới là số so ở A1 |
| trang tải sống | `curl -s -o /dev/null -w "%{http_code}\n" https://cinai.app/agent/` | `200` |
| sổ máy trên VPS trước khi bắt đầu | `ssh -p 24700 root@103.75.186.63 'cat /opt/grokbot2/shared/data/may-da-biet.json'` | **chép lại nội dung này** — nó là mốc so sánh của mục C |

Ghi lại **giờ bắt đầu**. Mọi hàng mới trong sổ máy sau mốc đó là của lượt đo này.

> **Máy 2 phải trỏ vào VPS, không phải backend dev.** Bộ cài công khai đã nướng sẵn
> `backend.txt = https://cinai.app/agent/`. Nếu ai đó sửa file ấy thì cả bài đo nói về một hệ khác.

---

## A · Bộ cài trên Windows sạch

**Câu hỏi:** một người chưa từng có gì trên máy — không Node, không bộ vá, không hồ sơ — cài xong có
dùng được không, và trong bao lâu?

### Đo

1. Mở `https://cinai.app/agent/` bằng trình duyệt **trên máy 2**. Bấm nút tải.
2. Trước khi chạy: so băm với thứ feed khai.

   ```powershell
   Get-FileHash -Algorithm SHA256 "$env:USERPROFILE\Downloads\Bot-Noi-Bo-Setup-*.exe"
   ```

   Phải bằng **băm chép ở bước 0** (dòng `sha256sum` trên VPS), KHÔNG phải `sha256hash` của feed
   không-token — feed ấy khai gói cấu hình 50 KB, còn nút Tải phát gói chở-app. **Lệch là dừng**:
   không cài, đọc bảng theo dõi §7 *"cùng một số phiên bản, hai lần dựng ra hai file khác nhau"*.

   *(Đường thứ hai: feed kèm `k=<token tải bản đầy đủ>` trả thẳng `sha256hash` của gói chở-app. Token
   ấy **không được chép vào tài liệu hay commit** — đọc từ `GROKBOT2_FULL_DOWNLOAD_TOKEN` trong `.env`
   trên VPS lúc cần. `sha256sum` ở bước 0 cho cùng con số mà không phải chạm tới token.)*
3. Chạy bộ cài, bấm qua như người dùng thật (không `/VERYSILENT` — mục này đo đúng cái người dùng thấy).
4. Bấm shortcut **Bot Noi Bo** trên Desktop. Nó trỏ vào `start-bot.cmd`, **không** trỏ thẳng vào
   `Grok Bot.exe` — bốn biến môi trường nằm trong file cmd ấy, và đó là lý do không bao giờ mở exe trực tiếp.

### Xanh khi

| mốc | phải thấy |
|---|---|
| A1 | băm file tải về = băm `sha256sum` chép ở bước 0 (gói chở-app trên VPS) |
| A2 | cài xong không đòi Node, không đòi quyền admin ngoài UAC của chính bộ cài |
| A3 | `%LOCALAPPDATA%\Programs\Bot Noi Bo\backend.txt` chứa `https://cinai.app/agent/` |
| A4 | app mở ra, hiện màn đăng nhập (không phải cửa sổ trắng, không thoát trong 3 giây) |
| A5 | đăng nhập bằng một tài khoản **chưa từng dùng ở đâu**, vào được, sidebar **rỗng** (chưa có bot) |

**A5 rỗng mới là điều đáng đo.** Sidebar hiện bot của người khác là chính cái lỗ §6 mục 39, ở dạng
người dùng nhìn thấy.

### Đỏ ở đâu thì đọc gì

| triệu chứng | đọc |
|---|---|
| app mở rồi thoát ngay, 0 tiến trình | bảng theo dõi §7 `ELECTRON_RUN_AS_NODE` — nhưng trên máy sạch biến ấy không có; nếu vẫn thế thì là chuyện MỚI, ghi lại |
| màn đăng nhập trả 503 | `/app/` chưa dựng — [trien-khai.md](trien-khai.md), và cửa sức khoẻ của deploy có dò `/app/` |
| bấm shortcut không lên | `%LOCALAPPDATA%\Programs\Bot Noi Bo\start-bot.cmd`, chạy tay trong `cmd` để thấy chữ |

---

## B · Daemon THẬT của hãng gửi `hello`

**Câu hỏi:** khung `hello` mà bài E2E tự gửi có đúng thứ binary của hãng gửi không?

Đây là mục đáng giá nhất trong bốn mục, vì nó là chỗ duy nhất một giả định của ta được đối chứng bằng
mã của người khác. Cùng họ với bẫy §7 *"hành động có trong danh sách ≠ handler có trong daemon"*: một
hợp đồng ta đọc từ bundle vẫn có thể lệch với thứ chạy thật.

### Đo

Trên máy 2, sau khi đăng nhập, mở **Settings → Computer** (đó là thao tác làm daemon nối). Rồi trên VPS:

```bash
# Khung THẬT daemon vừa gửi — channels["local-exec"].recent giữ nguyên payload, đây là chỗ đọc `hello`.
# `recent` cũng đầy {"kind":"ping"} (nhịp giữ luồng) nên phải lọc.
ssh -p 24700 root@103.75.186.63 'TOK=$(cat /opt/grokbot2/shared/data/gateway-token.txt);
  curl -s http://127.0.0.1:8788/gw/__coverage -H "authorization: Bearer $TOK"' > cov.json
python -c "import json;d=json.load(open('cov.json'));r=d['channels']['local-exec']['recent'];print(json.dumps([x for x in r if any(f.get('kind')=='hello' for f in x['payload']['frames'])][:2],indent=1,ensure_ascii=False))"

# Vé nào mở luồng
python -c "import json;d=json.load(open('cov.json'));print({k:v for k,v in d['auth']['unticketedPaths'].items() if 'local-exec' in k})"
```

và hàng máy đã ghi vào sổ:

```bash
ssh -p 24700 root@103.75.186.63 'cat /opt/grokbot2/shared/data/may-da-biet.json' | python -m json.tool
```

### Xanh khi

| mốc | phải thấy |
|---|---|
| B1 | `/gw/local-exec/requests` có **1 luồng** mang `saw:"user-ticket"` — không phải `matching-bearer`, không phải `no-header` |
| B2 | hàng máy mới trong sổ có **đủ** `label` · `computerId` · `localRoot` · `terminalsFolder` — đúng bốn trường bài E2E gửi |
| B3 | hàng ấy có `owner` = authId của tài khoản vừa đăng nhập ở mục A, **không** phải danh tính mặc định |
| B4 | daemon **không** gửi thêm trường nào ta đang bỏ qua — so danh sách khoá của `hello` THẬT (lệnh đầu ở trên) với `frames[0]` trong `e2e-may-lan-dau.mts` |

**B4 là mốc dễ bỏ nhất và là mốc duy nhất có thể dạy ta điều mới.** Nếu daemon thật gửi một khoá ta
chưa đọc, chép nguyên tên khoá vào bảng theo dõi §8 trước khi quyết định có dùng nó không — "trường
có trong khung ≠ trường có người đọc", cả hai chiều.

---

## C · `computerId` do client tự đúc

**Câu hỏi:** id máy thật có hình dạng gì, có bền qua lần mở app kế tiếp không, và bảng "Current
computer" có khớp không?

### Đo

Sau mục B, đọc `computerId` của hàng mới trong sổ. Rồi **đóng app trên máy 2, mở lại**, đọc lại sổ.

### Xanh khi

| mốc | phải thấy |
|---|---|
| C1 | `computerId` là một **UUID** (8-4-4-4-12). Không phải UUID ⇒ nó đến từ một bài đo, không từ client — bẫy §7 *"bộ test GHI chứ không xoá"* |
| C2 | mở lại app: **cùng một** `computerId`, sổ **không** mọc thêm hàng thứ hai |
| C3 | Settings → Computer trên máy 2 hiện **đúng một máy**, và nó mang dấu *Current computer* |
| C4 | bảng ấy **không** hiện máy `DESKTOP-7D2FJG8` (máy dev) hay bất kỳ máy nào của người khác |

**C2 là thứ E2E vĩnh viễn không đo được**: bài đo dùng hằng số nên nó bền một cách giả tạo. Nếu id
đổi mỗi lần mở app thì sổ máy sẽ mọc dài ra theo số lần người dùng mở app, và triệu chứng chỉ lộ sau
vài ngày dưới dạng "bảng Computer có 9 cái máy tên giống nhau".

**C4 sai là chuyện nghiêm trọng, dừng và ghi lại ngay** — đó là cùng một lớp lỗi với §6 mục 43.

---

## D · Hai máy nối cùng lúc (T5)

**Câu hỏi:** hai máy cùng nối, lệnh có tới đúng máy không, và người dùng có phân biệt được chúng không?

Chỉ mục này cần **cả hai máy bật cùng lúc**, và nên làm cuối cùng.

### Đo

Để máy 2 mở app. Trên máy dev, mở app trỏ vào **cùng VPS** (không phải backend dev) — hoặc đơn giản
hơn: dùng chính máy dev như "máy A" nếu nó đã nối vào VPS.

Trên máy 2, hỏi bot một câu buộc nó chạy lệnh, ví dụ: *"chạy `hostname` trên máy của mình"*.

### Xanh khi

| mốc | phải thấy |
|---|---|
| D1 | Settings → Computer của **cùng một tài khoản** hiện **hai** máy, đúng hai tên, đúng một cái `Current` |
| D2 | bot chạy `hostname` trả về tên của **máy đang mở**, không phải máy kia |
| D3 | chỉ đích danh máy kia bằng tên ⇒ lệnh chạy trên **máy kia**, và thẻ quyền hiện trên đúng máy ấy |
| D4 | đăng nhập **tài khoản khác** trên máy 2 ⇒ bảng Computer của tài khoản ấy **rỗng**, không thấy máy nào của tài khoản trước |

**D4 lặp lại mốc 1 và 3 của E2E nhưng bằng phần cứng thật và danh tính thật.** Nó là phép đối chứng
cuối cùng cho cụm cô lập máy: bài đo nói dây đúng, mục này nói người dùng thấy đúng.

---

## 1 · Dọn sau khi đo

| thứ để lại | dọn thế nào |
|---|---|
| tài khoản thử trên VPS | để lại được — nó là bằng chứng của lượt đo; ghi authId vào bảng theo dõi |
| hàng máy trong sổ VPS | **không có cửa xoá, và cố ý không thêm** (thêm một cửa xoá chỉ để bài đo dùng là thêm một cửa cho mạo danh). Hàng ấy chỉ hiện trong bảng của chủ nó |
| app trên máy 2 | gỡ qua Apps & features nếu máy 2 là máy mượn; giữ lại nếu nó thành máy thứ hai thật |
| bot thử tạo trong lúc đo | `deleteAgents{ids:[…]}` qua gateway, hoặc xoá trong app |

## 2 · Ghi kết quả về đâu

Bốn dòng, vào [bảng theo dõi](../state/bang-theo-doi.md):

- §5 mục 2 (T2) · mục 3 (T3) · mục 4 (T5) — đóng mục nào đo xanh được
- §1 dòng `bộ cài` — thêm "đo trên máy sạch thật ngày …"
- §6 — một hàng cho lượt đo, **kết luận thôi, không nhật ký**
- §8 hoặc §7 — bất kỳ thứ gì daemon thật làm khác thứ ta đọc từ bundle

**Một mục đo đỏ đáng ghi hơn bốn mục xanh.** Bốn mục ở đây tồn tại vì chúng là chỗ duy nhất giả định
của ta gặp thế giới thật; xanh hết chỉ có nghĩa là giả định đúng, còn một mục đỏ là một thứ chưa ai
biết.
