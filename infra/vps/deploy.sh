#!/usr/bin/env bash
#
# Triển khai một bản lên VPS — bằng thư mục release + một liên kết `current`.
#
#   bash deploy.sh /tmp/grokbot2-<ref>.tar.gz
#
# ── Vì sao lại là thư mục release ────────────────────────────────────────────────────────────────
#
# Trước hôm nay, triển khai là `scp` đè lên `/opt/grokbot2` rồi `systemctl restart`. Cách đó không
# có lối lùi: bản cũ **không còn tồn tại** sau khi đè. Ngày 27/08 chuyện đó xảy ra thật ở một chỗ
# khác — bộ cài của hãng đè lên bản client đã vá và xoá sạch nó — nên đây không phải mối lo lý
# thuyết.
#
# Mỗi lần triển khai là một thư mục mới; `current` là liên kết trỏ vào bản đang chạy. Lùi = trỏ
# liên kết về chỗ cũ. Vài giây, không phải dựng lại.
#
# ── Thứ TUYỆT ĐỐI không được nằm trong release ───────────────────────────────────────────────────
#
# `services/grokbot-backend/.data` giữ SQLite, khoá cổng, khoá JWT, đính kèm — 13 MB trạng thái
# thật. Trong cây mã cũ nó nằm ngay giữa mã nguồn, nên một cơ chế release ngây thơ sẽ tạo thư mục
# mới rồi **bỏ lại toàn bộ dữ liệu ở bản cũ**: người dùng đăng nhập lại thấy trống trơn, và cứ mỗi
# lần lùi lại nhảy về một tập dữ liệu khác. Nên nó sống ở `shared/data` và mỗi release chỉ có một
# liên kết trỏ tới. Cùng lối cho `node_modules` (146 MB) — nhưng vì tốc độ, không vì dữ liệu.
#
# ── Cửa sức khoẻ ─────────────────────────────────────────────────────────────────────────────────
#
# Đổi liên kết rồi khởi động lại là chưa xong. Script tự hỏi backend vài câu; **không đạt thì nó tự
# lùi**. Một lần triển khai hỏng mà không ai biết thì tệ hơn một lần không triển khai được.
set -euo pipefail

ROOT="${GROKBOT2_ROOT:-/opt/grokbot2}"
SERVICE="${GROKBOT2_SERVICE:-grokbot2-be}"
HEALTH_URL="${GROKBOT2_HEALTH_URL:-http://127.0.0.1:8788/gw/health}"
KEEP="${GROKBOT2_KEEP_RELEASES:-5}"
TARBALL="${1:?can mot duong dan .tar.gz}"

log() { printf '\n\033[36m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[31m[X] %s\033[0m\n' "$*" >&2; exit 1; }

[ -f "$TARBALL" ] || die "khong thay goi: $TARBALL"
[ -d "$ROOT/shared/data" ] || die "chua co $ROOT/shared/data — chay migrate-to-releases.sh mot lan truoc"

STAMP="$(date -u +%Y%m%d-%H%M%S)"
NEW="$ROOT/releases/$STAMP"
PREV="$(readlink -f "$ROOT/current" 2>/dev/null || true)"

log "bung goi vao $NEW"
mkdir -p "$NEW"
tar -xzf "$TARBALL" -C "$NEW"
# Gói có thể có một lớp thư mục bọc ngoài; nếu vậy thì kéo nội dung lên một cấp.
if [ ! -f "$NEW/package.json" ] && [ "$(find "$NEW" -maxdepth 1 -mindepth 1 -type d | wc -l)" = 1 ]; then
  inner="$(find "$NEW" -maxdepth 1 -mindepth 1 -type d)"
  shopt -s dotglob; mv "$inner"/* "$NEW"/; shopt -u dotglob; rmdir "$inner"
fi
[ -f "$NEW/package.json" ] || die "goi khong dung hinh dang: thieu package.json"

log "noi trang thai dung chung"
# .data — DỮ LIỆU. Không bao giờ chép, không bao giờ xoá, chỉ trỏ tới.
mkdir -p "$NEW/services/grokbot-backend"
rm -rf "$NEW/services/grokbot-backend/.data"
ln -s "$ROOT/shared/data" "$NEW/services/grokbot-backend/.data"
# .env — cấu hình của MÁY này, không phải của kho mã. Cùng lý do.
[ -f "$ROOT/shared/.env" ] && ln -sf "$ROOT/shared/.env" "$NEW/.env"
# plugin-registry.json — danh mục plugin, cũng là cấu hình máy.
[ -f "$ROOT/shared/plugin-registry.json" ] && ln -sf "$ROOT/shared/plugin-registry.json" "$NEW/plugin-registry.json"

log "phu thuoc"
# **Luôn `pnpm install` trong release mới, không dùng chung `node_modules`.**
#
# Bản đầu của script này chỉ trỏ một liên kết vào `shared/node_modules` khi khoá phụ thuộc không
# đổi. Nó gãy ngay lần chạy thật đầu tiên: pnpm workspace cần `node_modules` **trong từng gói**
# (`packages/*/node_modules`), không chỉ ở gốc — build dừng với "Local package.json exists, but
# node_modules missing".
#
# Cài lại mỗi lần nghe như đắt, nhưng pnpm liên kết cứng từ kho chung của nó, nên lần thứ hai trở đi
# gần như không tốn đĩa lẫn thời gian. Đó là lý do pnpm tồn tại.
( cd "$NEW" && pnpm install --frozen-lockfile --prod=false 2>&1 | tail -3 ) || die "cai phu thuoc that bai"

log "dung goi (packages/*)"
( cd "$NEW" && pnpm -r --filter './packages/*' build 2>&1 | tail -5 ) || die "build that bai"

# **Giao dien dang nhap.** Bo qua dong nay la ca duong DANG NHAP chet, va chet o cho xa nhat khoi
# nguyen nhan: app desktop mo `{backend}/loginDeepControl`, backend chuyen huong vao `/app/`, va
# `/app/` tra 503 "Giao dien web chua duoc dung" — mot cau viet cho LAP TRINH VIEN, hien ra truoc
# mat NGUOI DUNG CUOI vua tai app ve.
#
# Vi sao no thoat duoc lau the: `dist/` nam trong `.gitignore`, `git archive` chi lay file da theo
# doi, va dong build ngay tren chi loc `./packages/*`. Ba thu deu dung viec cua chung, va khoang
# trong nam giua chung. Do 03/09 tren cinai.app/agent: HTTP 503, tren MAY THU TU cua nguoi dung.
#
# `--if-present` de mot ban khong co script `build` khong lam do ca lan trien khai.
log "dung giao dien dang nhap (apps/grokbot-web)"
( cd "$NEW" && pnpm --filter @grokbot2/web build 2>&1 | tail -5 ) || die "build web that bai"
[ -f "$NEW/apps/grokbot-web/dist/index.html" ] || die "build web xong ma khong co dist/index.html"

log "doi liên ket current -> $STAMP"
ln -sfn "$NEW" "$ROOT/current.new" && mv -Tf "$ROOT/current.new" "$ROOT/current"

log "khoi dong lai $SERVICE"
systemctl restart "$SERVICE"

log "cua suc khoe"
ok=0
for i in $(seq 1 20); do
  sleep 2
  code="$(curl -s -o /dev/null -w '%{http_code}' -m 4 "$HEALTH_URL" || true)"
  if [ "$code" = "200" ]; then ok=1; echo "    $HEALTH_URL = 200 sau $((i*2))s"; break; fi
done

# **Cua thu HAI: duong dang nhap.**
#
# `/health` xanh khong noi gi ve viec nguoi dung co dang nhap duoc khong. Ngay 03/09 backend tra
# `/health` = 200 suot trong khi `/agent/app/` tra 503, va khong ai biet cho toi luc mot nguoi that
# cai app tren may thu tu roi bam Dang nhap. Mot cua suc khoe chi kiem thu no biet kiem la mot cua
# se bo lot dung thu no khong biet.
#
# Chi CANH BAO, khong tu lui: mot bo may cu chua co `apps/grokbot-web` van dang chay duoc, va lui
# ban vi mot canh bao thi con hai hon.
if [ "$ok" = "1" ]; then
  # Dat thang, khong cat tu HEALTH_URL: HEALTH_URL la `.../gw/health`, nen mot phep cat "bo /health"
  # ra `.../gw/app/` — mot duong khong ton tai, va cua se im lang bao 404 thay vi bao dung thu can bao.
  app_code="$(curl -s -o /dev/null -w '%{http_code}' -m 4 "${GROKBOT2_APP_URL:-http://127.0.0.1:8788/app/}" || true)"
  if [ "$app_code" = "503" ]; then
    printf '\033[33m[!] /app/ = 503 — giao dien dang nhap CHUA DUNG. Nguoi dung se khong dang nhap duoc.\033[0m\n'
  else
    echo "    /app/ = $app_code"
  fi
fi

if [ "$ok" != "1" ]; then
  printf '\n\033[31m[X] khong dat cua suc khoe — TU LUI\033[0m\n'
  if [ -n "$PREV" ] && [ -d "$PREV" ]; then
    ln -sfn "$PREV" "$ROOT/current.new" && mv -Tf "$ROOT/current.new" "$ROOT/current"
    systemctl restart "$SERVICE"
    sleep 4
    back="$(curl -s -o /dev/null -w '%{http_code}' -m 4 "$HEALTH_URL" || true)"
    printf '    da lui ve %s (health=%s)\n' "$(basename "$PREV")" "$back"
  else
    printf '    KHONG CO ban truoc de lui ve — dich vu dang hong, xem: journalctl -u %s -n 50\n' "$SERVICE"
  fi
  exit 1
fi

# Công cụ vận hành sống NGOÀI release.
#
# Bẫy này bắt được khi thử lùi thật: lùi về một bản cũ hơn ngày viết `rollback.sh` thì
# `current/infra/vps/rollback.sh` **không còn tồn tại** — tức vừa lùi xong là mất luôn cái nút để
# lùi tiếp. Công cụ phải ở chỗ không đổi theo bản đang chạy, và luôn là bản mới nhất.
log "cap nhat cong cu van hanh -> $ROOT/bin"
mkdir -p "$ROOT/bin"
for t in deploy.sh rollback.sh; do
  [ -f "$NEW/infra/vps/$t" ] && install -m 755 "$NEW/infra/vps/$t" "$ROOT/bin/$t"
done

# Dọn bản cũ — GIỮ LẠI `$KEEP` bản gần nhất, vì lối lùi chỉ có giá trị khi bản cũ còn đó.
log "don ban cu (giu $KEEP)"
ls -1dt "$ROOT/releases"/*/ 2>/dev/null | tail -n +"$((KEEP+1))" | while read -r old; do
  [ "$(readlink -f "$old")" = "$(readlink -f "$ROOT/current")" ] && continue
  echo "    xoa $(basename "$old")"
  rm -rf "$old"
done

printf '\n\033[32m[v] xong — dang chay %s\033[0m\n' "$STAMP"
printf '    lui nhanh: bash %s/current/infra/vps/rollback.sh\n' "$ROOT"
