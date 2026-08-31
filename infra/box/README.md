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
