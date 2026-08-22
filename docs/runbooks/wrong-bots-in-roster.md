# Roster đổi thành 4 bot lạ

**Triệu chứng.** App gốc và/hoặc `:5173` bỗng chỉ còn `Claude`, `E2E Probe (copy)`, `Alpha`, `Beta`.
Bot thật biến mất. Trông hệt như mất dữ liệu.

## Xác nhận — dữ liệu còn không

```bash
python -c "import sqlite3;print(list(sqlite3.connect('file:services/grokbot-backend/.data/grokbot.sqlite?mode=ro',uri=True).execute('select id,name from agents')))"
```

Nếu ra đủ bot thật thì **không mất gì** — chỉ là cổng 8788 đang do tiến trình khác giữ. Bốn cái tên
kia chính là nội dung `.data/snapshot.json`, một fixture của bộ test.

Đếm xem có bao nhiêu tiến trình dịch vụ đang sống:

```powershell
(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object {
  $_.CommandLine -like '*grokbot2*' -and ($_.CommandLine -like '*tsx*watch*src/index.ts*'
    -or $_.CommandLine -like '*dev-bff.mjs*' -or $_.CommandLine -like '*preflight.cjs*')
}).Count
```

Một stack lành mạnh là 4–8. Ngày 2026-08-22 đếm được **30**.

## Sửa

```powershell
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object {
  $_.CommandLine -like '*grokbot2*' -and ($_.CommandLine -like '*tsx*watch*src/index.ts*'
    -or $_.CommandLine -like '*dev-bff.mjs*' -or $_.CommandLine -like '*preflight.cjs*')
} | Stop-Process -Force
```

Rồi `pnpm backend`. **Vite thường chết theo** (nó là con của một `cmd.exe` trong đám đó) —
bật lại `pnpm web`.

Lọc theo **command line**, đừng lọc theo tên `node.exe`: Vite và IDE cũng là node.

## Vì sao

`tsx watch` cộng với các script e2e để lại tiến trình. Khi watcher thật khởi động lại, một zombie
chiếm mất `:8788` — và zombie đó chạy store fixture của riêng nó. Cái giữ cổng ngày 2026-08-22 là
con của một watcher từ **02:22 hôm trước**.

## Phòng

`infra/scripts/run.ps1` chỉ dọn cổng 8792–8817 và **cố ý không đụng** 8788–8791, nên nó không cứu
được trường hợp này. Cách phòng thật: đừng để nhiều `pnpm backend` cùng chạy, và khi thấy lạ thì
đếm tiến trình trước khi làm gì khác.
