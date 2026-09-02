#!/bin/sh
# Đảm bảo CHROME CỦA MÌNH đang chạy, có WebGL, và mở CDP. Gọi bao nhiêu lần cũng được.
#
# ── Vì sao cần một Chrome riêng, trong khi box đã có sẵn một con ────────────────────────────────
#
# Chrome ta đang lái (CDP 9223) do `flow-chrome@.service` bật dưới user **box**, và nó **không có
# WebGL**. Đo A/B ngày 02/09 trên cùng box, cùng `/usr/bin/google-chrome`:
#
#   --headless=new          , không cờ  → webgl2 CÓ
#   headful (DISPLAY=:77)   , không cờ  → webgl2 KHÔNG   ← đúng con 9223
#   headful + 3 cờ dưới đây             → webgl2 CÓ
#
# Chrome ≥119 bỏ fallback SwiftShader ngầm, nên headful dưới Xvfb phải XIN bằng cờ. Không sửa được
# tại chỗ: tiến trình của user khác, và `sudo` trên box này đòi mật khẩu.
#
# Không WebGL không chỉ làm lệch một ca đo — nó làm bot MÙ với cả một lớp trang mà bot này được
# dùng cho: CapCut Web, Canva, Figma, mọi editor video/thiết kế.
#
# ── Ba chỗ đã trả giá, chép từ obs-dam-bao.sh vì cùng họ ────────────────────────────────────────
#
#   · `pkill -f` TỰ SÁT: daemon chạy script qua `bash -lc "<toàn bộ nội dung>"`, nên mọi chuỗi viết
#     trong script nằm trong cmdline của chính nó. Ở đây còn nguy hơn: `pkill -f chrome` trên box
#     DÙNG CHUNG sẽ giết Chrome của user `box` và của `root` (15 + 58 tiến trình, không phải của
#     mình). Script này KHÔNG pkill gì cả — nó chỉ kiểm cổng và bật nếu chưa có.
#   · Chrome ăn ~300 MB. Sức chứa box bị RAM chặn trước đĩa (14 bot), nên đây là bật-khi-cần, không
#     phải service thường trực — và box không có systemd cấp user (`XDG_RUNTIME_DIR` trống).
#   · Kho dữ liệu phải nằm trong HOME của mình. `/home/box/...` là mode 700 của user khác.

CONG="${CHROME_CDP_PORT:-9224}"
KHO="$HOME/.config/grokbot2-chrome"
BIN=/usr/bin/google-chrome
: "${DISPLAY:=:77}"
export DISPLAY

mo_cong() { (ss -lnt 2>/dev/null || netstat -lnt 2>/dev/null) | grep -q ":$CONG"; }

if [ ! -x "$BIN" ]; then
  echo "THIEU: $BIN không có hoặc không chạy được"
  exit 2
fi

if mo_cong; then
  echo "SAN-SANG: CDP $CONG đã mở"
  exit 0
fi

mkdir -p "$KHO"

# Ba cờ, và cả ba đều cần — đo 02/09: bỏ `--enable-unsafe-swiftshader` thì `webgl2` về KHÔNG.
#
# `--no-first-run` + `--no-default-browser-check`: Chrome mới lần đầu mở tab chào mừng và một hộp
# thoại, cả hai treo trên Xvfb vì không ai bấm — cùng bệnh với zenity của OBS AppImage.
nohup "$BIN" \
  --no-first-run \
  --no-default-browser-check \
  --disable-component-update \
  --disable-background-networking \
  --user-data-dir="$KHO" \
  --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port="$CONG" \
  --enable-unsafe-swiftshader \
  --use-gl=angle \
  --use-angle=swiftshader \
  --window-position=80,40 \
  --window-size=1280,800 \
  about:blank \
  > "$KHO/chrome.log" 2>&1 &

# Chờ ĐIỀU KIỆN, không ngủ một con số. Một mốc ngủ cố định luôn sai theo một trong hai hướng.
i=0
while [ "$i" -lt 30 ]; do
  if mo_cong; then
    echo "DA-BAT: CDP $CONG mở sau ${i}s (kho $KHO)"
    exit 0
  fi
  i=$((i + 1))
  sleep 1
done

echo "HONG: bật rồi mà CDP $CONG không mở sau 30s — xem $KHO/chrome.log"
tail -5 "$KHO/chrome.log" 2>/dev/null
exit 1
