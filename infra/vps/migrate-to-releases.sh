#!/usr/bin/env bash
#
# Chuyển `/opt/grokbot2` phẳng sang bố cục release — **chạy đúng một lần**.
#
#   bash migrate-to-releases.sh --dry-run   # xem sẽ làm gì, không đụng vào đâu
#   bash migrate-to-releases.sh --yes
#
# Trước:                                 Sau:
#   /opt/grokbot2/                         /opt/grokbot2/
#     services/grokbot-backend/.data  ←→     shared/data/            ← DỮ LIỆU, ngoài mọi release
#     node_modules/                          shared/node_modules/
#     .env                                   shared/.env
#     …mã…                                   releases/<stamp>/…mã…
#                                            current -> releases/<stamp>
#
# Không xoá gì. Bản cũ được **đổi tên** thành release đầu tiên, nên nếu bố cục mới có vấn đề thì
# `undo` chỉ là đổi lại systemd unit và trỏ về thư mục đó.
set -euo pipefail

ROOT="${GROKBOT2_ROOT:-/opt/grokbot2}"
SERVICE="${GROKBOT2_SERVICE:-grokbot2-be}"
UNIT="/etc/systemd/system/${SERVICE}.service"
DRY=1
[ "${1:-}" = "--yes" ] && DRY=0

log() { printf '\n\033[36m==> %s\033[0m\n' "$*"; }
run() { if [ "$DRY" = 1 ]; then printf '    [kho] %s\n' "$*"; else eval "$@"; fi }
die() { printf '\n\033[31m[X] %s\033[0m\n' "$*" >&2; exit 1; }

[ -d "$ROOT" ] || die "khong thay $ROOT"
[ -L "$ROOT/current" ] && die "da chuyen roi — $ROOT/current da la lien ket"
[ -f "$ROOT/package.json" ] || die "$ROOT khong giong cay ma grokbot2"

STAMP="$(date -u +%Y%m%d-%H%M%S)-goc"
DATA="$ROOT/services/grokbot-backend/.data"
[ -d "$DATA" ] || die "khong thay $DATA — dung lai, khong doan"

printf '\n'
printf 'nguon    : %s (%s)\n' "$ROOT" "$(du -sh "$ROOT" 2>/dev/null | cut -f1)"
printf 'du lieu  : %s (%s)\n' "$DATA" "$(du -sh "$DATA" 2>/dev/null | cut -f1)"
printf 'release  : %s\n' "$STAMP"
[ "$DRY" = 1 ] && printf '\n\033[33mCHAY KHO — khong doi gi. Them --yes de lam that.\033[0m\n'

log "1/7 dung dich vu"
run "systemctl stop '$SERVICE'"

log "2/7 dung kho tam"
run "mkdir -p '$ROOT.moi/releases' '$ROOT.moi/shared'"

log "3/7 tach DU LIEU ra khoi cay ma"
run "mv '$DATA' '$ROOT.moi/shared/data'"
for f in .env plugin-registry.json; do
  [ -f "$ROOT/$f" ] && run "mv '$ROOT/$f' '$ROOT.moi/shared/$f'"
done
[ -d "$ROOT/node_modules" ] && run "mv '$ROOT/node_modules' '$ROOT.moi/shared/node_modules'"
[ -f "$ROOT/pnpm-lock.yaml" ] && run "sha256sum '$ROOT/pnpm-lock.yaml' | cut -d' ' -f1 > '$ROOT.moi/shared/node_modules.lock-hash'"

log "4/7 ban cu thanh release dau tien"
run "mv '$ROOT' '$ROOT.moi/releases/$STAMP'"
run "mv '$ROOT.moi' '$ROOT'"

log "5/7 noi lai lien ket trong release"
run "ln -s '$ROOT/shared/data' '$ROOT/releases/$STAMP/services/grokbot-backend/.data'"
run "ln -sfn '$ROOT/shared/node_modules' '$ROOT/releases/$STAMP/node_modules'"
for f in .env plugin-registry.json; do
  run "[ -f '$ROOT/shared/$f' ] && ln -sf '$ROOT/shared/$f' '$ROOT/releases/$STAMP/$f' || true"
done
run "ln -sfn '$ROOT/releases/$STAMP' '$ROOT/current'"

log "6/7 tro systemd vao current"
run "cp '$UNIT' '$UNIT.truoc-releases'"
run "sed -i 's#^WorkingDirectory=.*#WorkingDirectory=$ROOT/current/services/grokbot-backend#' '$UNIT'"
run "sed -i 's#^ExecStart=.*#ExecStart=$ROOT/current/node_modules/.bin/tsx src/index.ts#' '$UNIT'"
run "systemctl daemon-reload"

log "7/7 chay lai va kiem"
run "systemctl start '$SERVICE'"
if [ "$DRY" = 0 ]; then
  for i in $(seq 1 15); do
    sleep 2
    code="$(curl -s -o /dev/null -w '%{http_code}' -m 4 http://127.0.0.1:8788/gw/health || true)"
    if [ "$code" = "200" ]; then
      printf '\n\033[32m[v] xong — health 200 sau %ss\033[0m\n' "$((i*2))"
      printf '    unit cu giu o %s\n' "$UNIT.truoc-releases"
      exit 0
    fi
  done
  die "health khong len — unit cu con o $UNIT.truoc-releases, cay ma o $ROOT/releases/$STAMP"
fi
