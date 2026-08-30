# Bot có được nâng quyền trên máy người dùng không?

> Đo 31/08/2026 từ bundle 0.29 đang cài (`C:\cai029`), không suy đoán.

## Câu trả lời

**Windows: không.** App gốc chặn cứng, không điều kiện.

**macOS/Linux: có**, qua `sudo -A` + askpass, và **người dùng phải tự gõ mật khẩu** vào hộp thoại
của app — bot không bao giờ cầm mật khẩu.

## Bằng chứng

`dist/local-exec-daemon/main.cjs`:

```js
function Mx(t){ return Dft ? !1 : !!t?.SUDO_ASKPASS }   // Dft = process.platform === "win32"
o(Mx, "shouldEnableSudoAskpass");
Fft = "alias sudo='sudo -A'";
o(iy, "getSudoAliasInjection");
o(ML, "transformSudoCommand");
```

`Dft` là `process.platform === "win32"`, và nó đứng đầu biểu thức — nên trên Windows hàm trả `false`
trước khi kịp nhìn tới `SUDO_ASKPASS`.

Cơ chế trên Unix: daemon tiêm alias `sudo='sudo -A'` vào shell, rồi đặt ba biến môi trường —

```js
_.SUDO_ASKPASS = r.askpassConfig.helperPath;
_.CURSOR_ASKPASS_SOCKET = r.askpassConfig.socketPath;
_.CURSOR_ASKPASS_SECRET = r.askpassConfig.secret;
```

`sudo -A` gọi helper thay vì hỏi ở terminal; helper nối vào socket của app; app hiện hộp xin mật
khẩu. Mật khẩu đi từ người dùng thẳng tới `sudo`, không qua model.

Bộ chụp trạng thái shell còn cố ý **lọc bỏ** ba biến ấy để chúng không rò sang lượt sau:

```
grep -viE '_proxy=|CURSOR_SANDBOX|SUDO_ASKPASS|CURSOR_ASKPASS|CURSOR_CONVERSATION_ID|…'
```

## Kiểm chéo — không có đường vòng nào trên Windows

| tìm trong daemon | số lần |
|---|---|
| `runas` | 0 |
| `ShellExecute` | 0 |
| `elevat` | 0 |
| `UAC` (như một TỪ) | 0 |
| helper askpass cho Windows (`askpass.exe`, `cursor-askpass`) | 0 |

`UAC` có 167 kết quả nếu tìm chuỗi thô, nhưng **0** khi tìm nguyên từ — chúng là mảnh nằm trong
base64 và tên biến rút gọn. Đây đúng loại con số dễ đọc nhầm thành "có hỗ trợ".

`resources/elevate.exe` (123 KB) là file chuẩn của electron-builder, dùng lúc **cài app**;
`main.cjs` không hề gọi nó (5 lần chữ "elevate" trong đó đều là tên màu CSS: `bg/elevated`,
`fill/elevated`, và một mức severity `"elevated"`).

## Vậy cài phần mềm trên Windows bằng cách nào

**Bản portable.** Không đụng registry, không cần admin, không hạ lớp bảo vệ nào — và bot tự làm
được toàn bộ. Đo bằng một lượt thật, OBS Studio:

```
tải  OBS-Studio-32.2.2-Windows-x64.zip   (105 MB) về thư mục nhà
bung C:\Users\admin\grokbot2-apps\obs    (bin, data, obs-plugins)
chạy bin\64bit\obs64.exe --portable      → obs64 PID 27156
```

Trước đó bot thử `winget install OBSProject.OBSStudio`: tìm đúng gói, verify hash, rồi kẹt ở bước
cài — vì `winget` cần nâng quyền và tự hủy im lặng trong phiên không tương tác. Bot đoán là hộp UAC
đang treo; kiểm thì không có hộp nào. Đo được: `whoami` = admin nhưng `net session` báo
**KHONG-ELEVATED**.

Hai chỗ vấp mà bot tự tìm ra, đáng nhớ cho lần sau:

- shell trên máy đó **nuốt `$`**, nên mọi biến PowerShell viết trần đều hỏng — phải viết thẳng
  đường dẫn, hoặc gọi `powershell -NoProfile -Command "…"` với chuỗi tự chứa;
- `tar` trần bị bắt sang `/usr/bin/tar` của Git Bash và không hiểu zip — phải gọi đích danh
  `C:\Windows\System32\tar.exe`.
