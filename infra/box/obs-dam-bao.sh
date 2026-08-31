#!/bin/sh
# Đảm bảo OBS đang chạy và websocket 4455 mở. Gọi bao nhiêu lần cũng được.
#
# ── Vì sao KHÔNG phải một service thường trực ──────────────────────────────────────────────────
#
# Hai lý do, cả hai đo được:
#
#   1. Box không có systemd cấp user — `XDG_RUNTIME_DIR` trống, `systemctl --user` báo "Failed to
#      connect to bus", `loginctl` báo user 1004 không lingering. Bật lingering cần root, mà trên
#      box này `sudo` đòi mật khẩu.
#   2. OBS ăn ~300 MB. Sức chứa box bị RAM chặn trước đĩa (14 bot, không phải 37), nên giữ OBS chạy
#      suốt ngày là lấy chỗ của một con bot để đợi một việc mỗi tuần làm một lần.
#
# Nên: khởi động khi cần, và cái "khi cần" phải rẻ + an toàn khi gọi lặp.
#
# ── Ba chỗ đã trả giá, đều nằm trong file này ──────────────────────────────────────────────────
#
#   · `pkill -f` tự sát: daemon chạy script qua `bash -lc "<toàn bộ nội dung>"`, nên mọi chuỗi viết
#     trong script đều nằm trong cmdline của chính nó. Biểu hiện: exit 1, không một dòng output.
#     Dùng `pkill -x` (so TÊN tiến trình).
#   · AppImage mở hộp thoại zenity "Allow obs.AppImage to check for updates?" và treo trên Xvfb vì
#     không ai bấm. Phải dẹp LIÊN TỤC trong lúc chờ, không phải dẹp một lần rồi hy vọng đúng lúc.
#   · Profile mới không có `FilePath` thì `StartRecord` trả "thành công" mà không ghi gì, và chỉ
#     `StopRecord` mới lộ bằng mã 501. Nên script này cũng kiểm profile, không chỉ kiểm cổng.

CFG="$HOME/.config/obs-studio"
WS="$CFG/plugin_config/obs-websocket"
APP="$HOME/apps/obs.AppImage"

mo_cong() { (ss -lnt 2>/dev/null || netstat -lnt 2>/dev/null) | grep -q ':4455'; }

if [ ! -x "$APP" ]; then
  echo "THIEU: $APP chưa có hoặc không chạy được"
  exit 2
fi

# Đường lưu bản ghi phải tồn tại TRƯỚC khi OBS ghi, nếu không nó im lặng không ghi gì.
mkdir -p "$HOME/quay"
if ! grep -q '^FilePath=' "$CFG/basic/profiles/Untitled/basic.ini" 2>/dev/null; then
  echo "THIEU: profile Untitled chưa có FilePath — chạy obs-cfg trước"
  exit 2
fi
if [ ! -s "$WS/password.txt" ]; then
  echo "THIEU: chưa có mật khẩu websocket ($WS/password.txt)"
  exit 2
fi

if mo_cong; then
  echo "SAN-SANG: OBS đang chạy, websocket 4455 đã mở (không khởi động lại)"
  exit 0
fi

# Tới đây nghĩa là cổng chưa mở. Có thể còn tiến trình OBS cũ treo ở hộp thoại — dọn hết rồi dựng
# lại một lần, thay vì chồng thêm một tiến trình nữa lên mớ cũ (đã đo: chồng tới 3 tiến trình thì
# cổng không bao giờ lên).
# Dừng SẠCH: SIGTERM rồi chờ. `kill -9` để dành cho trường hợp cùng lắm, vì nó là NGUYÊN NHÂN của
# hộp thoại "Crash or unclean shutdown detected" ở lần chạy sau — và hộp thoại đó treo trên Xvfb,
# tức một lần giết thô làm hỏng đúng lần khởi động kế tiếp.
pkill -x zenity 2>/dev/null
pkill -x obs 2>/dev/null
pkill -x obs.AppImage 2>/dev/null
j=0
while [ "$j" -lt 8 ] && pgrep -x obs >/dev/null; do sleep 2; j=$((j + 1)); done
if pgrep -x obs >/dev/null; then
  echo "canh-bao: OBS không thoát sau 16s, phải giết thô (lần sau sẽ gặp hộp thoại crash)"
  pgrep -x obs | while read -r pid; do kill -9 "$pid" 2>/dev/null; done
  sleep 2
fi

cd "$HOME/apps" || exit 2
# `--multi` là cờ DUY NHẤT khác giữa lần khởi động thành công đầu tiên và những lần im lặng sau đó:
# nó tắt hộp thoại "đang có instance khác" — một hộp thoại nữa treo trên Xvfb vì không ai bấm.
# `--disable-shutdown-check` đã bỏ: bản này KHÔNG có cờ đó (`--help` chỉ có --safe-mode,
# --disable-updater, --disable-missing-files-check), nên nó chỉ là một chuỗi bị lờ đi.
# TUYỆT ĐỐI không dùng --safe-mode: help ghi rõ nó "disables third-party plugins, scripting, and
# WebSockets" — tức tắt đúng thứ ta cần.
DISPLAY=:77 setsid "$APP" --multi --disable-updater --disable-missing-files-check --profile Untitled --collection Untitled > "$HOME/apps/obs-chay.log" 2>&1 < /dev/null &

i=0
while [ "$i" -lt 25 ]; do
  sleep 2
  pkill -x zenity 2>/dev/null
  if mo_cong; then
    echo "DA-BAT: OBS lên sau $(( (i + 1) * 2 ))s, websocket 4455 mở"
    exit 0
  fi
  i=$((i + 1))
done

echo "HONG: chờ 50s mà cổng 4455 không mở. 12 dòng log cuối:"
tail -12 "$HOME/apps/obs-chay.log" 2>/dev/null | tr -d '\000'
exit 1
