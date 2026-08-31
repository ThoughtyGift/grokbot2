set -e
CFG="$HOME/.config/obs-studio"
mkdir -p "$CFG/basic/profiles/Untitled" "$CFG/basic/scenes" "$HOME/quay"

# Profile đầy đủ. `SetProfileParameter` qua websocket chỉ đổi trong bộ nhớ và OBS ghi ra đĩa lúc
# thoát, nên với một OBS chạy nền thì đường lưu không bao giờ tồn tại — và `StartRecord` khi ấy trả
# về "thành công" rồi không làm gì, chỉ `StopRecord` mới lộ bằng mã 501.
cat > "$CFG/basic/profiles/Untitled/basic.ini" <<'INI'
[General]
Name=Untitled

[Output]
Mode=Simple

[SimpleOutput]
FilePath=/home/gb2u003/quay
RecFormat2=mp4
RecQuality=Small
RecEncoder=x264
VBitrate=2500
ABitrate=160

[Video]
BaseCX=1920
BaseCY=1080
OutputCX=1280
OutputCY=720
FPSType=0
FPSCommon=30

[Audio]
SampleRate=48000
ChannelSetup=Stereo
INI

# global.ini phải trỏ vào profile đó, nếu không OBS dựng một profile trắng mỗi lần chạy.
cat > "$CFG/global.ini" <<'INI'
[General]
FirstRun=true
EnableAutoUpdates=false
ConfirmOnExit=false

[Basic]
Profile=Untitled
ProfileDir=Untitled
SceneCollection=Untitled
SceneCollectionFile=Untitled
INI

pkill -x zenity 2>/dev/null || true
# `pkill -f` là bẫy ở đây: daemon chạy script qua `bash -lc "<toàn bộ nội dung>"`, nên mọi chuỗi
# viết trong script đều nằm trong cmdline của chính nó — pattern khớp, và script tự giết mình
# trước khi làm được gì (biểu hiện: exit 1, không một dòng output). `-x` so TÊN tiến trình nên an toàn.
pkill -x obs 2>/dev/null || true
pkill -x obs.AppImage 2>/dev/null || true
sleep 3
cd "$HOME/apps"
rm -f obs-chay.log
# APPIMAGE_EXTRACT_AND_RUN tránh cả FUSE lẫn hộp thoại updater của AppImage — hộp thoại đó treo
# trên Xvfb vì không có ai bấm.
DISPLAY=:77 APPIMAGE_EXTRACT_AND_RUN=0 NO_CLEANUP=1 setsid ./obs.AppImage \
  --disable-updater --disable-shutdown-check --profile Untitled --collection Untitled \
  > obs-chay.log 2>&1 < /dev/null &
sleep 22
pkill -x zenity 2>/dev/null || true
echo "--- tiến trình ---"
pgrep -x obs > /dev/null && echo 'obs đang chạy' || echo 'obs KHÔNG chạy'
echo "--- profile OBS đọc được ---"
grep -iE "Current Profile|Current Scene Collection" obs-chay.log | head -4
