#!/usr/bin/env python3
"""Chuyển chủ sở hữu dữ liệu grokbot2 từ một `authId` sang một `authId` khác.

    python3 chuyen-chu.py --tu 'auth0|grokbot2-user' --sang 'cinapi|<id>'          # CHẠY KHÔ
    python3 chuyen-chu.py --tu 'auth0|grokbot2-user' --sang 'cinapi|<id>' --that   # ghi thật

Vì sao cần nó (Bước 3 của [cinapi-merge.md](../../docs/plan/cinapi-merge.md)): khoá sở hữu của
grokbot2 là MỘT CHUỖI, nên đổi danh tính đăng nhập là đổi khoá ấy. Sổ máy tự lành (thiết kế bỏ hàng
không chủ lúc nạp, daemon đăng ký lại) — **bot thì không**.

──────────────────────────────────────────────────────────────────────────────────
BẢN ĐẦU CỦA SCRIPT NÀY SAI, và chép lại vì nó là một lớp bẫy chứ không phải một
dòng lỗi. Nó kiểm kê chỗ mang chủ theo **CỘT** (`owner_id`, `auth_id` — tìm bằng
`pragma table_info`) rồi `UPDATE` cả 42 hàng `agents`. Đo trên bản đang chạy sau
khi ghi thì kết quả **phản chứng** phép ghi: chủ mới thấy **0 bot**, chủ cũ vẫn
thấy **12**.

Gốc: chỗ QUYẾT ĐỊNH quyền chủ lúc chạy là `ownsAgent` trong `chat/state.ts`, và
nó đọc `a.agentOwnerAuthId` **trong THÂN JSON của bot**, không đọc cột:

    export const ownsAgent = (id) => {
      const a = agents.get(id);
      return !!a && ((a.agentOwnerAuthId ?? AUTH_ID) === currentOwner());
    };

Còn cột `owner_id` thì chính `store.ts` khai là **TRƠ**: *"INERT: nothing filters
on `owner_id` yet — that is Phase 2"*. Nó được `ALTER TABLE ... DEFAULT
'auth0|grokbot2-user'` lấp một lượt và **chưa bao giờ được duy trì**.

Hai hệ quả, cả hai đo được:

  1. Một phép đếm theo cột nói *"cả 42 bot cùng MỘT chủ"* — **sai**. Đếm theo
     thân thì 42 bot thuộc **9 chủ**: chủ mặc định 12, tám tài khoản `local|…`
     thật giữ 30 bot còn lại.
  2. Vì cột là trơ nên lượt ghi sai ấy **không đổi hành vi của ai** — nhưng nó
     làm cột nói dối NẶNG hơn: trước nó là một chỗ giữ chỗ đồng loạt, sau nó trỏ
     vào một danh tính THẬT nên đọc lên như một dữ kiện.

Bài học: **kiểm kê theo chỗ ĐỌC, không theo chỗ LƯU.** Đếm cột là đếm hình dạng
của lược đồ; đếm chỗ đọc là đếm hành vi. Cùng họ §7 *"trường có trong hợp đồng ≠
trường có người ĐỌC"* và *"một danh sách sống ở HAI nơi thì cái mình đọc luôn là
cái cũ"*.
──────────────────────────────────────────────────────────────────────────────────

Nên bản này làm ba việc, theo đúng thứ tự đó:

  A. **Chuyển thật**: bot nào có `agentOwnerAuthId == --tu` thì đổi THÂN sang
     `--sang` (đây là thứ `ownsAgent` đọc), rồi đặt `owner_id` khớp.
  B. **Sửa lời nói dối của cột**: mọi bot của chủ KHÁC được đặt `owner_id` =
     đúng chủ trong thân nó. Việc này cũng gỡ hậu quả của bản đầu.
  C. **Bảng theo bot** (`entries`, `automations`, `compaction`, `parked`) lấy
     `owner_id` từ bot của chúng. Hai bảng KHÔNG có đường về bot
     (`acceptance` khoá theo `client_nonce`, `attachments_meta` theo `path`)
     được trả về chuỗi giữ chỗ — không có căn cứ nào để gán chúng cho ai, và bịa
     một quy thuộc vào một cột trơ là đúng thứ vừa trả giá.

Ba tính chất viết vào HÌNH DẠNG script chứ không vào lời dặn: mặc định **chạy
khô** (muốn ghi phải gõ `--that`); **từ chối chạy khi `grokbot2-be` còn sống**
(kho SQLite có đúng một cửa ghi là tiến trình ấy); và **chạy lại được** — lượt
thứ hai thấy 0 việc thì nói "không có gì để làm" chứ không ném.

Và hai chỗ là "gộp" chứ không phải "đổi tên", vì lược đồ có ràng buộc (đo 09/09):
`users.auth_id` là PRIMARY KEY, `usage(auth_id, day)` cũng vậy. Người dùng đăng
nhập bằng danh tính mới TRƯỚC khi script chạy thì `ensureUser` đã đẻ hàng đích ⇒
`UPDATE` vướng khoá. Nên `users` giữ hàng ĐÍCH và bỏ hàng cũ, `usage` **cộng dồn**
theo ngày.
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
# để chạy thử script này trên một BẢN CHÉP trước khi cho nó gần dữ liệu thật.
GOC = os.environ.get("GROKBOT2_SHARED", "/opt/grokbot2/shared")
KHO = os.path.join(GOC, "data")
DB = os.path.join(KHO, "grokbot.sqlite")

# Chuỗi `store.ts` lấp vào cột trơ. Hàng không có đường về bot được trả về đúng nó.
GIU_CHO = "auth0|grokbot2-user"

# Bảng có `agent_id` ⇒ suy được chủ từ bot. `entries` là bảng lớn nhất.
BANG_THEO_BOT = ("entries", "automations", "compaction", "parked")
# Bảng KHÔNG có đường về bot.
BANG_KHONG_RO = ("acceptance", "attachments_meta")


def safe(auth_id: str) -> str:
    """Bản chép ĐÚNG của `safe()` trong `src/bot-templates.ts` — tên tệp kho mẫu suy từ chủ.

    Kiểm bằng cách đối chiếu với tệp CÓ THẬT trên đĩa (`auth0_grokbot2-user.json`), không bằng
    cách tin lời chép.
    """
    return "".join(c if (c.isascii() and (c.isalnum() or c in "_-")) else "_" for c in auth_id)


def beDangSong() -> bool:
    try:
        r = subprocess.run(["systemctl", "is-active", "grokbot2-be"], capture_output=True, text=True)
        return r.stdout.strip() == "active"
    except Exception:
        return False


def chuTrongThan(body: str) -> str:
    """Chủ THẬT của một bot — đúng thứ `ownsAgent` đọc, kể cả nhánh `?? AUTH_ID`."""
    try:
        d = json.loads(body)
    except Exception:
        return GIU_CHO
    v = d.get("agentOwnerAuthId") if isinstance(d, dict) else None
    return v if isinstance(v, str) and v.strip() else GIU_CHO


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

    # ── A · đọc chỗ QUYẾT ĐỊNH: chủ trong THÂN của từng bot ────────────────────
    bots = [(i, b, o) for (i, b, o) in con.execute("select id, body, owner_id from agents")]
    theoThan: dict[str, int] = {}
    for (_i, b, _o) in bots:
        c = chuTrongThan(b)
        theoThan[c] = theoThan.get(c, 0) + 1
    print("=== chủ THẬT của bot (đọc `agentOwnerAuthId` trong thân — chỗ `ownsAgent` đọc) ===")
    for k in sorted(theoThan, key=lambda x: -theoThan[x]):
        print("  %-46s %d bot" % (k, theoThan[k]))

    canDoi = [(i, b) for (i, b, _o) in bots if chuTrongThan(b) == a.tu]
    cotLech = [(i, chuTrongThan(b), o) for (i, b, o) in bots
               if o != (a.sang if chuTrongThan(b) == a.tu else chuTrongThan(b))]
    print()
    print("=== việc phải làm ===")
    print("  A · bot đổi THÂN sang chủ mới          : %d" % len(canDoi))
    print("  B · bot có cột `owner_id` lệch với thân: %d" % len(cotLech))

    # ── C · bảng theo bot + bảng không rõ ─────────────────────────────────────
    chuCua = {i: (a.sang if chuTrongThan(b) == a.tu else chuTrongThan(b)) for (i, b, _o) in bots}
    lechTheoBot = 0
    for t in BANG_THEO_BOT:
        for (aid, o, n) in con.execute("select agent_id, owner_id, count(*) from " + t + " group by 1,2"):
            if chuCua.get(aid, GIU_CHO) != o:
                lechTheoBot += n
    lechKhongRo = sum(con.execute("select count(*) from " + t + " where owner_id <> ?", (GIU_CHO,)).fetchone()[0]
                      for t in BANG_KHONG_RO)
    print("  C · hàng bảng-theo-bot lệch chủ        : %d" % lechTheoBot)
    print("      hàng bảng-không-rõ khác chuỗi giữ chỗ: %d" % lechKhongRo)

    coUser = con.execute("select count(*) from users where auth_id=?", (a.tu,)).fetchone()[0]
    coUsage = con.execute("select count(*) from usage where auth_id=?", (a.tu,)).fetchone()[0]
    hs = con.execute("select id, body from host_settings").fetchall()
    soHs = sum(1 for (_i, b) in hs if a.tu in str(b))
    soCho = open(tepCho, encoding="utf-8").read().count(a.tu) if os.path.exists(tepCho) else 0
    print("  users/usage hàng mang chủ cũ           : %d / %d" % (coUser, coUsage))
    print("  host_settings hàng mang chủ cũ         : %d" % soHs)
    print("  marketplace.json                       : %d lần" % soCho)
    print("  bot-templates của chủ cũ               : %s" % ("CÓ, phải đổi tên -> " + os.path.basename(tepMauMoi)
                                                             if os.path.exists(tepMau) else "VẮNG"))

    tong = len(canDoi) + len(cotLech) + lechTheoBot + lechKhongRo + coUser + coUsage + soHs + soCho
    if tong == 0 and not os.path.exists(tepMau):
        print()
        print("v không còn việc gì — chạy lại an toàn")
        return 0
    if not a.that:
        print()
        print("(chạy khô — chưa ghi một byte nào. Thêm --that để ghi.)")
        return 0

    dich = os.path.join(KHO, "chuyen-chu-bak-" + time.strftime("%Y%m%d-%H%M%S"))
    os.makedirs(dich, exist_ok=True)
    for p in (DB, DB + "-wal", DB + "-shm", tepCho, tepMau, tepMauMoi):
        luu(dich, p)
    print()
    print("=== bản lưu: %s ===" % dich)
    print("  " + " ".join(sorted(os.listdir(dich))))

    with con:
        # A · THÂN trước — đây là thứ `ownsAgent` đọc, và là phép chuyển THẬT.
        for (i, b) in canDoi:
            d = json.loads(b)
            d["agentOwnerAuthId"] = a.sang
            con.execute("update agents set body=?, owner_id=? where id=?",
                        (json.dumps(d, ensure_ascii=False), a.sang, i))
        # B · cột khớp lại với thân cho MỌI bot (gỡ luôn hậu quả của bản đầu).
        for (i, b, _o) in bots:
            con.execute("update agents set owner_id=? where id=?", (chuCua[i], i))
        # C · bảng theo bot lấy chủ từ bot; bảng không rõ về chuỗi giữ chỗ.
        for t in BANG_THEO_BOT:
            con.execute(
                "update " + t + " set owner_id = coalesce("
                "(select json_extract(g.body,'$.agentOwnerAuthId') from agents g where g.id = " + t + ".agent_id), ?)",
                (GIU_CHO,))
        for t in BANG_KHONG_RO:
            con.execute("update " + t + " set owner_id=? where owner_id <> ?", (GIU_CHO, GIU_CHO))

        if coUser:
            if con.execute("select 1 from users where auth_id=?", (a.sang,)).fetchone():
                con.execute("delete from users where auth_id=?", (a.tu,))
            else:
                con.execute("update users set auth_id=? where auth_id=?", (a.sang, a.tu))
        if coUsage:
            con.execute(
                "insert into usage(auth_id, day, tokens_in, tokens_out, turns) "
                "select ?, day, tokens_in, tokens_out, turns from usage where auth_id=? "
                "on conflict(auth_id, day) do update set "
                "tokens_in = tokens_in + excluded.tokens_in, "
                "tokens_out = tokens_out + excluded.tokens_out, "
                "turns = turns + excluded.turns",
                (a.sang, a.tu))
            con.execute("delete from usage where auth_id=?", (a.tu,))

        for (i, b) in hs:
            s = str(b)
            if a.tu not in s:
                continue
            try:
                d = json.loads(s)
            except Exception:
                con.execute("update host_settings set body=? where id=?", (s.replace(a.tu, a.sang), i))
                continue
            bo = d.get("byOwner") if isinstance(d, dict) else None
            if isinstance(bo, dict) and a.tu in bo:
                cu = bo.pop(a.tu)
                dich_cu = bo.get(a.sang)
                bo[a.sang] = {**cu, **dich_cu} if isinstance(cu, dict) and isinstance(dich_cu, dict) else (dich_cu if dich_cu is not None else cu)
                con.execute("update host_settings set body=? where id=?", (json.dumps(d, ensure_ascii=False), i))
            else:
                con.execute("update host_settings set body=? where id=?", (s.replace(a.tu, a.sang), i))

    if os.path.exists(tepCho):
        s = open(tepCho, encoding="utf-8").read()
        open(tepCho, "w", encoding="utf-8").write(s.replace(a.tu, a.sang))
    if os.path.exists(tepMau):
        s = open(tepMau, encoding="utf-8").read().replace(a.tu, a.sang)
        # Ghi tệp MỚI rồi mới xoá tệp cũ: đứt điện giữa hai bước thì còn cả hai, không mất cái nào.
        open(tepMauMoi, "w", encoding="utf-8").write(s)
        os.chmod(tepMauMoi, 0o600)
        if os.path.abspath(tepMauMoi) != os.path.abspath(tepMau):
            os.remove(tepMau)

    # ── nghiệm thu: đếm lại từ chỗ ĐỌC ────────────────────────────────────────
    print()
    print("=== SAU — đếm lại theo THÂN (chỗ `ownsAgent` đọc) ===")
    sauThan: dict[str, int] = {}
    lechSau = 0
    for (i, b, o) in con.execute("select id, body, owner_id from agents"):
        c = chuTrongThan(b)
        sauThan[c] = sauThan.get(c, 0) + 1
        if c != o:
            lechSau += 1
    for k in sorted(sauThan, key=lambda x: -sauThan[x]):
        print("  %-46s %d bot" % (k, sauThan[k]))
    print("  bot còn lệch giữa thân và cột: %d" % lechSau)
    lechBotSau = 0
    for t in BANG_THEO_BOT:
        lechBotSau += con.execute(
            "select count(*) from " + t + " x where x.owner_id <> coalesce("
            "(select json_extract(g.body,'$.agentOwnerAuthId') from agents g where g.id = x.agent_id), ?)",
            (GIU_CHO,)).fetchone()[0]
    print("  hàng bảng-theo-bot còn lệch  : %d" % lechBotSau)
    conUser = con.execute("select count(*) from users where auth_id=?", (a.tu,)).fetchone()[0]
    conUsage = con.execute("select count(*) from usage where auth_id=?", (a.tu,)).fetchone()[0]
    kt = con.execute("pragma integrity_check").fetchone()[0]
    con.close()
    conCho = open(tepCho, encoding="utf-8").read().count(a.tu) if os.path.exists(tepCho) else 0
    print("  users/usage còn mang chủ cũ  : %d / %d" % (conUser, conUsage))
    print("  marketplace.json còn chủ cũ  : %d lần" % conCho)
    print("  tệp kho mẫu của chủ cũ còn   : %s" % os.path.exists(tepMau))
    print("  integrity_check              : %s" % kt)

    xong = (a.tu not in sauThan and lechSau == 0 and lechBotSau == 0 and conUser == 0
            and conUsage == 0 and conCho == 0 and not os.path.exists(tepMau) and kt == "ok")
    print()
    print("%s" % ("v XONG" if xong else "x CHƯA TRỌN — đọc số ở trên"))
    print("  lùi: dừng backend, chép lại từ %s" % dich)
    return 0 if xong else 1


if __name__ == "__main__":
    sys.exit(main())
