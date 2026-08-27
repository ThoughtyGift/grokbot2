#!/usr/bin/env bash
#
# Lùi về bản trước — vài giây, không dựng lại gì.
#
#   bash rollback.sh              # về bản ngay trước bản đang chạy
#   bash rollback.sh 20260827-1700  # về đúng một bản
#   bash rollback.sh --list       # xem có những bản nào
#
# Lùi được vì `deploy.sh` giữ lại năm bản gần nhất và không bao giờ đụng vào `shared/data`. Nghĩa là
# lùi mã KHÔNG lùi dữ liệu: tin nhắn, bot, routine của người dùng ở lại. Đó là điều bạn muốn trong
# hầu hết trường hợp — nhưng nếu bản mới đã đổi hình dạng dữ liệu thì lùi mã một mình có thể chưa đủ.
# `shared/data` có bản sao `.bak` xoay vòng của SQLite; xem `store.ts`.
set -euo pipefail

ROOT="${GROKBOT2_ROOT:-/opt/grokbot2}"
SERVICE="${GROKBOT2_SERVICE:-grokbot2-be}"
HEALTH_URL="${GROKBOT2_HEALTH_URL:-http://127.0.0.1:8788/gw/health}"

log() { printf '\n\033[36m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[31m[X] %s\033[0m\n' "$*" >&2; exit 1; }

CUR="$(readlink -f "$ROOT/current" 2>/dev/null || true)"
mapfile -t ALL < <(ls -1dt "$ROOT/releases"/*/ 2>/dev/null | sed 's#/$##')

if [ "${1:-}" = "--list" ]; then
  printf 'cac ban co the lui ve (moi nhat truoc):\n'
  for r in "${ALL[@]}"; do
    mark=" "; [ "$(readlink -f "$r")" = "$CUR" ] && mark="*"
    printf '  %s %s\n' "$mark" "$(basename "$r")"
  done
  printf '\n  * = dang chay\n'
  exit 0
fi

[ "${#ALL[@]}" -ge 1 ] || die "khong co ban nao trong $ROOT/releases"

if [ -n "${1:-}" ]; then
  TARGET="$ROOT/releases/$1"
  [ -d "$TARGET" ] || die "khong thay ban $1 — thu: bash rollback.sh --list"
else
  TARGET=""
  for r in "${ALL[@]}"; do
    if [ "$(readlink -f "$r")" != "$CUR" ]; then TARGET="$r"; break; fi
  done
  [ -n "$TARGET" ] || die "chi co mot ban, khong co gi de lui ve"
fi

log "lui: $(basename "$CUR") -> $(basename "$TARGET")"
ln -sfn "$TARGET" "$ROOT/current.new" && mv -Tf "$ROOT/current.new" "$ROOT/current"
systemctl restart "$SERVICE"

for i in $(seq 1 15); do
  sleep 2
  code="$(curl -s -o /dev/null -w '%{http_code}' -m 4 "$HEALTH_URL" || true)"
  if [ "$code" = "200" ]; then
    printf '\n\033[32m[v] da lui ve %s — health 200 sau %ss\033[0m\n' "$(basename "$TARGET")" "$((i*2))"
    exit 0
  fi
done

# Không tự lùi tiếp: nếu bản CŨ cũng không lên nổi thì vấn đề gần như chắc chắn nằm ngoài mã
# (dữ liệu, cấu hình, mạng), và nhảy tiếp qua các bản cũ hơn chỉ làm mờ dấu vết.
die "da doi liên ket nhung health khong len — xem: journalctl -u $SERVICE -n 50"
