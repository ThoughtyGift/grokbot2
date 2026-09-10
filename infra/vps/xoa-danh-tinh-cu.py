#!/usr/bin/env python3
"""Xoá SẠCH mọi dữ liệu của các danh tính đăng nhập CŨ (`local|<email>`) khỏi kho grokbot2.

    python3 xoa-danh-tinh-cu.py                 # CHẠY KHÔ — in ra sẽ xoá gì, không ghi một byte
    python3 xoa-danh-tinh-cu.py --that          # ghi thật

Vì sao nó tồn tại, và vì sao KHÔNG nên gõ `DELETE` tay thay cho nó: quyết định của chủ dự án
09/09 là *"xoá sạch hẳn — làm lại từ trắng"* sau khi cái giá được đo và đặt lên bàn (30 bot ·
872 entry · 8 người). Một quyết định đắt như thế đáng có một công cụ **chạy khô được**, **chạy
lại được**, **có bản lưu**, và **tự nghiệm thu ở chỗ ĐỌC** — chứ không phải một dòng `DELETE`
gõ vào shell của máy sản xuất, nơi không ai xem lại được mình đã xoá đúng những gì.

Anh em với `chuyen-chu.py`, và mang đúng ba tính chất ấy vì cùng một lý do đã trả giá:

  1. Mặc định **chạy khô**; muốn ghi phải gõ `--that`.
  2. **Từ chối chạy khi `grokbot2-be` còn sống** — kho SQLite có đúng MỘT cửa ghi là tiến trình
     ấy. (Bỏ qua khi `GROKBOT2_SHARED` trỏ một bản chép, để thử được ở nơi đã biết đáp án.)
  3. **Chạy lại được**: lượt thứ hai thấy 0 việc thì nói "không có gì để làm" chứ không ném.

──────────────────────────────────────────────────────────────────────────────────
Ba chỗ mà một phép dò ngây thơ BỎ SÓT, đo được 10/09 và là lý do file này dài hơn
một câu `DELETE`:

  · `attachments_meta` và `acceptance` KHÔNG có đường về bot (khoá theo `path` /
    `client_nonce`). Cột `owner_id` của chúng là cột **TRƠ** và đang mang chuỗi
    giữ chỗ, nên lọc theo nó là lọc theo một thứ không ai duy trì. Đường quy thuộc
    DUY NHẤT đáng tin là: đọc đường dẫn đính kèm **trong thân entry của chính bot
    sắp xoá** — 64 entry có nhắc, và chỉ những tệp ấy mới được xoá.
  · `host_settings.body.byOwner` là một OBJECT nằm trong một cột JSON, không phải
    một hàng. Không `DELETE` nào chạm tới nó; phải đọc–sửa–ghi.
  · `may-da-biet.json` (sổ máy) nằm NGOÀI SQLite. Sổ tự lành với hàng KHÔNG chủ,
    nhưng hai hàng này CÓ chủ `local|…` nên nó sẽ giữ chúng mãi.

Và một chỗ cố ý KHÔNG đụng: `coverage.json` còn nhắc id của 9 bot sắp xoá. Đó là
sổ đo đường đi (`lastArgs`), không phải dữ liệu người dùng; xoá nó là xoá bằng
chứng về những lượt đã xảy ra thật.
──────────────────────────────────────────────────────────────────────────────────

Lùi: dừng backend rồi chép ngược thư mục bản lưu mà script in ra ở cuối.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import time

# Gốc đọc từ env chứ không ghim hằng — cùng quy ước `dataDir()` của sản phẩm, và đó là điều
# kiện để thử script này trên một BẢN CHÉP trước khi cho nó gần dữ liệu thật.
GOC = os.environ.get("GROKBOT2_SHARED", "/opt/grokbot2/shared")
KHO = os.path.join(GOC, "data")
DB = os.path.join(KHO, "grokbot.sqlite")

# Chủ mặc định — `ownsAgent` dùng nó cho bot không khai `agentOwnerAuthId` (nhánh `?? AUTH_ID`).
GIU_CHO = "auth0|grokbot2-user"

# Bảng có `agent_id`, tức có đường về bot. Đo 10/09 trên kho thật; `pragma table_info` ở phần
# nghiệm thu sẽ kêu nếu lược đồ mọc thêm bảng mà danh sách này không biết.
BANG_THEO_BOT = ("entries", "parked", "automations", "compaction", "todos", "handoffs")

DUONG_DINH_KEM = re.compile(r"/workspace/attachments/[A-Za-z0-9._-]+")


def safe(auth_id: str) -> str:
    """Cùng phép đặt tên tệp mà `bot-templates` của sản phẩm dùng."""
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


def che(auth_id: str) -> str:
    """Không bao giờ in danh tính THẬT ra log — đầu ra của script này bị chép vào tài liệu.

    Che cả hai họ, không chỉ `local|`: bản đầu chỉ giấu email rồi in nguyên `cinapi|<id>` của
    chủ dự án ra màn hình. Id cinai không phải bí mật, nhưng luật của dự án là *ghi PHƯƠNG PHÁP
    lấy nó, đừng ghi chính nó* — và một dòng log là chỗ nó lọt vào commit dễ nhất.
    """
    if auth_id.startswith("local|"):
        ten, _, mien = auth_id[len("local|"):].partition("@")
        return "local|" + ten[:2] + "***@***" + mien[-4:]
    if auth_id.startswith("cinapi|"):
        return "cinapi|***" + auth_id[-4:]
    return auth_id


def luu(dich: str, duong: str) -> None:
    if not os.path.exists(duong):
        return
    if os.path.isdir(duong):
        shutil.copytree(duong, os.path.join(dich, os.path.basename(duong)))
    else:
        shutil.copy2(duong, os.path.join(dich, os.path.basename(duong)))


def docJson(duong: str):
    try:
        with open(duong, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--tien-to", default="local|", help="tiền tố danh tính cần xoá (mặc định `local|`)")
    ap.add_argument("--that", action="store_true", help="ghi thật (mặc định là chạy khô)")
    ap.add_argument("--du-biet-rui-ro", action="store_true", help="chạy dù backend còn sống")
    a = ap.parse_args()

    tt = a.tien_to
    if not tt.strip() or tt in (GIU_CHO, "cinapi|"):
        print("x --tien-to không hợp lệ: %r" % tt)
        return 1

    laKhoThat = os.path.abspath(GOC) == "/opt/grokbot2/shared"
    if a.that and laKhoThat and beDangSong() and not a.du_biet_rui_ro:
        print("x `grokbot2-be` ĐANG CHẠY. Kho SQLite có đúng một cửa ghi là tiến trình ấy.")
        print("  Hạ nó rồi chạy lại:  systemctl stop grokbot2-be")
        return 2
    if not os.path.exists(DB):
        print("x không thấy kho: " + DB)
        return 1

    print("tiền tố: %s" % tt)
    print("kho    : %s" % KHO)
    print("chế độ : %s" % ("XOÁ THẬT" if a.that else "chạy khô (thêm --that để ghi)"))
    print()

    con = sqlite3.connect(DB)
    con.execute("pragma foreign_keys=off")

    # ── A. Bot nào thuộc danh tính cũ — đọc THÂN, không đọc cột trơ ────────────────
    chuCua: dict[str, str] = {}
    for (i, b) in con.execute("select id, body from agents"):
        chuCua[i] = chuTrongThan(b)
    botXoa = sorted(i for i, c in chuCua.items() if c.startswith(tt))
    chuXoa = sorted({c for c in chuCua.values() if c.startswith(tt)})

    print("=== TRƯỚC ===")
    theoChu: dict[str, int] = {}
    for c in chuCua.values():
        theoChu[c] = theoChu.get(c, 0) + 1
    for c in sorted(theoChu, key=lambda x: -theoChu[x]):
        print("  %-34s %d bot%s" % (che(c), theoChu[c], "   <= XOÁ" if c.startswith(tt) else ""))

    # ── B. Đính kèm: đường quy thuộc DUY NHẤT đáng tin là thân entry của chính bot ─
    dinhKem: set[str] = set()
    for (ai, b) in con.execute("select agent_id, body from entries"):
        if ai in set(botXoa):
            dinhKem.update(DUONG_DINH_KEM.findall(b or ""))

    demBang = {t: con.execute(
        "select count(*) from " + t + " where agent_id in (%s)" % ",".join("?" * len(botXoa)),
        botXoa).fetchone()[0] if botXoa else 0 for t in BANG_THEO_BOT}
    demUser = con.execute("select count(*) from users where auth_id like ?", (tt + "%",)).fetchone()[0]
    demUsage = con.execute("select count(*) from usage where auth_id like ?", (tt + "%",)).fetchone()[0]

    hs = con.execute("select id, body from host_settings").fetchall()
    hsKhoa = 0
    for (_, b) in hs:
        d = json.loads(b) if b else {}
        hsKhoa += sum(1 for k in (d.get("byOwner") or {}) if k.startswith(tt))

    tepMau = [t for t in (os.listdir(os.path.join(KHO, "bot-templates"))
                          if os.path.isdir(os.path.join(KHO, "bot-templates")) else [])
              if t.startswith(safe(tt))]

    soMay = docJson(os.path.join(KHO, "may-da-biet.json"))
    mayXoa = 0
    if isinstance(soMay, list):
        mayXoa = sum(1 for h in soMay if str((h or {}).get("owner", "")).startswith(tt))

    cho = docJson(os.path.join(KHO, "marketplace.json"))
    choXoa = 0
    if isinstance(cho, list):
        choXoa = sum(1 for l in cho if (l or {}).get("agentId") in set(botXoa)
                     or str((l or {}).get("owner", "")).startswith(tt))

    print()
    print("=== SẼ XOÁ ===")
    print("  danh tính                    : %d (%s)" % (len(chuXoa), ", ".join(che(c) for c in chuXoa)))
    print("  agents                       : %d" % len(botXoa))
    for t in BANG_THEO_BOT:
        print("  %-29s: %d" % (t, demBang[t]))
    print("  users / usage                : %d / %d" % (demUser, demUsage))
    print("  host_settings.byOwner (khoá) : %d" % hsKhoa)
    print("  đính kèm (tệp + hàng meta)   : %d" % len(dinhKem))
    print("  bot-templates/*.json         : %d" % len(tepMau))
    print("  sổ máy (hàng)                : %d" % mayXoa)
    print("  marketplace (listing)        : %d" % choXoa)

    tong = (len(botXoa) + sum(demBang.values()) + demUser + demUsage + hsKhoa
            + len(dinhKem) + len(tepMau) + mayXoa + choXoa)
    if tong == 0:
        print()
        print("v không có gì để làm — kho đã sạch danh tính %r" % tt)
        con.close()
        return 0

    if not a.that:
        print()
        print("(chạy khô — chưa ghi một byte nào. Thêm --that để xoá.)")
        con.close()
        return 0

    # ── Bản lưu TRƯỚC khi chạm byte đầu tiên ──────────────────────────────────────
    dich = os.path.join(KHO, "xoa-cu-bak-" + time.strftime("%Y%m%d-%H%M%S"))
    os.makedirs(dich, exist_ok=True)
    for t in ("grokbot.sqlite", "grokbot.sqlite-wal", "grokbot.sqlite-shm",
              "may-da-biet.json", "marketplace.json", "bot-templates"):
        luu(dich, os.path.join(KHO, t))
    print()
    print("bản lưu: %s" % dich)

    # ── C. SQLite ─────────────────────────────────────────────────────────────────
    dau = ",".join("?" * len(botXoa))
    for t in BANG_THEO_BOT:
        con.execute("delete from " + t + " where agent_id in (%s)" % dau, botXoa)
    con.execute("delete from agents where id in (%s)" % dau, botXoa)
    con.execute("delete from users where auth_id like ?", (tt + "%",))
    con.execute("delete from usage where auth_id like ?", (tt + "%",))
    if dinhKem:
        con.execute("delete from attachments_meta where path in (%s)" % ",".join("?" * len(dinhKem)),
                    sorted(dinhKem))
    # `byOwner` là một object trong cột JSON — không `DELETE` nào chạm tới nó.
    for (i, b) in hs:
        d = json.loads(b) if b else {}
        bo = d.get("byOwner") or {}
        con_lai = {k: v for k, v in bo.items() if not k.startswith(tt)}
        if len(con_lai) != len(bo):
            d["byOwner"] = con_lai
            con.execute("update host_settings set body=? where id=?", (json.dumps(d), i))
    con.commit()

    # ── D. Tệp ngoài SQLite ───────────────────────────────────────────────────────
    for t in tepMau:
        os.remove(os.path.join(KHO, "bot-templates", t))
    for p in dinhKem:
        f = os.path.join(KHO, "attachments", os.path.basename(p))
        if os.path.exists(f):
            os.remove(f)
    if mayXoa and isinstance(soMay, list):
        with open(os.path.join(KHO, "may-da-biet.json"), "w", encoding="utf-8") as f:
            json.dump([h for h in soMay if not str((h or {}).get("owner", "")).startswith(tt)], f)
    if choXoa and isinstance(cho, list):
        with open(os.path.join(KHO, "marketplace.json"), "w", encoding="utf-8") as f:
            json.dump([l for l in cho if (l or {}).get("agentId") not in set(botXoa)
                       and not str((l or {}).get("owner", "")).startswith(tt)], f)

    # ── E. Nghiệm thu — đếm lại từ chỗ ĐỌC, không đếm lại chỗ vừa ghi ─────────────
    print()
    print("=== SAU — đếm lại theo THÂN (chỗ `ownsAgent` đọc) ===")
    sauThan: dict[str, int] = {}
    for (i, b) in con.execute("select id, body from agents"):
        c = chuTrongThan(b)
        sauThan[c] = sauThan.get(c, 0) + 1
    for c in sorted(sauThan, key=lambda x: -sauThan[x]):
        print("  %-34s %d bot" % (che(c), sauThan[c]))

    conBot = sum(1 for c in sauThan if c.startswith(tt))
    conBang = {t: con.execute(
        "select count(*) from " + t + " x where not exists"
        " (select 1 from agents g where g.id = x.agent_id)").fetchone()[0] for t in BANG_THEO_BOT}
    conUser = con.execute("select count(*) from users where auth_id like ?", (tt + "%",)).fetchone()[0]
    conUsage = con.execute("select count(*) from usage where auth_id like ?", (tt + "%",)).fetchone()[0]
    conHs = 0
    for (_, b) in con.execute("select id, body from host_settings"):
        d = json.loads(b) if b else {}
        conHs += sum(1 for k in (d.get("byOwner") or {}) if k.startswith(tt))
    kt = con.execute("pragma integrity_check").fetchone()[0]
    con.close()

    conMau = [t for t in (os.listdir(os.path.join(KHO, "bot-templates"))
                          if os.path.isdir(os.path.join(KHO, "bot-templates")) else [])
              if t.startswith(safe(tt))]
    soMay2 = docJson(os.path.join(KHO, "may-da-biet.json"))
    conMay = sum(1 for h in soMay2 if str((h or {}).get("owner", "")).startswith(tt)) \
        if isinstance(soMay2, list) else 0
    conTep = sum(1 for p in dinhKem if os.path.exists(os.path.join(KHO, "attachments", os.path.basename(p))))

    print("  bot còn mang danh tính cũ    : %d" % conBot)
    print("  hàng mồ côi (không còn bot)  : %s" % ", ".join("%s=%d" % (t, conBang[t]) for t in BANG_THEO_BOT))
    print("  users / usage còn lại        : %d / %d" % (conUser, conUsage))
    print("  host_settings.byOwner còn    : %d" % conHs)
    print("  bot-templates còn / tệp đính : %d / %d" % (len(conMau), conTep))
    print("  sổ máy còn hàng chủ cũ       : %d" % conMay)
    print("  integrity_check              : %s" % kt)

    xong = (conBot == 0 and all(v == 0 for v in conBang.values()) and conUser == 0
            and conUsage == 0 and conHs == 0 and not conMau and conMay == 0
            and conTep == 0 and kt == "ok")
    print()
    print("%s" % ("v XONG" if xong else "x CHƯA TRỌN — đọc số ở trên"))
    print("  lùi: dừng backend, chép lại từ %s" % dich)
    return 0 if xong else 1


if __name__ == "__main__":
    sys.exit(main())
