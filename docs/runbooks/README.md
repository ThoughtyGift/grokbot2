# Runbooks — sự cố đã thật sự xảy ra

Không có mục nào ở đây là giả định. Mỗi file là một lần đã mất thời gian thật, viết lại để lần sau
mất một phút thay vì một giờ.

Khuôn chung: **Triệu chứng → Xác nhận (bằng lệnh) → Sửa → Vì sao → Phòng**. Bước *Xác nhận* quan
trọng nhất: ba trong năm sự cố dưới đây **trông giống mất dữ liệu** mà không mất gì.

| Triệu chứng bạn thấy | Runbook |
|---|---|
| Roster đổi thành 4 bot lạ (`Alpha`, `Beta`, `E2E Probe (copy)`) | [wrong-bots-in-roster.md](wrong-bots-in-roster.md) |
| `http://127.0.0.1:5173` báo `ERR_CONNECTION_REFUSED` nhưng `localhost:5173` chạy | [ipv4-refused.md](ipv4-refused.md) |
| App gốc mở ra sidebar trống trơn | [app-empty-roster.md](app-empty-roster.md) |
| App boot nhưng bản patch như không có tác dụng | [patch-half-applied.md](patch-half-applied.md) |
| `pnpm phase:gate` đỏ ở `verify-client-patch` | [gate-red-unapplied-patch.md](gate-red-unapplied-patch.md) |

## Luật vàng

**Đọc chỗ lưu trước khi kết luận mất dữ liệu.** Dữ liệu thật nằm trong SQLite:

```bash
python -c "import sqlite3;print(list(sqlite3.connect('file:services/grokbot-backend/.data/grokbot.sqlite?mode=ro',uri=True).execute('select id,name from agents')))"
```

Hai lần trong một ngày, "bot biến mất" hoá ra không phải mất bot.
