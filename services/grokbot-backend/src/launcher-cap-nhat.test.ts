/**
 * Launcher của bản CHỞ CẢ APP (`startBundled`) — nó quyết định máy cài bản 105 MB có bao giờ lên bản
 * mới không.
 *
 *   npx tsx --test services/grokbot-backend/src/launcher-cap-nhat.test.ts
 *
 * Lịch sử ngắn của file này, vì nó đảo luật hai lần trong một ngày (03/09):
 *
 *   sáng  — "khoá updater gốc CÓ ĐIỀU KIỆN: app đã vá feed thì mở". Hướng sai: updater gốc dò chữ
 *           ký Authenticode và đòi tên người ký của HÃNG, nên mở nó chỉ được một banner dẫn tới nút
 *           Install luôn thất bại.
 *   chiều — updater gốc TẮT hẳn (mở lại bằng GROKBOT2_NATIVE_UPDATES=1 cho ngày có chứng chỉ), và
 *           launcher TỰ cập nhật qua `/updates/ban-moi?k=`, đọc token từ `token.txt` cạnh app.
 *
 * Đo E2E cùng ngày: bản cài từ web khớp từng byte bản đang chạy — nhưng launcher của nó là bản
 * sáng, không có tự cập nhật. File này khoá bản chiều.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error — script .mjs thuần, không có khai báo kiểu; đây là chỗ duy nhất TS chạm vào nó.
import { startBundled, coVaUpdateFeed } from "../scripts/setup-exe.mjs";

const s: string = startBundled();

test("updater gốc TẮT mặc định, mở lại được bằng GROKBOT2_NATIVE_UPDATES=1", () => {
  assert.match(s, /if not "%GROKBOT2_NATIVE_UPDATES%"=="1" set "SAND_DISABLE_UPDATES=1"/,
    "updater gốc không cài được bản của mình — mở nó chỉ dựng một nút Install luôn thất bại");
  assert.doesNotMatch(s, /^set "SAND_DISABLE_UPDATES=1"$/m, "không còn dòng đặt CỨNG vô điều kiện");
});

test("tự cập nhật: hỏi đúng cửa, kèm token, kiểm hash, tiết chế, fail-open", () => {
  assert.match(s, /updates\/ban-moi\?nen=windows&ver=/, "phải hỏi cửa launcher của backend mình");
  assert.match(s, /token\.txt/, "phải đọc token — không có thì bản 50 KB sẽ được cài lên máy này, sai gói");
  assert.match(s, /'&k='\+\[uri\]::EscapeDataString\(\$k\)/, "token đi trong query, đã escape");
  assert.match(s, /if\(-not \(Test-Path \$tk\)\)\{ G 'thieu-giay'; exit 0 \}/, "không có token thì mở app, không thử gói khác — nhưng phải GHI LẠI lý do");
  assert.match(s, /Get-FileHash/, "phải kiểm sha256 trước khi CHẠY file tải về");
  // Ghim TÍNH CHẤT, không ghim văn bản: 10/09 dòng này bị cấu trúc lại thành vòng thử-lại và bài
  // đo cũ (khớp nguyên văn) đỏ trong khi tính chất còn nguyên. Điều phải đúng là: bằng thì đi tiếp,
  // KHÁC thì xoá file và ghi `bam-lech` — chứ không phải nó được viết bằng đúng mấy chữ nào.
  assert.match(s, /\$h -eq \$b\.sha256hash\.ToLower\(\)/, "phải SO băm tải về với băm trong manifest");
  assert.match(s, /\$giaiDoan='bam-lech'; Remove-Item \$tmp -Force/, "băm lệch ⇒ xoá file rồi ghi đúng lý do");
  assert.doesNotMatch(s, /-ne \$b\.sha256hash[\s\S]*\$xong=\$true/, "không có đường nào coi băm LỆCH là thành công");
  assert.match(s, /TotalHours -lt 24/, "gói ~105 MB: hỏi một lần mỗi ngày là đủ");
  // Fail-open GIU NGUYEN qua ban 10/09: `catch` nay nay GHI lai giai doan roi van `exit 0`.
  // Ghim ca hai ve — chi ghim `exit 0` thi mot ban bo mat phep ghi van xanh, con chi ghim phep
  // ghi thi mot ban doi sang `exit 1` cung xanh, va `exit 1` la app khong bao gio mo len nua.
  assert.match(s, /\}catch\{ G \$giaiDoan; exit 0 \}/, "hỏng thì MỞ APP — lớp cập nhật tự chặn đường vào sản phẩm là lớp sẽ bị gỡ");
  assert.doesNotMatch(s, /catch\{[^}]*exit [1-9]/, "catch không bao giờ được thoát khác 0 — đó là app không mở lên nữa");
  assert.match(s, /GROKBOT2_NO_SELF_UPDATE/, "phải tắt được");
});

test("HAI PHA: pha 1 chỉ ghi script ra %TEMP% rồi thoát; pha 2 chạy tách rời", () => {
  // Bộ cài ghi đè chính start-bot.cmd. cmd đọc batch theo từng dòng từ đĩa, nên cài ĐỒNG BỘ từ trong
  // launcher là đọc dòng kế từ file mới ở offset cũ. Pha 2 phải chạy sau khi cmd đã thoát.
  assert.match(s, /bot-noi-bo-cap-nhat\.ps1/, "pha 2 là một script riêng trong %TEMP%");
  assert.match(s, /Start-Process -FilePath 'powershell' -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-File',\$pha2/, "pha 2 phải được khởi chạy TÁCH RỜI");
  assert.match(s, /'Start-Sleep -Seconds 2'/, "pha 2 chờ cmd thoát trước khi cài");
  assert.match(s, /\/VERYSILENT.*\/SUPPRESSMSGBOXES.*\/NORESTART.*\/DIR=/, "cài im lặng, đúng vào thư mục đang cài");
  assert.match(s, /'Start-Process -FilePath \(Join-Path \$d ''start-bot\.cmd''\)/, "cài xong pha 2 phải mở lại app — [Run] của Inno có skipifsilent");
  assert.match(s, /if errorlevel 7 exit \/b 0/, "mã 7 ⇒ cmd thoát ngay, không mở app lần hai");
  assert.doesNotMatch(s, /& cmd \/c \$tmp/, "không còn nhánh cài ĐỒNG BỘ trong launcher");
});

test("bốn biến hợp đồng với client còn đủ", () => {
  for (const bien of ["CURSOR_API_BASE_URL", "SAND_BACKEND_URL", "CURSOR_WEBSITE_URL", "SAND_DISABLE_UPDATES"]) {
    assert.match(s, new RegExp(`set "${bien}=`), bien);
  }
});

test("coVaUpdateFeed vẫn đo được dấu vá — giữ làm chẩn đoán, không còn quyết định gì", () => {
  const root = mkdtempSync(join(tmpdir(), "gb2-feed-"));
  try {
    const dir = join(root, "resources", "app", "dist", "electron-main");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "main.cjs"), 'var X="http://be"/*grokbot2:update-feed*/');
    assert.equal(coVaUpdateFeed(root), true);
    assert.equal(coVaUpdateFeed(join(tmpdir(), "khong-ton-tai-gb2")), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
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
  const soLan = Number(/\$lan -lt (\d+)/.exec(s)?.[1]);
  const moiLan = Number(/-TimeoutSec (\d+) -Uri \$b\.url/.exec(s)?.[1]);
  assert.ok(soLan >= 2, `phai co it nhat 2 luot, thay ${soLan}`);
  assert.ok(Number.isFinite(moiLan), "khong doc duoc -TimeoutSec cua luot tai");
  assert.ok(soLan * moiLan <= 900,
    `ngan sach cho vuot tran: ${soLan} x ${moiLan} = ${soLan * moiLan} > ${900} s`);
  // Bam phai duoc kiem TRONG vong lap: ngoai vong thi mot luot tai dut van di tiep sang pha 2.
  const vong = s.slice(s.indexOf("$lan -lt"), s.indexOf("giao-pha2-hong"));
  assert.match(vong, /Get-FileHash/, "phep kiem bam phai nam TRONG vong thu lai");
  assert.match(vong, /Remove-Item \$tmp -Force -ErrorAction SilentlyContinue/, "luot hong phai xoa file truoc khi thu lai");
  assert.match(s, /G \$giaiDoan \$lan/, "het luot thi ghi ca ly do LAN so may");
});
