#!/usr/bin/env python3
"""Chuyển chủ sở hữu dữ liệu grokbot2 từ một `authId` sang một `authId` khác.

    python3 chuyen-chu.py --tu 'auth0|grokbot2-user' --sang 'cinapi|<id>'          # CHẠY KHÔ
    python3 chuyen-chu.py --tu 'auth0|grokbot2-user' --sang 'cinapi|<id>' --that   # ghi thật

Vì sao cần nó (Bước 3 của [cinapi-merge.md](../../docs/plan/cinapi-merge.md)): khoá sở hữu của
grokbot2 là MỘT CHUỖI, nên đổi danh tính đăng nhập là đổi khoá ấy. Sổ máy tự lành (thiết kế bỏ hàng
không chủ lúc nạp, daemon đăng ký lại) — **bot thì không**.

Ba tính chất được viết vào hình dạng script, không vào lời dặn:

1. **Mặc định là CHẠY KHÔ.** Muốn ghi phải gõ `--that`. Một phép đổi chủ chạy nhầm thì không có
   nút undo nào ngoài bản lưu.
2. **Từ chối chạy khi backend còn sống.** Kho SQLite có đúng một cửa ghi là tiến trình backend; ghi
   từ ngoài trong lúc nó chạy là tự đẻ ra một nguồn sự thật thứ hai. Bỏ qua bằng `--du-biet-rui-ro`
   chỉ khi bạn đã tự hạ nó bằng cách khác.
3. **Chạy lại được.** Lượt thứ hai thấy 0 hàng mang chủ cũ thì nó nói "không có gì để làm" chứ không
   ném — vì một script di trú mà chạy hai lần thì hỏng là một script không ai dám chạy lần một.

Và hai chỗ KHÔNG phải "đổi tên" mà là "gộp", vì lược đồ có ràng buộc (đo 09/09):
`users.auth_id` là PRIMARY KEY, `usage(auth_id, day)` cũng vậy. Nếu người dùng đã ĐĂNG NHẬP bằng
danh tính mới trước khi script chạy thì `ensureUser` đã đẻ một hàng cho chủ mới ⇒ `UPDATE` sẽ vướng
khoá. Nên `users` giữ hàng ĐÍCH và bỏ hàng cũ, `usage` thì **cộng dồn** theo ngày.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import time

# Gốc đọc từ env chứ không ghim hằng — cùng quy ước `dataDir()` của sản phẩm, và đó là điều kiện
# để chạy thử script này trên một BẢN CHÉP trước khi cho nó gần dữ liệu thật (§7: một phép di trú
# phải được kiểm ở nơi đã biết đáp án trước khi dùng ở nơi chưa biết).
GOC = os.environ.get("GROKBOT2_SHARED", "/opt/grokbot2/shared")
KHO = os.path.join(GOC, "data")
DB = os.path.join(KHO, "grokbot.sqlite")

# Bảy bảng mang `owner_id`, đo bằng `pragma table_info` chứ không chép tay — xem `bangCoChu()`.
COT_CHU = ("owner_id", "auth_id")


def safe(auth_id: str) -> str:
    """Bản chép ĐÚNG của `safe()` trong `src/bot-templates.ts` — tên tệp kho mẫu suy từ chủ.

    Chép thay vì gọi vì script này chạy trên VPS bằng python3; nhưng nó được kiểm bằng cách đối
    chiếu với tệp CÓ THẬT trên đĩa (`auth0_grokbot2-user.json`), không bằng cách tin lời chép.
    """
    return "".join(c if (c.isascii() and (c.isalnum() or c in "_-")) else "_" for c in auth_id)


def beDangSong() -> bool:
    try:
        r = subprocess.run(["systemctl", "is-active", "grokbot2-be"], capture_output=True, text=True)
        return r.stdout.strip() == "active"
    except Exception:
        return False


def bangCoChu(con: sqlite3.Connection) -> list[tuple[str, str]]:
    ra = []
    for (t,) in con.execute("select name from sqlite_master where type='table' order by name"):
        for c in con.execute("pragma table_info(" + t + ")"):
            if c[1] in COT_CHU:
                ra.append((t, c[1]))
    return ra


def demHang(con: sqlite3.Connection, bang: list[tuple[str, str]], chu: str) -> dict[str, int]:
    return {t + "." + c: con.execute("select count(*) from " + t + " where " + c + " = ?", (chu,)).fetchone()[0]
            for (t, c) in bang}


def luu(dich: str, duong: str) -> None:
    if os.path.exists(duong):
        shutil.copy2(duong, os.path.join(dich, os.path.basename(duong)))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--tu", required=True)
    ap.add_argument("--sang", required=True)
    ap.add_argument("--that", action="store_true", help="ghi thật (mặc định là chạy khô)")
    ap.add_argument("--du-biet-rui-ro", action="store_true", help="chạy dù backend còn sống")
    a = ap.parse_args()

    if a.tu == a.sang:
        print("x chủ cũ và chủ mới là một — không có gì để làm")
        return 1
    for ten, v in (("--sang", a.sang), ("--tu", a.tu)):
        if not v.strip() or any(ch.isspace() for ch in v):
            print("x %s không được rỗng hay mang khoảng trắng: %r" % (ten, v))
            return 1
    # Chủ mới phải mang ĐÚNG một dấu `|`: chuỗi danh tính của dự án ngăn bằng nó, và một chuỗi mang
    # hai dấu là thứ mọi phép cắt sau này đọc ra một phần khác hẳn.
    if a.sang.count("|") != 1:
        print("x --sang phải có đúng một dấu | (dạng `cinapi|<id>`): %r" % a.sang)
        return 1

    laKhoThat = os.path.abspath(GOC) == "/opt/grokbot2/shared"
    if a.that and laKhoThat and beDangSong() and not a.du_biet_rui_ro:
        print("x `grokbot2-be` ĐANG CHẠY. Kho SQLite có đúng một cửa ghi là tiến trình ấy.")
        print("  Hạ nó rồi chạy lại:  systemctl stop grokbot2-be")
        return 2

    if not os.path.exists(DB):
        print("x không thấy kho: " + DB)
        return 1

    tepMau = os.path.join(KHO, "bot-templates", safe(a.tu) + ".json")
    tepMauMoi = os.path.join(KHO, "bot-templates", safe(a.sang) + ".json")
    tepCho = os.path.join(KHO, "marketplace.json")

    print("chủ cũ : %s" % a.tu)
    print("chủ mới: %s" % a.sang)
    print("chế độ : %s" % ("GHI THẬT" if a.that else "chạy khô (thêm --that để ghi)"))
    print()

    con = sqlite3.connect(DB)
    con.execute("pragma foreign_keys=off")
    bang = bangCoChu(con)
    truoc = demHang(con, bang, a.tu)
    truocMoi = demHang(con, bang, a.sang)
    tong = sum(truoc.values())

    print("=== SQLite: hàng mang chủ cũ / chủ mới ===")
    for k in sorted(truoc):
        if truoc[k] or truocMoi[k]:
            print("  %-26s cũ=%-6d mới=%d" % (k, truoc[k], truocMoi[k]))
    print("  tổng hàng mang chủ cũ: %d" % tong)

    hs = con.execute("select id, body from host_settings").fetchall()
    soHs = sum(1 for (_i, b) in hs if a.tu in str(b))
    print()
    print("=== ngoài SQLite ===")
    print("  host_settings.body mang chủ cũ: %d hàng" % soHs)
    for p in (tepCho, tepMau):
        n = 0
        if os.path.exists(p):
            n = open(p, encoding="utf-8").read().count(a.tu)
        print("  %-46s %s" % (os.path.basename(p), ("%d lần" % n) if os.path.exists(p) else "VẮNG"))
    if os.path.exists(tepMau):
        print("  và tệp ấy phải ĐỔI TÊN -> %s" % os.path.basename(tepMauMoi))

    if tong == 0 and soHs == 0 and not os.path.exists(tepMau):
        print()
        print("v không có gì mang chủ cũ — không có gì để làm (chạy lại an toàn)")
        return 0

    if not a.that:
        print()
        print("(chạy khô — chưa ghi một byte nào. Thêm --that để ghi.)")
        return 0

    # ── bản lưu ────────────────────────────────────────────────────────────────
    dich = os.path.join(KHO, "chuyen-chu-bak-" + time.strftime("%Y%m%d-%H%M%S"))
    os.makedirs(dich, exist_ok=True)
    for p in (DB, DB + "-wal", DB + "-shm", tepCho, tepMau):
        luu(dich, p)
    print()
    print("=== bản lưu: %s ===" % dich)
    print("  " + " ".join(sorted(os.listdir(dich))))

    # ── SQLite ─────────────────────────────────────────────────────────────────
    with con:
        for (t, c) in bang:
            if t == "users" and c == "auth_id":
                # Hàng đích đã có (người dùng đã đăng nhập bằng danh tính mới) ⇒ GIỮ hàng đích,
                # bỏ hàng cũ. Không hàng đích ⇒ đổi tên.
                if con.execute("select 1 from users where auth_id=?", (a.sang,)).fetchone():
                    con.execute("delete from users where auth_id=?", (a.tu,))
                else:
                    con.execute("update users set auth_id=? where auth_id=?", (a.sang, a.tu))
            elif t == "usage" and c == "auth_id":
                # Cộng dồn theo NGÀY: hai hàng cùng ngày là hai nửa của một con số.
                con.execute(
                    "insert into usage(auth_id, day, tokens_in, tokens_out, turns) "
                    "select ?, day, tokens_in, tokens_out, turns from usage where auth_id=? "
                    "on conflict(auth_id, day) do update set "
                    "tokens_in = tokens_in + excluded.tokens_in, "
                    "tokens_out = tokens_out + excluded.tokens_out, "
                    "turns = turns + excluded.turns",
                    (a.sang, a.tu),
                )
                con.execute("delete from usage where auth_id=?", (a.tu,))
            else:
                con.execute("update " + t + " set " + c + "=? where " + c + "=?", (a.sang, a.tu))

        for (i, b) in hs:
            s = str(b)
            if a.tu not in s:
                continue
            try:
                d = json.loads(s)
            except Exception:
                # Không phải JSON thì thay chuỗi — vẫn đúng, chỉ kém tường minh.
                con.execute("update host_settings set body=? where id=?", (s.replace(a.tu, a.sang), i))
                continue
            bo = d.get("byOwner") if isinstance(d, dict) else None
            if isinstance(bo, dict) and a.tu in bo:
                cu = bo.pop(a.tu)
                bo[a.sang] = {**cu, **bo.get(a.sang, {})} if isinstance(cu, dict) and isinstance(bo.get(a.sang), dict) else bo.get(a.sang, cu)
                con.execute("update host_settings set body=? where id=?", (json.dumps(d, ensure_ascii=False), i))
            else:
                con.execute("update host_settings set body=? where id=?", (s.replace(a.tu, a.sang), i))

    sau = demHang(con, bang, a.tu)
    sauMoi = demHang(con, bang, a.sang)
    kt = con.execute("pragma integrity_check").fetchone()[0]
    con.close()

    # ── tệp JSON ───────────────────────────────────────────────────────────────
    for p in (tepCho,):
        if os.path.exists(p):
            s = open(p, encoding="utf-8").read()
            open(p, "w", encoding="utf-8").write(s.replace(a.tu, a.sang))
    if os.path.exists(tepMau):
        s = open(tepMau, encoding="utf-8").read().replace(a.tu, a.sang)
        # Ghi tệp MỚI rồi mới xoá tệp cũ: đứt điện giữa hai bước thì còn cả hai, không mất cái nào.
        open(tepMauMoi, "w", encoding="utf-8").write(s)
        os.chmod(tepMauMoi, 0o600)
        if os.path.abspath(tepMauMoi) != os.path.abspath(tepMau):
            os.remove(tepMau)

    print()
    print("=== SAU ===")
    for k in sorted(sau):
        if truoc[k] or sauMoi[k]:
            print("  %-26s cũ=%-6d mới=%d" % (k, sau[k], sauMoi[k]))
    print("  integrity_check: %s" % kt)
    conLai = 0
    for p in (tepCho, tepMauMoi):
        if os.path.exists(p):
            n = open(p, encoding="utf-8").read().count(a.tu)
            conLai += n
            print("  %-46s còn %d lần chủ cũ" % (os.path.basename(p), n))
    print("  tệp kho mẫu của chủ cũ còn tồn tại: %s" % os.path.exists(tepMau))

    xong = sum(sau.values()) == 0 and conLai == 0 and kt == "ok" and not os.path.exists(tepMau)
    print()
    print("%s" % ("v XONG — 0 hàng còn mang chủ cũ" if xong else "x CHƯA TRỌN — đọc số ở trên"))
    print("  lùi: dừng backend, chép lại từ %s" % dich)
    return 0 if xong else 1


if __name__ == "__main__":
    sys.exit(main())
