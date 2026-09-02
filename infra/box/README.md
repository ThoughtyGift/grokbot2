# OBS trên box Linux — cài, chạy, quay

Ba script chạy **trên box** (`gb2u003@…`, Ubuntu 20.04, không root). Chúng có mặt ở đây vì bản trên
box nằm ngoài git: một lần dựng lại box là mất hết, và mấy chỗ vấp bên dưới thì đắt để tìm lại.

| script | làm gì |
|---|---|
| `obs-cai-dat.sh` | dựng profile `Untitled` + bật websocket 4455 có mật khẩu. Chạy **một lần** |
| `obs-dam-bao.sh` | đảm bảo OBS đang chạy và cổng 4455 mở. Gọi bao nhiêu lần cũng được |
| `obs-ws.mjs` | điều khiển OBS qua websocket: `node obs-ws.mjs quay 6` · `trangthai` |

Cài lên box: đẩy file vào `~/bin/obs-dam-bao` (chmod +x) và `~/apps/obs-ws.mjs`. Bản OBS là
AppImage `anylinux` 32.2.2 tải từ `pkgforge-dev/OBS-Studio-AppImage`, đặt ở `~/apps/obs.AppImage`.

## Vì sao KHÔNG phải một service thường trực

Hai lý do, cả hai đo được:

1. **Box không có systemd cấp user.** `XDG_RUNTIME_DIR` trống, `systemctl --user` báo *Failed to
   connect to bus*, `loginctl` báo user 1004 không lingering. Bật lingering cần root, mà `sudo`
   trên box này đòi mật khẩu.
2. **OBS ăn ~300 MB.** Sức chứa box bị RAM chặn trước đĩa (14 bot, không phải 37), nên giữ OBS chạy
   suốt ngày là lấy chỗ của một con bot để chờ một việc mỗi tuần làm một lần.

Nên hình dạng đúng là một lệnh **idempotent** gọi khi cần, không phải một unit luôn sống.

## Năm chỗ đã vấp — tất cả đều IM LẶNG

- **`xshm_input` sai tên.** Kind thật là `xshm_input_v2`; sai thì `CreateInput` báo *input kind is
  not supported*.
- **Profile không có `[SimpleOutput]` thì `StartRecord` trả "thành công" mà không ghi gì**, và chỉ
  `StopRecord` mới lộ bằng mã `501 OutputNotRunning`. Lần đầu tôi kết luận `SetProfileParameter`
  "chỉ đổi trong bộ nhớ nên vô dụng" — **sai**: nó vô dụng khi profile chưa có mục đó *chút nào*.
  Dựng profile một lần bằng `obs-cai-dat.sh` (viết thẳng `basic.ini`, lúc OBS đang TẮT), rồi từ đó
  API đặt được bình thường.
- **mp4 chỉ hoàn tất khi output đóng.** Đọc sớm thì `ffprobe` báo *moov atom not found* — file có,
  dung lượng có, ruột rỗng. Cùng lý do, `ls` ngay sau khi lệnh quay in đường dẫn có thể chưa thấy
  file: nó xuất hiện vài giây sau.
- **Đường lưu phải nằm TRONG gốc làm việc** (`~/workspace/quay`), và phải đặt qua
  `SetProfileParameter` mỗi lần quay chứ không sửa `basic.ini`: OBS ghi lại profile khi thoát nên
  mọi thay đổi trên file đều bị ghi đè. Đo bằng một lượt thật: với `~/quay`, bot quay xong không xem
  lại được (`watch_video` báo "ngoài gốc làm việc"), phải thử đường tương đối rồi tự copy sang
  workspace — ba bước lách cho một việc lẽ ra không có ma sát nào.
- **`pkill -f` tự sát.** Daemon chạy script qua `bash -lc "<toàn bộ nội dung>"`, nên mọi chuỗi viết
  trong script đều nằm trong cmdline của chính nó: pattern khớp, script chết trước khi làm gì.
  Biểu hiện là `exit 1` và không một dòng output. Dùng `pkill -x` (so **tên** tiến trình).
- **`--multi` là cờ quyết định.** Không có nó, OBS dựng lên rồi im — cổng 4455 không mở, log không
  báo lỗi gì. Nó tắt hộp thoại "đang có instance khác", và mọi hộp thoại đều treo trên Xvfb vì
  không ai bấm. Cùng lý do, script dẹp `zenity` **liên tục** trong lúc chờ (AppImage hỏi
  *"Allow obs.AppImage to check for updates?"*), không phải dẹp một lần rồi hy vọng đúng thời điểm.

**Không bao giờ dùng `--safe-mode`**: `--help` ghi rõ nó *disables third-party plugins, scripting,
and WebSockets* — tức tắt đúng thứ ta cần. `--disable-shutdown-check` thì **không tồn tại** ở bản
này; truyền vào chỉ là một chuỗi bị lờ đi.

`kill -9` là nguyên nhân của hộp thoại *"Crash or unclean shutdown detected"* ở lần chạy sau, nên
script dừng bằng SIGTERM và chờ tới 16 giây trước khi giết thô — và nói ra khi phải giết thô.

## Đo được gì

```
OBS Studio 32.2.2 · websocket 5.7.4 · Ubuntu 20.04.6 · glibc 2.31 · không cần root
nguồn xshm_input_v2 · Geometry 1920x1080 @ 0,0
obs-dam-bao lần 1 → DA-BAT: OBS lên sau 4s, websocket 4455 mở
obs-dam-bao lần 2,3 → SAN-SANG (không khởi động lại)
quay 6s → h264 1280x720 + aac · 7,5 giây · 245 KB, ffprobe đọc được ngay
```


## WebGL trên box: thiếu vì HEADFUL, và hai cờ chữa được (đo 02/09)

Case 21 của bộ parity lệch vì bot mở CapCut Web rồi báo "chặn vì thiếu WebGL2". Đo trực tiếp trên
Chrome ta đang lái (CDP 9223): `webgl: KHÔNG · webgl2: KHÔNG`. Nhưng nguyên nhân **không phải box
không có khả năng** — A/B trên cùng box, cùng `/usr/bin/google-chrome`:

| chế độ | cờ | webgl2 | renderer |
|---|---|---|---|
| `--headless=new` | không | **CÓ** | ANGLE / Vulkan 1.3.0 / SwiftShader (Subzero) |
| **headful** (`DISPLAY=:77`) | không | **KHÔNG** | — |
| **headful** | `--enable-unsafe-swiftshader --use-gl=angle --use-angle=swiftshader` | **CÓ** | như trên |

Tức Chrome ta lái chạy headful dưới Xvfb, và ở chế độ đó Chrome ≥119 không tự rơi về SwiftShader nữa
— phải xin bằng cờ.

**Vì sao chưa vá được tại chỗ:** Chrome 9223 do `flow-chrome@.service` bật dưới user **`box`**
(`/home/box/.config/grok-chrome-77`, mode 700), còn ta là `gb2u003` và `sudo` đòi mật khẩu. Không đổi
được cờ của tiến trình người khác. Đường trong quyền của mình: **tự bật Chrome của `gb2u003`** kèm hai
cờ trên rồi trỏ `GROKBOT2_BROWSER_CDP` vào nó — đã thử chạy được (cổng 9226, `webgl2=CO`), nhưng đó là
quyết định hạ tầng "ai sở hữu trình duyệt bot lái", không phải một cờ thêm vào.

**Cách đo lại mà không cần hầm ssh:** trang tự đặt `document.title` thành kết quả, rồi
`curl 127.0.0.1:<cổng>/json/list | grep '"title"'`. Endpoint HTTP của CDP báo title từng target, nên
không cần WebSocket — hữu ích cho mọi cổng chưa nằm trong hầm.


### Chrome của MÌNH, có WebGL — `chrome-dam-bao.sh` (02/09)

```
sh chrome-dam-bao.sh                 # idempotent; CHROME_CDP_PORT mặc định 9224
npx tsx --env-file=.env services/grokbot-backend/scripts/chrome-webgl.mts   # bật + ĐO
```

Đo được, qua hầm, từ đúng vị trí backend nhìn:

| cổng | chủ | webgl2 | renderer |
|---|---|---|---|
| 9223 | user `box`, `flow-chrome@.service` | **KHÔNG** | — |
| **9224** | **`gb2u003` (của ta)** | **CÓ** | ANGLE / Vulkan 1.3.0 / SwiftShader (Subzero) |

**Chưa đổi `GROKBOT2_BROWSER_CDP`, và đây là lý do — một đánh đổi thật, không phải sự cẩn thận suông:**
con 9223 **được supervise** (`flow-chrome@.service` bật lại nếu chết), con 9224 thì **không** — box
không có systemd cấp user (`XDG_RUNTIME_DIR` trống, `systemctl --user` không nối được bus, bật
lingering cần root mà `sudo` đòi mật khẩu). Đổi ngay bây giờ là đánh đổi "bot mù WebGL" lấy "bot có
thể mất hẳn trình duyệt", và vế thứ hai tệ hơn.

Nên bước còn lại **không phải sửa `.env`** mà là cho `browser.ts` tự lành: khi CDP dùng chung không
trả lời thì gọi `chrome-dam-bao.sh` rồi thử lại — đúng khuôn `obs-dam-bao.sh` đã dùng cho OBS. Có
vế đó rồi thì đổi `.env` mới an toàn.

Hầm: `box-tunnel.ps1 -LocalPort 9224 -RemotePort 9224 -Slots 0` (tham số đã có sẵn, không cần đổi mã).
Trên VPS thì backend chạy CÙNG box nên không cần hầm.
