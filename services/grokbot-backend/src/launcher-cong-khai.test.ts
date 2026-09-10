/**
 * Launcher của bộ cài CÔNG KHAI — đường mà người dùng thật đi.
 *
 *   npx tsx --test services/grokbot-backend/src/launcher-cong-khai.test.ts
 *
 * Có hai launcher, và sáng 03/09 tôi chỉ sửa MỘT. `setup-exe.mjs` (bản chở-cả-app) nhận cửa điều
 * kiện, còn `setup-templates.mjs` (bản 44 KB mà `cinai.app/agent` phát ra) vẫn đặt cứng
 * `SAND_DISABLE_UPDATES=1` — tức toàn bộ việc dựng kênh cập nhật hôm nay không tới được đúng những
 * người tải từ website. Tôi phát hiện bằng cách BUNG chính bộ cài đã dựng ra đọc, không bằng cách
 * đọc mã: khối launcher nằm trong file cài dưới dạng base64, nên grep trên mã nguồn thấy một chỗ mà
 * sản phẩm có hai.
 *
 * Bài này khoá cả hai mặt: không có dòng đặt CỨNG, và có nhánh điều kiện thật.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error — script .mjs thuần, không có khai báo kiểu.
import { winStart, macStart } from "../scripts/setup-templates.mjs";

// Doc DONG LENH, khong doc chu: tu 11/09 khoi REM co ke ve `'Hidden'` va ve Defender, va mot bai do
// grep tren ca file se bat vao chinh loi giai thich cua no (§7 *"grep -c dem trung cau van noi ve
// thu minh dang tim"*).
const chiLenh = (x: string) => x.split(/\r?\n/).filter((l) => !l.trimStart().startsWith("REM")).join("\n");


const KHOA_CUNG_WIN = /^set "SAND_DISABLE_UPDATES=1"$/m;
const KHOA_CUNG_MAC = /^export SAND_DISABLE_UPDATES=1$/m;

test("Windows: KHÔNG đặt cứng khoá cập nhật", () => {
  assert.doesNotMatch(winStart as string, KHOA_CUNG_WIN,
    "đặt cứng thì người tải từ website không bao giờ thấy banner — biến này đứng đầu thứ tự cổng của client");
});

test("Windows: tự cập nhật đủ ba luật, và updater gốc tắt mặc định", () => {
  const s = winStart as string;
  assert.match(s, /updates\/ban-moi/, "launcher phải tự hỏi backend — updater gốc không cài được bản của mình");
  assert.match(s, /Get-FileHash/, "phải kiểm sha256 trước khi CHẠY file tải về");
  assert.match(s, /lan-hoi-cuoi/, "phải có tiết chế, không hỏi mỗi lần mở app");
  // Fail-open GIU NGUYEN qua ban 10/09: `catch` nay nay GHI lai giai doan roi van `exit 0`.
  // Ghim ca hai ve — chi ghim `exit 0` thi mot ban bo mat phep ghi van xanh, con chi ghim phep
  // ghi thi mot ban doi sang `exit 1` cung xanh, va `exit 1` la app khong bao gio mo len nua.
  assert.match(s, /\}catch\{ G \$giaiDoan; exit 0 \}/, "hỏng thì MỞ APP — một lớp cập nhật tự chặn đường vào sản phẩm là lớp sẽ bị gỡ");
  assert.doesNotMatch(s, /catch\{[^}]*exit [1-9]/, "catch không bao giờ được thoát khác 0 — đó là app không mở lên nữa");
  assert.match(s, /GROKBOT2_NATIVE_UPDATES/, "updater gốc phải tắt mặc định, có cửa mở lại cho ngày có chứng chỉ");
  // Suy ra từ %APP%: hai đường dẫn viết tay ở hai dòng là hai đường dẫn sẽ lệch nhau.
  assert.match(s, /for %%I in \("%APP%"\) do set "APPDIR=/);
});

test("macOS: cùng luật, khác vỏ", () => {
  const s = macStart as string;
  assert.doesNotMatch(s, KHOA_CUNG_MAC);
  assert.match(s, /grep -q "grokbot2:update-feed"/);
  assert.match(s, /export SAND_DISABLE_UPDATES=1/, "nhánh chưa vá vẫn khoá");
});

test("HAI PHA: bộ cài KHÔNG chạy đồng bộ từ trong launcher đang chạy", () => {
  /*
   * Bộ cài .cmd ghi đè chính `%DEST%\start-bot.cmd` — file đang được cmd đọc theo từng dòng. Chạy nó
   * đồng bộ (bản sáng 03/09: `& cmd /c $tmp`) là để cmd đọc dòng kế từ file MỚI ở offset CŨ. Pha 2
   * phải là một script riêng, khởi chạy tách rời, sau khi launcher đã thoát (mã 7).
   */
  const s = winStart as string;
  assert.match(s, /bot-noi-bo-cap-nhat\.ps1/, "pha 2 là script riêng trong %TEMP%");
  const lenh = chiLenh(s);
  assert.match(lenh, /Start-Process -FilePath 'powershell' -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-WindowStyle','Minimized','-File',\$pha2/, "pha 2 chạy TÁCH RỜI");
  // Do 11/09: `Hidden` dung chung mot dong lenh voi phan tai tep cua muc 7 lam Defender cham diem
  // CA KHOI la Trojan:Win32/PowhidSubExec.B va giet `powershell` ngay o CreateProcess — pha 1 khong
  // chay MOT DONG nao, launcher roi thang xuong mo app, khong dau vet. Do ba doi launcher trong cung
  // mot thu muc: ban 06/09 qua, ban dang phat qua, ban co curl CHAN. Nen ghim ca chieu PHU DINH.
  assert.doesNotMatch(lenh, /'Hidden'/, "pha 2 khong duoc mo cua so AN — do la nua chu ky Defender bat");
  assert.doesNotMatch(lenh, /'-WindowStyle',\$/, "khong duoc giau -WindowStyle sau mot bien: no lach duoc chu ky, va do dung la thu thuat cua ma doc that");
  assert.match(s, /'Start-Sleep -Seconds 2'/, "pha 2 chờ cmd thoát rồi mới cài");
  assert.match(s, /GROKBOT2_SETUP_UNATTENDED=''1''/, "bộ cài chạy không người trực — không được treo ở set /p");
  // Hang rao cmd, va no la thu DUY NHAT con noi duoc khi chinh khoi tren bi giet tu ngoai: moi cho
  // ghi khac cua muc 52 nam BEN TRONG tien trinh ay. Ghim ca ba ve — bat ma, thoat o 7, va ghi
  // `bi-chan` cho moi ma khac 0 — vi bo bat ky ve nao cung du de ca ay cam tro lai.
  assert.match(lenh, /set "GB2MA=%errorlevel%"/, "phai BAT errorlevel truoc khi lam gi khac");
  assert.match(lenh, /if "%GB2MA%"=="7" exit \/b 0/, "mã 7 ⇒ thoát ngay, không mở app lần hai (bộ cài .cmd tự mở)");
  assert.match(lenh, /if not "%GB2MA%"=="0" >"%~dp0\.cap-nhat-cuoi\.txt" echo [^\n]*kq=bi-chan ma=%GB2MA%/,
    "ma khac 0/7 = pha 1 khong chay xong; cmd phai ghi lai vi PowerShell khong con o do ma ghi");
  assert.doesNotMatch(lenh, /if not "%GB2MA%"=="0" exit/, "hang rao phai FAIL-OPEN: ghi lai roi van mo app");
  assert.doesNotMatch(s, /& cmd \/c \$tmp/, "nhánh cài ĐỒNG BỘ phải biến mất");
});

test("bốn biến hợp đồng với client còn đủ trong cả hai launcher", () => {
  for (const [ten, s] of [["win", winStart as string], ["mac", macStart as string]] as const) {
    for (const bien of ["CURSOR_API_BASE_URL", "SAND_BACKEND_URL", "CURSOR_WEBSITE_URL"]) {
      assert.match(s, new RegExp(bien), `${bien} thiếu trong launcher ${ten}`);
    }
  }
});

/**
 * Tai co THU LAI, va tong thoi gian cho GIU NGUYEN.
 *
 * Do 10/09: may 19041.5607 hoi feed luc 09:00:41, nhan 200, roi tai duoc 23.019.520 byte tren
 * 111 MB thi DUT. Ban truoc tai dung MOT lan, nen mot lan dut la cho tron 24h (moc tiet che da
 * dong dau TRUOC khi tai). Nay 3 luot.
 *
 * Nhung tinh chat dang ghim khong phai "co 3 luot" — no la NGAN SACH: pha 1 chay TRUOC khi app mo
 * va nguoi dung dang cho no, nen `so luot x timeout` khong duoc VUOT tran cu. Chia lai, khong cong
 * them. Mot ban sau doi 3 luot x 900 s se lam bai nay do, va do la dung.
 */
test("tai co thu lai 3 luot, va tong thoi gian cho KHONG tang so voi tran cu", () => {
  const s = winStart as string;
  const soLan = Number(/\$lan -lt (\d+)/.exec(s)?.[1]);
  // Tu 11/09 khuc tai di qua ham `T`, nen tran KHONG con o cho goi Invoke-WebRequest — no la doi so
  // thu ba cua `T`. Doc o CHO GOI chu khong o than `T`: than chi co bien `$giay`.
  const moiLan = Number(/T \$b\.url \$tmp (\d+)/.exec(s)?.[1]);
  assert.ok(soLan >= 2, `phai co it nhat 2 luot, thay ${soLan}`);
  assert.ok(Number.isFinite(moiLan), "khong doc duoc -TimeoutSec cua luot tai");
  assert.ok(soLan * moiLan <= 180,
    `ngan sach cho vuot tran: ${soLan} x ${moiLan} = ${soLan * moiLan} > ${180} s`);
  // Bam phai duoc kiem TRONG vong lap: ngoai vong thi mot luot tai dut van di tiep sang pha 2.
  const vong = s.slice(s.indexOf("$lan -lt"), s.indexOf("giao-pha2-hong"));
  assert.match(vong, /Get-FileHash/, "phep kiem bam phai nam TRONG vong thu lai");
  assert.match(vong, /Remove-Item \$tmp -Force -ErrorAction SilentlyContinue/, "luot hong phai xoa file truoc khi thu lai");
  assert.match(s, /G \$giaiDoan \$lan/, "het luot thi ghi ca ly do LAN so may");
});
